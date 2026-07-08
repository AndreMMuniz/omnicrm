from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.api import api_router
from app.core.auth import get_current_user
from app.core.database import Base
from app.core.database import get_db
from app.models.models import CatalogCategory, CatalogItem, Client, Contact, Conversation, DefaultRole, Lead, LeadIdentity, LeadScoringConfig, Message, OutreachCampaign, OutreachCampaignLead, Project, ProjectStage, User, UserType


engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=OFF")
    cursor.close()


@pytest.fixture(scope="function")
def db():
    tables = [
        UserType.__table__,
        User.__table__,
        Client.__table__,
        Contact.__table__,
        ProjectStage.__table__,
        Project.__table__,
        CatalogCategory.__table__,
        CatalogItem.__table__,
        Conversation.__table__,
        Message.__table__,
        LeadIdentity.__table__,
        Lead.__table__,
        OutreachCampaign.__table__,
        OutreachCampaignLead.__table__,
        LeadScoringConfig.__table__,
    ]
    with engine.begin() as connection:
        Base.metadata.drop_all(bind=connection, tables=list(reversed(tables)))
        Base.metadata.create_all(bind=connection, tables=tables)

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        with engine.begin() as connection:
            Base.metadata.drop_all(bind=connection, tables=list(reversed(tables)))


