from contextlib import contextmanager
from uuid import uuid4

from app.core.config import settings
from app.core.local_auth import (
    decode_token,
    hash_password,
    issue_access_token,
    issue_refresh_token,
    new_local_auth_id,
    verify_password,
)
from app.models.models import DefaultRole, User, UserType
from app.services.user_service import UserService


@contextmanager
def local_auth_mode():
    previous = settings.AUTH_MODE
    settings.AUTH_MODE = "local"
    try:
        yield
    finally:
        settings.AUTH_MODE = previous


def make_role(db, name="Admin", base_role=DefaultRole.ADMIN) -> UserType:
    role = UserType(name=name, base_role=base_role, is_system=True)
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def make_local_user(db, role: UserType, email="local@example.com", password="LocalPass123!") -> User:
    user = User(
        auth_id=new_local_auth_id(),
        email=email,
        full_name="Local User",
        local_password_hash=hash_password(password),
        user_type_id=role.id,
        is_active=True,
        is_approved=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_password_hash_roundtrip():
    password_hash = hash_password("StrongPass123!")
    assert verify_password("StrongPass123!", password_hash) is True
    assert verify_password("wrong-pass", password_hash) is False


def test_local_tokens_roundtrip():
    auth_id = new_local_auth_id()
    access_token = issue_access_token(auth_id)
    refresh_token = issue_refresh_token(auth_id)

    assert decode_token(access_token, expected_type="access")["sub"] == auth_id
    assert decode_token(refresh_token, expected_type="refresh")["sub"] == auth_id


def test_user_service_creates_local_user_without_supabase(db):
    with local_auth_mode():
        role = make_role(db)
        user = UserService(db).create_user(
            email="created@example.com",
            password="CreatedPass123!",
            full_name="Created User",
            user_type_id=role.id,
        )

    assert user.auth_id.startswith("local:")
    assert user.local_password_hash
    assert verify_password("CreatedPass123!", user.local_password_hash) is True


def test_user_service_changes_local_password(db):
    with local_auth_mode():
        role = make_role(db)
        user = make_local_user(db, role, email="reset@example.com", password="OldPass123!")
        UserService(db).change_password(user, "NewPass123!")
        db.refresh(user)

    assert verify_password("NewPass123!", user.local_password_hash) is True
    assert verify_password("OldPass123!", user.local_password_hash) is False


def test_local_login_and_authenticated_profile(client, db):
    with local_auth_mode():
        role = make_role(db)
        make_local_user(db, role, email="login@example.com", password="LoginPass123!")

        response = client.post(
            "/api/v1/auth/login",
            json={"email": "login@example.com", "password": "LoginPass123!"},
        )

        assert response.status_code == 200
        payload = response.json()["data"]
        assert payload["user"]["email"] == "login@example.com"

        me = client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {payload['access_token']}"},
        )

        assert me.status_code == 200
        assert me.json()["data"]["email"] == "login@example.com"
