from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session, joinedload
from slowapi.util import get_remote_address
from app.core.config import settings as app_settings
from app.core.database import get_db, get_supabase
from app.core.limiter import limiter
from app.core.local_auth import (
    decode_token,
    hash_password,
    issue_access_token,
    issue_refresh_token,
    new_local_auth_id,
    verify_password,
)
from app.models.models import User, UserType
from app.schemas.user import UserResponse, UserSignup
from app.schemas.common import create_response, create_error_response
from app.api.endpoints.users import seed_default_user_types
from app.repositories import RepositoryFactory, get_repositories

router = APIRouter()

_IS_PROD = app_settings.is_production


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    # SameSite=none required for cross-domain cookie sharing (Vercel + Railway)
    samesite = "none" if _IS_PROD else "lax"
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=_IS_PROD,
        samesite=samesite,
        max_age=3600,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=_IS_PROD,
        samesite=samesite,
        max_age=7 * 24 * 3600,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserResponse


@router.post("/login")
@limiter.limit("10/minute", key_func=get_remote_address)
async def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    repos: RepositoryFactory = Depends(get_repositories),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Authenticate using the configured auth backend, set HttpOnly cookies and return tokens."""
    if app_settings.use_local_auth:
        user = (
            db.query(User)
            .options(joinedload(User.user_type))
            .filter(User.email == data.email)
            .first()
        )
        if not user or not verify_password(data.password, user.local_password_hash):
            error_response, status = create_error_response(
                code="INVALID_CREDENTIALS",
                message="Invalid email or password",
                status_code=401
            )
            raise HTTPException(status_code=status, detail=error_response)

        _ensure_user_can_login(user)
        access_token = issue_access_token(user.auth_id)
        refresh_token = issue_refresh_token(user.auth_id)
        _set_auth_cookies(response, access_token, refresh_token)
        return create_response({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": UserResponse.model_validate(user)
        })

    supabase = get_supabase()

    try:
        auth_response = supabase.auth.sign_in_with_password({
            "email": data.email,
            "password": data.password,
        })
    except Exception:
        error_response, status = create_error_response(
            code="INVALID_CREDENTIALS",
            message="Invalid email or password",
            status_code=401
        )
        raise HTTPException(status_code=status, detail=error_response)

    if not auth_response.session:
        error_response, status = create_error_response(
            code="INVALID_CREDENTIALS",
            message="Invalid email or password",
            status_code=401
        )
        raise HTTPException(status_code=status, detail=error_response)

    auth_id = str(auth_response.user.id)

    # Find local profile
    user = await repos.users.find_by_auth_id(auth_id)

    # Auto-provision local profile on first login (fresh deployment scenario)
    if not user:
        from app.models.models import User as UserModel
        seed_default_user_types(db)

        user_count = db.query(UserModel).count()
        is_first_user = user_count == 0

        # First user ever → Admin (approved + active immediately)
        # Subsequent users from Supabase Auth → pending approval
        role_name = "Admin" if is_first_user else "User"
        role = db.query(UserType).filter(
            UserType.name == role_name, UserType.is_system == True
        ).first()

        if role:
            email = auth_response.user.email or data.email
            full_name = email.split("@")[0].replace(".", " ").title()
            user = await repos.users.create({
                "auth_id": auth_id,
                "email": email,
                "full_name": full_name,
                "user_type_id": role.id,
                "is_active": is_first_user,
                "is_approved": is_first_user,
            })
        else:
            error_response, status = create_error_response(
                code="USER_NOT_FOUND",
                message="User profile not found. Contact an administrator.",
                status_code=403
            )
            raise HTTPException(status_code=status, detail=error_response)

    _ensure_user_can_login(user)

    _set_auth_cookies(response, auth_response.session.access_token, auth_response.session.refresh_token)

    return create_response({
        "access_token": auth_response.session.access_token,
        "refresh_token": auth_response.session.refresh_token,
        "user": UserResponse.model_validate(user)
    })


@router.post("/signup")
@limiter.limit("5/minute", key_func=get_remote_address)
async def signup(data: UserSignup, request: Request, repos: RepositoryFactory = Depends(get_repositories), db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Self-service registration — creates account pending admin approval."""
    seed_default_user_types(db)

    # Use repository to check if email exists
    existing = await repos.users.find_by_email(data.email)
    if existing:
        error_response, status = create_error_response(
            code="DUPLICATE_EMAIL",
            message="Email already registered",
            details={"field": "email", "value": data.email},
            status_code=409
        )
        raise HTTPException(status_code=status, detail=error_response)

    default_role = db.query(UserType).filter(UserType.name == "User", UserType.is_system == True).first()
    if not default_role:
        error_response, status = create_error_response(
            code="INTERNAL_ERROR",
            message="Default role not found. Contact an administrator.",
            status_code=500
        )
        raise HTTPException(status_code=status, detail=error_response)

    if app_settings.use_local_auth:
        user_count = db.query(User).count()
        is_first_user = user_count == 0
        assigned_role = default_role
        if is_first_user:
            assigned_role = (
                db.query(UserType)
                .filter(UserType.name == "Admin", UserType.is_system == True)
                .first()
                or default_role
            )

        user = await repos.users.create({
            "auth_id": new_local_auth_id(),
            "email": data.email,
            "full_name": data.full_name,
            "user_type_id": assigned_role.id,
            "is_active": is_first_user,
            "is_approved": is_first_user,
            "local_password_hash": hash_password(data.password),
        })
        detail = (
            "First local account created with admin access."
            if is_first_user
            else "Account created. An administrator will review your request and notify you by email."
        )
        return create_response({
            "detail": detail,
            "user": UserResponse.model_validate(user),
        })

    supabase = get_supabase()
    try:
        auth_response = supabase.auth.admin.create_user({
            "email": data.email,
            "password": data.password,
            "email_confirm": True,
        })
        auth_id = auth_response.user.id
    except Exception as e:
        error_response, status = create_error_response(
            code="INTERNAL_ERROR",
            message="Failed to create account",
            details={"error": str(e)},
            status_code=400
        )
        raise HTTPException(status_code=status, detail=error_response)

    # Use repository to create user
    user = await repos.users.create({
        "auth_id": str(auth_id),
        "email": data.email,
        "full_name": data.full_name,
        "user_type_id": default_role.id,
        "is_active": False,
        "is_approved": False,
    })

    return create_response({
        "detail": "Account created. An administrator will review your request and notify you by email."
    })