def _seed_user(db, *, can_change_settings: bool = True) -> User:
    user_type = UserType(
        name="Lead Scoring Admin" if can_change_settings else "Lead Scoring User",
        base_role=DefaultRole.ADMIN if can_change_settings else DefaultRole.USER,
        is_system=False,
        can_change_settings=can_change_settings,
    )
    db.add(user_type)
    db.flush()
    user = User(
        auth_id=f"auth-lead-scoring-{can_change_settings}",
        email="lead-scoring-admin@example.com" if can_change_settings else "lead-scoring-user@example.com",
        full_name="Lead Scoring Admin" if can_change_settings else "Lead Scoring User",
        user_type_id=user_type.id,
        is_active=True,
        is_approved=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_client(db, current_user: User | None = None) -> TestClient:
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


def test_lead_detail_includes_scoring_fields_and_preserves_masking(db):
    identity = LeadIdentity(
        display_name="Marina Costa",
        company="Acme",
        normalized_name="marina costa",
        normalized_company="acme",
        resolution_status="resolved",
        confidence=0.95,
        match_reasons=["email_hash_match"],
    )
    db.add(identity)
    db.flush()
    lead = Lead(
        name="Marina Costa",
        email="marina@example.com",
        phone="+55 11 99999-1234",
        company="Acme",
        source_channel="whatsapp",
        lead_identity_id=identity.id,
        identity_resolution_status="resolved",
        identity_confidence=0.95,
        identity_match_reasons=["email_hash_match"],
        identity_review_required=False,
        score=78,
        qualification_label="warm",
        score_confidence=0.72,
        score_breakdown=[{"component": "identity_completeness", "points": 18}],
        score_rationale="Strong fit.",
        scoring_version="default-test",
    )
    db.add(lead)
    db.commit()

    current_user = _seed_user(db)
    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/leads/{lead.id}")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["email"] == "mar***@example.com"
    assert data["phone"].endswith("1234")
    assert data["score"] == 78
    assert data["qualification_label"] == "warm"
    assert data["low_confidence"] is False
    assert data["score_breakdown"][0]["component"] == "identity_completeness"
    assert data["lead_identity_id"] == str(identity.id)
    assert data["identity_resolution_status"] == "resolved"
    assert data["identity_confidence"] == 0.95
    assert data["identity_match_reasons"] == ["email_hash_match"]
    assert data["identity_review_required"] is False
    assert "email_hash" not in data
    assert "phone_hash" not in data
    assert data["active_sequence_active"] is False
    assert data["active_campaign_id"] is None


def test_score_endpoint_calculates_and_persists_result(db):
    lead = Lead(
        name="Marina Costa",
        company="Acme",
        email="marina@example.com",
        source_channel="whatsapp",
        extraction_confidence={"name": 0.9, "company": 0.8},
    )
    db.add(lead)
    db.commit()

    current_user = _seed_user(db)
    client = _make_client(db, current_user)
    response = client.post(f"/api/v1/leads/{lead.id}/score")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["score"] is not None
    assert data["qualification_label"] in {"cold", "warm", "hot"}
    assert data["score_breakdown"]

    db.refresh(lead)
    assert lead.score == data["score"]


def test_scoring_config_endpoint_validates_and_changes_thresholds(db):
    current_user = _seed_user(db)
    client = _make_client(db, current_user)

    bad_response = client.patch(
        "/api/v1/leads/scoring/config",
        json={
            "version": "bad",
            "thresholds": {"hot": 90, "warm": 50, "cold": 0},
            "low_confidence_threshold": None,
            "components": {
                "identity_completeness": 20,
                "company_fit": 20,
                "pain_point_fit": 30,
                "engagement_signal": 20,
                "duplicate_risk": -10,
            },
        },
    )
    assert bad_response.status_code == 400
    assert "low_confidence_threshold" in bad_response.json()["detail"]

    good_response = client.patch(
        "/api/v1/leads/scoring/config",
        json={
            "version": "strict-api-test",
            "thresholds": {"hot": 101, "warm": 101, "cold": 0},
            "low_confidence_threshold": 0.1,
            "components": {
                "identity_completeness": 20,
                "company_fit": 20,
                "pain_point_fit": 30,
                "engagement_signal": 20,
                "duplicate_risk": -10,
            },
        },
    )
    assert good_response.status_code == 200
    assert good_response.json()["data"]["version"] == "strict-api-test"

    get_response = client.get("/api/v1/leads/scoring/config")
    assert get_response.status_code == 200
    assert get_response.json()["data"]["version"] == "strict-api-test"


def test_scoring_config_update_requires_settings_permission(db):
    current_user = _seed_user(db, can_change_settings=False)
    client = _make_client(db, current_user)

    response = client.patch(
        "/api/v1/leads/scoring/config",
        json={
            "version": "strict-api-test",
            "thresholds": {"hot": 101, "warm": 101, "cold": 0},
            "low_confidence_threshold": 0.1,
            "components": {
                "identity_completeness": 20,
                "company_fit": 20,
                "pain_point_fit": 30,
                "engagement_signal": 20,
                "duplicate_risk": -10,
            },
        },
    )

    assert response.status_code == 403
    assert "can_change_settings" in response.json()["detail"]


def test_lead_detail_includes_active_campaign_summary(db):
    user = _seed_user(db)
    lead = Lead(
        name="Marina Costa",
        email="marina@example.com",
        company="Acme",
        source_channel="whatsapp",
    )
    db.add(lead)
    db.flush()
    campaign = OutreachCampaign(
        objective="Re-engage qualified leads",
        channel="whatsapp",
        cadence={"timezone": "America/Sao_Paulo"},
        status="active",
        owner_user_id=user.id,
        created_by_user_id=user.id,
        source_type="lead_selection",
    )
    db.add(campaign)
    db.flush()
    db.add(
        OutreachCampaignLead(
            campaign_id=campaign.id,
            lead_id=lead.id,
            status="active",
        )
    )
    db.commit()

    client = _make_client(db, user)
    response = client.get(f"/api/v1/leads/{lead.id}")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["active_sequence_active"] is True
    assert data["active_campaign_id"] == str(campaign.id)
    assert data["active_campaign_name"] == "Re-engage qualified leads"
    assert data["active_campaign_channel"] == "whatsapp"
    assert data["active_campaign_status"] == "active"


def test_lead_outreach_grounding_preview_returns_attributed_safe_inputs(db):
    current_user = _seed_user(db)
    contact = Contact(name="Marina Costa")
    db.add(contact)
    db.flush()
    conversation = Conversation(contact_id=contact.id, assigned_user_id=current_user.id)
    db.add(conversation)
    db.flush()
    db.add_all(
        [
            Message(
                conversation_id=conversation.id,
                content="We need better proposal follow-up.",
                inbound=True,
                is_internal=False,
                conversation_sequence=1,
            ),
            Message(
                conversation_id=conversation.id,
                content="Internal: do not mention discount pressure.",
                inbound=False,
                is_internal=True,
                conversation_sequence=2,
            ),
        ]
    )
    lead = Lead(
        conversation_id=conversation.id,
        name="Marina Costa",
        email="marina@example.com",
        phone="+55 11 99999-1234",
        company="Acme",
        source_channel="whatsapp",
        source_facts={"lead": {"name": "Marina Costa", "company": "Acme"}},
        ai_inferences={"pain_points": [{"value": "proposal follow-up clarity", "confidence": 0.81}]},
        enrichment_status="completed",
        score=82,
        qualification_label="hot",
        score_confidence=0.79,
        score_rationale="Strong commercial signal.",
    )
    db.add(lead)
    db.commit()

    client = _make_client(db, current_user)
    response = client.post(f"/api/v1/leads/{lead.id}/outreach-grounding", json={"channel": "whatsapp"})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["entity_type"] == "lead"
    assert data["entity_id"] == str(lead.id)
    assert data["fallback_mode"] is False
    assert any(item["key"] == "lead.company" for item in data["facts"])
    assert any(item["key"] == "lead.pain_points" for item in data["inferences"])
    rendered = str(data)
    assert "email_hash" not in rendered
    assert "phone_hash" not in rendered
    assert "marina@example.com" not in rendered
    assert "99999" not in rendered
    assert "discount pressure" not in rendered


def test_lead_outreach_grounding_rejects_unsupported_channel(db):
    current_user = _seed_user(db)
    contact = Contact(name="Marina Costa")
    db.add(contact)
    db.flush()
    conversation = Conversation(contact_id=contact.id, assigned_user_id=current_user.id)
    db.add(conversation)
    db.flush()
    lead = Lead(
        conversation_id=conversation.id,
        name="Marina Costa",
        company="Acme",
        source_channel="whatsapp",
    )
    db.add(lead)
    db.commit()

    client = _make_client(db, current_user)
    response = client.post(f"/api/v1/leads/{lead.id}/outreach-grounding", json={"channel": "fax"})

    assert response.status_code == 422
