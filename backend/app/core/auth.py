from typing import Optional
from uuid import UUID
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session, joinedload
from app.core.config import settings
from app.core.database import get_db, get_supabase
from app.core.local_auth import decode_token
from app.models.models import User, UserType

security = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """Verify the configured auth token from HttpOnly cookie or Authorization header."""
    token = credentials.credentials if credentials else None
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    if settings.use_local_auth:
        try:
            auth_id = decode_token(token, expected_type="access")["sub"]
        except ValueError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    else:
        supabase = get_supabase()
        try:
            auth_response = supabase.auth.get_user(token)
            if not auth_response or not auth_response.user:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
            auth_id = auth_response.user.id
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user = (
        db.query(User)
        .options(joinedload(User.user_type))
        .filter(User.auth_id == auth_id)
        .first()
    )

    if not user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User profile not found. Contact an administrator.")

    if not user.is_approved:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account pending admin approval.")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is disabled.")

    return user


def require_permission(permission: str):
    """Dependency factory that checks if the current user has a specific permission."""
    async def _check(current_user: User = Depends(get_current_user)) -> User:
        user_type: UserType = current_user.user_type
        if not user_type:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No role assigned")

        has_permission = getattr(user_type, permission, False)
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: '{permission}' required",
            )
        return current_user
    return _check


def get_client_ip(request: Request) -> str:
    """Extract client IP from request headers (supports proxies)."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
