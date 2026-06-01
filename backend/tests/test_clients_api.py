from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.api import api_router
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.models import Client, DefaultRole, User, UserType


def _seed_user(db, email: str, name: str, *, is_active: bool = True) -> User:
    user_type = UserType(
        name=f"Role {email}",
        base_role=DefaultRole.ADMIN,
        is_system=False,
    )
    db.add(user_type)
    db.flush()

    user = User(
        auth_id=f"auth-{email}",
        email=email,
        full_name=name,
        user_type_id=user_type.id,
        is_active=is_active,
        is_approved=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_client(db, current_user: User) -> TestClient:
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")

    def override_get_db():
        try:
            yield db
        finally:
            pass

    async def override_current_user():
        return current_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_current_user
    return TestClient(app, raise_server_exceptions=True)


def test_list_clients_returns_owner_metadata_for_companies(db):
    current_user = _seed_user(db, "current@example.com", "Current User")
    owner = _seed_user(db, "owner@example.com", "Owner User")
    company = Client(
        name="Acme",
        client_type="company",
        country="BR",
        currency="BRL",
        created_by_user_id=current_user.id,
        owner_user_id=owner.id,
    )
    db.add(company)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get("/api/v1/admin/clients", params={"client_type": "company"})

    assert response.status_code == 200
    payload = response.json()["data"][0]
    assert payload["owner_user_id"] == str(owner.id)
    assert payload["owner_name"] == "Owner User"


def test_get_client_returns_owner_and_creator_metadata(db):
    current_user = _seed_user(db, "current@example.com", "Current User")
    owner = _seed_user(db, "owner@example.com", "Owner User")
    target = Client(
        name="Acme",
        client_type="company",
        country="BR",
        currency="BRL",
        created_by_user_id=current_user.id,
        owner_user_id=owner.id,
    )
    db.add(target)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/admin/clients/{target.id}")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["owner_user_id"] == str(owner.id)
    assert payload["owner_name"] == "Owner User"
    assert payload["created_by_name"] == "Current User"


def test_create_client_accepts_owner_user_id(db):
    current_user = _seed_user(db, "current@example.com", "Current User")
    owner = _seed_user(db, "owner@example.com", "Owner User")
    db.commit()

    client = _make_client(db, current_user)
    response = client.post(
        "/api/v1/admin/clients",
        json={
            "name": "Acme",
            "client_type": "company",
            "country": "BR",
            "currency": "BRL",
            "owner_user_id": str(owner.id),
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["owner_user_id"] == str(owner.id)
    assert payload["owner_name"] == "Owner User"


def test_update_client_rejects_unknown_owner_user_id(db):
    current_user = _seed_user(db, "current@example.com", "Current User")
    target = Client(
        name="Acme",
        client_type="company",
        country="BR",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(target)
    db.commit()

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/admin/clients/{target.id}",
        json={"owner_user_id": "11111111-1111-1111-1111-111111111111"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Owner user not found"