class SetPasswordRequest(BaseModel):
    new_password: str

    @field_validator('new_password')
    @classmethod
    def password_strength(cls, v: str) -> str:
        from app.schemas.user import validate_password_strength
        return validate_password_strength(v)


@router.post("/forgot-password")
@limiter.limit("3/minute", key_func=get_remote_address)
async def forgot_password(data: dict, request: Request) -> Dict[str, Any]:
    """Send password reset email via Supabase."""
    email = data.get("email")
    if not email:
        error_response, status = create_error_response(
            code="VALIDATION_ERROR",
            message="Email required",
            details={"field": "email"},
            status_code=400
        )
        raise HTTPException(status_code=status, detail=error_response)

    if app_settings.use_local_auth:
        error_response, status = create_error_response(
            code="UNSUPPORTED_IN_LOCAL_AUTH",
            message="Password reset by email is unavailable in local auth mode. Use the admin password reset instead.",
            status_code=400
        )
        raise HTTPException(status_code=status, detail=error_response)

    supabase = get_supabase()
    try:
        supabase.auth.reset_password_for_email(email, {
            "redirect_to": f"{app_settings.FRONTEND_URL}/reset-password"
        })
    except Exception as e:
        error_response, status = create_error_response(
            code="INTERNAL_ERROR",
            message="Failed to send reset email",
            details={"error": str(e)},
            status_code=400
        )
        raise HTTPException(status_code=status, detail=error_response)

    return create_response({
        "detail": "Password reset email sent. Check your inbox."
    })


