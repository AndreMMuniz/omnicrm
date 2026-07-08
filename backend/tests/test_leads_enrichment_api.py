from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.api import api_router
from app.core.auth import get_current_user
from app.core.database import Base, get_db
from app.models.models import ChannelType, Client, Contact, Conversation, DefaultRole, Lead, LeadIdentity, Message, Project, ProjectStage, User, UserType


engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def _reset_schema():
    tables = [
        UserType.__table__,
        User.__table__,
        Client.__table__,
        Contact.__table__,
        Conversation.__table__,
        Message.__table__,
        ProjectStage.__table__,
        Project.__table__,
        LeadIdentity.__table__,
        Lead.__table__,
    ]
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        Base.metadata.drop_all(bind=connection, tables=tables)
        Base.metadata.create_all(bind=connection, tables=tables)
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")


def _make_client(db, current_user=None):
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    if current_user:
        async def override_current_user():
            return current_user

        app.dependency_overrides[get_current_user] = override_current_user
    return TestClient(app, raise_server_exceptions=True)


def _seed_user(db):
    user_type = UserType(
        name="Lead Enrichment Operator",
        base_role=DefaultRole.USER,
        is_system=False,
    )
    db.add(user_type)
    db.flush()
    user = User(
        auth_id="auth-lead-enrichment-operator",
        email="lead-enrichment-operator@example.com",
        full_name="Lead Enrichment Operator",
        user_type_id=user_type.id,
        is_active=True,
        is_approved=True,
    )
    db.add(user)
    db.flush()
    return user


def _seed_lead(db):
    contact = Contact(name="Marina Costa", email="marina@example.com", channel_identifier="@marina")
    db.add(contact)
    db.flush()
    conversation = Conversation(contact_id=contact.id, channel=ChannelType.WHATSAPP)
    db.add(conversation)
    db.flush()
    lead = Lead(
        conversation_id=conversation.id,
        name="Marina Costa",
        email="marina@example.com",
        phone="+5511999990000",
        company="Acme",
        source_channel="whatsapp",
        extraction_confidence={"name": 0.9},
        role="Operations Manager",
        pain_points=["fragmented support queue"],
        qualification_notes="Evaluating support operations improvements.",
        source_facts={"lead": {"company": "Acme"}},
        ai_inferences={"role": {"value": "Operations Manager", "confidence": 0.76}},
        enrichment_status="completed",
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


def test_get_lead_includes_enrichment_fields_and_masks_pii():
    _reset_schema()
    db = TestingSessionLocal()
    try:
        lead = _seed_lead(db)
        client = _make_client(db)

        response = client.get(f"/api/v1/leads/{lead.id}")

        assert response.status_code == 200
        payload = response.json()["data"]
        assert payload["email"] == "mar***@example.com"
        assert payload["phone"].endswith("0000")
        assert payload["role"] == "Operations Manager"
        assert payload["pain_points"] == ["fragmented support queue"]
        assert payload["qualification_notes"] == "Evaluating support operations improvements."
        assert payload["source_facts"] == {"lead": {"company": "Acme"}}
        assert payload["ai_inferences"]["role"]["value"] == "Operations Manager"
        assert payload["enrichment_status"] == "completed"
        assert payload["enrichment_error"] is None
        assert "enriched_at" in payload
    finally:
        db.close()
        _reset_schema()


def test_list_leads_includes_enrichment_summary():
    _reset_schema()
    db = TestingSessionLocal()
    try:
        _seed_lead(db)
        client = _make_client(db)

        response = client.get("/api/v1/leads")

        assert response.status_code == 200
        row = response.json()["data"][0]
        assert row["role"] == "Operations Manager"
        assert row["pain_points"] == ["fragmented support queue"]
        assert row["enrichment_status"] == "completed"
    finally:
        db.close()
        _reset_schema()


def test_retry_enrichment_requires_authentication():
    _reset_schema()
    db = TestingSessionLocal()
    try:
        lead = _seed_lead(db)
        client = _make_client(db)

        response = client.post(f"/api/v1/leads/{lead.id}/enrich")

        assert response.status_code == 401
    finally:
        db.close()
        _reset_schema()


def test_retry_enrichment_allows_authenticated_user():
    _reset_schema()
    db = TestingSessionLocal()
    try:
        lead = _seed_lead(db)
        current_user = _seed_user(db)
        client = _make_client(db, current_user)

        response = client.post(f"/api/v1/leads/{lead.id}/enrich")

        assert response.status_code == 200
        payload = response.json()["data"]
        assert payload["enrichment_status"] == "completed"
    finally:
        db.close()
        _reset_schema()
