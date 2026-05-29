"""
UserService — business logic for user and user-type lifecycle.

Encapsulates: Supabase auth operations, local DB writes, email notifications,
audit logging. Endpoints become thin wrappers that call these methods.
"""

from typing import Optional
from uuid import UUID
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.database import get_supabase
from app.core.email import send_approval_email
from app.core.local_auth import hash_password, new_local_auth_id
from app.models.models import User, UserType, DefaultRole, AuditLog, Conversation, Message
from app.repositories import RepositoryFactory
from app.services.audit_service import log_action


class UserService:
    """All user-management business logic in one place."""

    def __init__(self, db: Session):
        self.db = db
        self._supabase = None  # lazy — not all methods need it

    @property
    def supabase(self):
        if self._supabase is None:
            self._supabase = get_supabase()
        return self._supabase

    # ── User Types ────────────────────────────────────────────────────────────

    def seed_default_user_types(self) -> None:
        """Create built-in Admin/Manager/User roles if they don't exist."""
        existing = self.db.query(UserType).filter(UserType.is_system == True).count()
        if existing >= 3:
            return
        defaults = [
            UserType(
                name="Admin", base_role=DefaultRole.ADMIN, is_system=True,
                can_view_all_conversations=True, can_delete_conversations=True,
                can_edit_messages=True, can_delete_messages=True,
                can_manage_users=True, can_assign_roles=True,
                can_disable_users=True, can_change_user_password=True,
                can_change_settings=True, can_change_branding=True,
                can_change_ai_model=True, can_view_audit_logs=True,
                can_create_user_types=True,
            ),
            UserType(name="Manager", base_role=DefaultRole.MANAGER, is_system=True,
                     can_view_all_conversations=True, can_edit_messages=True,
                     can_view_audit_logs=True),
            UserType(name="User", base_role=DefaultRole.USER, is_system=True),
        ]
        for ut in defaults:
            if not self.db.query(UserType).filter(UserType.name == ut.name).first():
                self.db.add(ut)
        self.db.commit()

    def get_default_role(self) -> Optional[UserType]:
        return self.db.query(UserType).filter(
            UserType.name == "User", UserType.is_system == True
        ).first()

    def get_user_type(self, user_type_id: UUID) -> Optional[UserType]:
        return self.db.query(UserType).filter(UserType.id == user_type_id).first()

    def create_user_type(self, data: dict) -> UserType:
        user_type = UserType(**data, is_system=False)
        self.db.add(user_type)
        self.db.commit()
        self.db.refresh(user_type)
        return user_type

    def update_user_type(self, user_type: UserType, data: dict) -> UserType:
        for key, value in data.items():
            setattr(user_type, key, value)
        self.db.commit()
        self.db.refresh(user_type)
        return user_type

    def delete_user_type(self, user_type: UserType) -> None:
        self.db.delete(user_type)
        self.db.commit()

    # ── User CRUD ─────────────────────────────────────────────────────────────

    def create_user(
        self,
        email: str,
        password: str,
        full_name: str,
        user_type_id: UUID,
        avatar: Optional[str] = None,
        is_active: bool = True,
        is_approved: bool = True,
        actor_id: Optional[UUID] = None,
        ip_address: Optional[str] = None,
    ) -> User:
        """Create user in the configured auth backend + local DB. Returns the new User."""
        auth_id = new_local_auth_id()
        local_password_hash = hash_password(password) if settings.use_local_auth else None
        if not settings.use_local_auth:
            auth_response = self.supabase.auth.admin.create_user({
                "email": email,
                "password": password,
                "email_confirm": True,
            })
            auth_id = str(auth_response.user.id)

        user = User(
            auth_id=auth_id,
            email=email,
            full_name=full_name,
            avatar=avatar,
            local_password_hash=local_password_hash,
            user_type_id=user_type_id,
            is_active=is_active,
            is_approved=is_approved,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        self.db.refresh(user, attribute_names=["user_type"])

        if actor_id:
            user_type = self.get_user_type(user_type_id)
            log_action(self.db, actor_id, "create_user", "user", str(user.id),
                       details={"email": email, "role": user_type.name if user_type else None},
                       ip_address=ip_address)
        return user

    def create_user_from_signup(
        self,
        email: str,
        password: str,
        full_name: str,
    ) -> User:
        """Self-signup: creates account pending admin approval."""
        self.seed_default_user_types()
        default_role = self.get_default_role()
        if not default_role:
            raise ValueError("Default role not found")
        return self.create_user(
            email=email, password=password, full_name=full_name,
            user_type_id=default_role.id, is_active=False, is_approved=False,
        )

    def update_user(
        self,
        user: User,
        data: dict,
        actor_id: Optional[UUID] = None,
        ip_address: Optional[str] = None,
    ) -> User:
        for key, value in data.items():
            setattr(user, key, value)
        self.db.commit()
        self.db.refresh(user)
        if actor_id:
            log_action(self.db, actor_id, "update_user", "user", str(user.id),
                       details=data, ip_address=ip_address)
        return user

    def delete_user(
        self,
        user: User,
        actor_id: Optional[UUID] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        """Delete from local DB + Supabase, reassign FK references."""
        # Reassign FK references before deleting
        self.db.query(Conversation).filter(
            Conversation.assigned_user_id == user.id
        ).update({"assigned_user_id": None})
        self.db.query(Message).filter(
            Message.owner_id == user.id
        ).update({"owner_id": None})
        self.db.query(AuditLog).filter(AuditLog.user_id == user.id).delete()

        if actor_id:
            log_action(self.db, actor_id, "delete_user", "user", str(user.id),
                       details={"email": user.email}, ip_address=ip_address)

        if not settings.use_local_auth:
            try:
                self.supabase.auth.admin.delete_user(user.auth_id)
            except Exception:
                pass  # proceed even if Supabase deletion fails

        self.db.delete(user)
        self.db.commit()

    def approve_user(
        self,
        user: User,
        actor_id: Optional[UUID] = None,
        ip_address: Optional[str] = None,
    ) -> User:
        """Approve pending signup: activate account + send notification email."""
        user.is_approved = True
        user.is_active = True
        self.db.commit()
        self.db.refresh(user)
        send_approval_email(user.email, user.full_name, self.db)
        if actor_id:
            log_action(self.db, actor_id, "approve_user", "user", str(user.id),
                       details={"email": user.email}, ip_address=ip_address)
        return user

    def reject_user(
        self,
        user: User,
        actor_id: Optional[UUID] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        """Reject and remove pending signup."""
        if actor_id:
            log_action(self.db, actor_id, "reject_user", "user", str(user.id),
                       details={"email": user.email}, ip_address=ip_address)
        if not settings.use_local_auth:
            try:
                self.supabase.auth.admin.delete_user(user.auth_id)
            except Exception:
                pass
        self.db.delete(user)
        self.db.commit()

    def enable_user(
        self,
        user: User,
        actor_id: Optional[UUID] = None,
        ip_address: Optional[str] = None,
    ) -> User:
        user.is_active = True
        self.db.commit()
        if actor_id:
            log_action(self.db, actor_id, "enable_user", "user", str(user.id),
                       details={"email": user.email}, ip_address=ip_address)
        return user

    def disable_user(
        self,
        user: User,
        actor_id: Optional[UUID] = None,
        ip_address: Optional[str] = None,
    ) -> User:
        user.is_active = False
        self.db.commit()
        if actor_id:
            log_action(self.db, actor_id, "disable_user", "user", str(user.id),
                       details={"email": user.email}, ip_address=ip_address)
        return user

    def change_password(
        self,
        user: User,
        new_password: str,
        actor_id: Optional[UUID] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        if settings.use_local_auth:
            user.local_password_hash = hash_password(new_password)
            self.db.commit()
            self.db.refresh(user)
        else:
            self.supabase.auth.admin.update_user_by_id(user.auth_id, {"password": new_password})
        if actor_id:
            log_action(self.db, actor_id, "change_user_password", "user", str(user.id),
                       ip_address=ip_address)


def get_user_service(db: Session) -> UserService:
    """FastAPI dependency factory."""
    return UserService(db)
