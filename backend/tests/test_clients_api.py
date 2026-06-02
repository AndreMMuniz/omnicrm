import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.api import api_router
from app.core.auth import get_current_user
from app.core.database import Base, get_db
from app.models.models import Client, Contact, Conversation, DefaultRole, Project, Proposal, User, UserType


TEST_DB_URL = "sqlite://"
engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@pytest.fixture(scope="function")
def db():
    tables = [
        UserType.__table__,
        User.__table__,
        Client.__table__,
        Contact.__table__,
        Conversation.__table__,
        Project.__table__,
        Proposal.__table__,
    ]
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        Base.metadata.drop_all(bind=connection, tables=tables)
        Base.metadata.create_all(bind=connection, tables=tables)
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        with engine.begin() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            Base.metadata.drop_all(bind=connection, tables=tables)
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")


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


def test_list_clients_search_matches_owner_name_and_country(db):
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

    owner_response = client.get("/api/v1/admin/clients", params={"client_type": "company", "search": "Owner User"})
    assert owner_response.status_code == 200
    assert [row["id"] for row in owner_response.json()["data"]] == [str(company.id)]

    country_response = client.get("/api/v1/admin/clients", params={"client_type": "company", "search": "BR"})
    assert country_response.status_code == 200
    assert [row["id"] for row in country_response.json()["data"]] == [str(company.id)]


def test_list_clients_filters_by_country(db):
    current_user = _seed_user(db, "current@example.com", "Current User")
    br_company = Client(
        name="Acme BR",
        client_type="company",
        country="BR",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    us_company = Client(
        name="Acme US",
        client_type="company",
        country="US",
        currency="USD",
        created_by_user_id=current_user.id,
    )
    db.add_all([br_company, us_company])
    db.commit()

    client = _make_client(db, current_user)
    response = client.get("/api/v1/admin/clients", params={"client_type": "company", "country": "br"})

    assert response.status_code == 200
    assert [row["id"] for row in response.json()["data"]] == [str(br_company.id)]


def test_list_people_returns_contact_identity_with_linked_company(db):
    current_user = _seed_user(db, "current@example.com", "Current User")
    company = Client(
        name="Acme Brasil",
        company_name="Acme",
        client_type="company",
        country="BR",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(company)
    db.flush()

    from app.models.models import Contact

    contact = Contact(
        name="Marina Costa",
        email="marina@example.com",
        channel_identifier="@marina",
        client_id=company.id,
    )
    db.add(contact)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get("/api/v1/admin/contacts/people")

    assert response.status_code == 200
    payload = response.json()["data"][0]
    assert payload["name"] == "Marina Costa"
    assert payload["client_id"] == str(company.id)
    assert payload["client_name"] == "Acme Brasil"


def test_list_people_treats_soft_deleted_company_as_unlinked(db):
    current_user = _seed_user(db, "current@example.com", "Current User")
    company = Client(
        name="Archived Co",
        company_name="Archived",
        client_type="company",
        country="BR",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(company)
    db.flush()

    from app.models.models import Contact
    from datetime import datetime, timezone

    company.deleted_at = datetime.now(timezone.utc)
    contact = Contact(
        name="Marina Costa",
        email="marina@example.com",
        channel_identifier="@marina",
        client_id=company.id,
    )
    db.add(contact)
    db.commit()

    client = _make_client(db, current_user)

    response = client.get("/api/v1/admin/contacts/people", params={"linked": "unlinked"})
    assert response.status_code == 200
    payload = response.json()["data"][0]
    assert payload["id"] == str(contact.id)
    assert payload["client_id"] is None
    assert payload["client_name"] is None


def test_get_people_context_returns_linked_company_and_related_counts(db):
    current_user = _seed_user(db, "current@example.com", "Current User")
    company = Client(
        name="Acme Brasil",
        company_name="Acme",
        client_type="company",
        country="BR",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(company)
    db.flush()

    from app.models.models import Contact, Conversation

    contact = Contact(
        name="Marina Costa",
        email="marina@example.com",
        channel_identifier="@marina",
        client_id=company.id,
    )
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        channel="WHATSAPP",
        status="OPEN",
        last_message="Need proposal details",
    )
    db.add(conversation)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/admin/contacts/{contact.id}/people-context")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["linked_company"]["id"] == str(company.id)
    assert payload["conversation_count"] == 1
    assert payload["related_conversations"][0]["id"] == str(conversation.id)


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