@router.post("/set-password")
async def set_password(data: SetPasswordRequest, request: Request, repos: RepositoryFactory = Depends(get_repositories), db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Set a new password using a Supabase recovery token.
    Auto-creates the local user record if the email was registered directly in Supabase.
    """
    if app_settings.use_local_auth:
        error_response, status = create_error_response(
            code="UNSUPPORTED_IN_LOCAL_AUTH",
            message="Recovery-link password reset is unavailable in local auth mode. Use the admin password reset instead.",
            status_code=400
        )
        raise HTTPException(status_code=status, detail=error_response)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        error_response, status = create_error_response(
            code="INVALID_TOKEN",
            message="Recovery token required",
            status_code=401
        )
        raise HTTPException(status_code=status, detail=error_response)

    token = auth_header[7:]
    supabase = get_supabase()

    try:
        auth_response = supabase.auth.get_user(token)
        if not auth_response or not auth_response.user:
            error_response, status = create_error_response(
                code="TOKEN_EXPIRED",
                message="Invalid or expired recovery link",
                status_code=401
            )
            raise HTTPException(status_code=status, detail=error_response)
        auth_user = auth_response.user
    except HTTPException:
        raise
    except Exception:
        error_response, status = create_error_response(
            code="TOKEN_EXPIRED",
            message="Invalid or expired recovery link",
            status_code=401
        )
        raise HTTPException(status_code=status, detail=error_response)

    try:
        supabase.auth.admin.update_user_by_id(str(auth_user.id), {"password": data.new_password})
    except Exception as e:
        error_response, status = create_error_response(
            code="INTERNAL_ERROR",
            message="Failed to update password",
            details={"error": str(e)},
            status_code=400
        )
        raise HTTPException(status_code=status, detail=error_response)

    # Auto-create local user record if admin registered the email directly in Supabase
    auth_id = str(auth_user.id)
    user = await repos.users.find_by_auth_id(auth_id)
    if not user:
        seed_default_user_types(db)
        default_role = db.query(UserType).filter(UserType.name == "User", UserType.is_system == True).first()
        if default_role and auth_user.email:
            name = auth_user.email.split("@")[0].replace(".", " ").title()
            new_user = await repos.users.create({
                "auth_id": auth_id,
                "email": auth_user.email,
                "full_name": name,
                "user_type_id": default_role.id,
                "is_active": True,
                "is_approved": True,
            })

    return create_response({
        "detail": "Password set successfully. You can now sign in."
    })


@router.post("/logout")
async def logout(response: Response) -> Dict[str, Any]:
    """Invalidate session by clearing auth cookies."""
    _clear_auth_cookies(response)
    return create_response({
        "detail": "Logged out"
    })


@router.post("/refresh")
async def refresh_token(request: Request, response: Response) -> Dict[str, Any]:
    """Refresh access token using the HttpOnly refresh cookie."""
    token = request.cookies.get("refresh_token")
    if not token:
        error_response, status = create_error_response(
            code="INVALID_TOKEN",
            message="No refresh token",
            status_code=401
        )
        raise HTTPException(status_code=status, detail=error_response)

    if app_settings.use_local_auth:
        try:
            claims = decode_token(token, expected_type="refresh")
        except ValueError:
            _clear_auth_cookies(response)
            error_response, status = create_error_response(
                code="TOKEN_EXPIRED",
                message="Invalid refresh token",
                status_code=401
            )
            raise HTTPException(status_code=status, detail=error_response)

        access_token = issue_access_token(claims["sub"])
        refresh_token_value = issue_refresh_token(claims["sub"])
        _set_auth_cookies(response, access_token, refresh_token_value)
        return create_response({
            "access_token": access_token,
            "refresh_token": refresh_token_value,
        })

    supabase = get_supabase()
    try:
        auth_response = supabase.auth.refresh_session(token)
        _set_auth_cookies(response, auth_response.session.access_token, auth_response.session.refresh_token)
        return create_response({
            "access_token": auth_response.session.access_token,
            "refresh_token": auth_response.session.refresh_token,
        })
    except Exception:
        _clear_auth_cookies(response)
        error_response, status = create_error_response(
            code="TOKEN_EXPIRED",
            message="Invalid refresh token",
            status_code=401
        )
        raise HTTPException(status_code=status, detail=error_response)


def _ensure_user_can_login(user: User) -> None:
    if not user.is_approved:
        error_response, status = create_error_response(
            code="USER_NOT_APPROVED",
            message="Account pending admin approval. You will be notified by email when approved.",
            status_code=403
        )
        raise HTTPException(status_code=status, detail=error_response)

    if not user.is_active:
        error_response, status = create_error_response(
            code="USER_DISABLED",
            message="Account is disabled. Contact an administrator.",
            status_code=403
        )
        raise HTTPException(status_code=status, detail=error_response)
