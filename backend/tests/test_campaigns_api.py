from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.api import api_router
from app.core.auth import get_current_user
from app.core.database import Base, get_db
from app.models.models import (
    AuditLog,
    Client,
    Contact,
    Conversation,
    DefaultRole,
    Lead,
    LeadIdentity,
    LeadScoringConfig,
    Message,
    OutreachCampaign,
    OutreachCampaignLead,
    OutreachSequenceStep,
    Project,
    ProjectStage,
    User,
    UserType,
)


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
        AuditLog.__table__,
        Client.__table__,
        Contact.__table__,
        ProjectStage.__table__,
        Project.__table__,
        Conversation.__table__,
        Message.__table__,
        LeadIdentity.__table__,
        Lead.__table__,
        LeadScoringConfig.__table__,
        OutreachCampaign.__table__,
        OutreachCampaignLead.__table__,
        OutreachSequenceStep.__table__,
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


def _seed_user(
    db,
    *,
    email: str = "operator-api@example.com",
    can_view_all_conversations: bool = False,
    can_change_settings: bool = False,
) -> User:
    user_type = UserType(
        name=f"API Role {email}",
        base_role=DefaultRole.USER,
        is_system=False,
        can_view_all_conversations=can_view_all_conversations,
        can_change_settings=can_change_settings,
    )
    db.add(user_type)
    db.flush()
    user = User(
        auth_id=f"auth-{email}",
        email=email,
        full_name=email.split("@")[0].title(),
        user_type_id=user_type.id,
        is_active=True,
        is_approved=True,
    )
    db.add(user)
    db.flush()
    return user


def _seed_lead(db, *, channel="whatsapp", score=88) -> Lead:
    lead = Lead(
        name="Marina Costa",
        email="marina@example.com",
        phone="+5511999990000",
        company="Acme",
        source_channel=channel,
        score=score,
        qualification_label="hot",
        extraction_confidence={"name": 0.9},
    )
    db.add(lead)
    db.flush()
    return lead


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


def _payload(lead_id: str, owner_id: str):
    return {
        "objective": "Re-engage qualified leads for discovery calls",
        "channel": "whatsapp",
        "cadence": {
            "start_at": "2026-07-09T13:00:00Z",
            "timezone": "America/Sao_Paulo",
            "follow_up_interval_days": 2,
            "planned_steps": 2,
        },
        "owner_user_id": owner_id,
        "lead_ids": [lead_id],
    }


def test_create_campaign_from_selected_lead_returns_summary(db):
    current_user = _seed_user(db)
    lead = _seed_lead(db)
    client = _make_client(db, current_user)

    response = client.post("/api/v1/campaigns", json=_payload(str(lead.id), str(current_user.id)))

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["included_count"] == 1
    assert data["skipped_count"] == 0
    assert data["source_type"] == "lead_selection"
    assert data["owner_user_id"] == str(current_user.id)
    assert data["channel"] == "whatsapp"


def test_create_campaign_requires_authentication(db):
    lead = _seed_lead(db)
    current_user = _seed_user(db)
    client = _make_client(db)

    response = client.post("/api/v1/campaigns", json=_payload(str(lead.id), str(current_user.id)))

    assert response.status_code == 401


def test_create_campaign_rejects_missing_or_mixed_selection_modes(db):
    current_user = _seed_user(db)
    lead = _seed_lead(db)
    client = _make_client(db, current_user)
    payload = _payload(str(lead.id), str(current_user.id))

    missing = dict(payload)
    missing.pop("lead_ids")
    response_missing = client.post("/api/v1/campaigns", json=missing)
    assert response_missing.status_code == 422
    assert "lead_ids" in str(response_missing.json()["detail"])

    mixed = dict(payload)
    mixed["segment_filter"] = {"status": "new"}
    response_mixed = client.post("/api/v1/campaigns", json=mixed)
    assert response_mixed.status_code == 422
    assert "lead_ids" in str(response_mixed.json()["detail"])


def test_create_campaign_requires_cadence(db):
    current_user = _seed_user(db)
    lead = _seed_lead(db)
    client = _make_client(db, current_user)
    payload = _payload(str(lead.id), str(current_user.id))
    payload.pop("cadence")

    response = client.post("/api/v1/campaigns", json=payload)

    assert response.status_code == 422
    assert "cadence" in str(response.json()["detail"])


def test_segment_campaign_requires_manager_permission(db):
    current_user = _seed_user(db)
    client = _make_client(db, current_user)

    response = client.post(
        "/api/v1/campaigns",
        json={
            "objective": "Follow hot leads",
            "channel": "email",
            "cadence": {"planned_steps": 2},
            "owner_user_id": str(current_user.id),
            "segment_filter": {"status": "new", "channel": "email"},
        },
    )

    assert response.status_code == 403
    assert "can_view_all_conversations" in response.json()["detail"]


def test_lead_api_includes_active_campaign_fields_after_launch(db):
    current_user = _seed_user(db)
    lead = _seed_lead(db)
    client = _make_client(db, current_user)
    create_response = client.post("/api/v1/campaigns", json=_payload(str(lead.id), str(current_user.id)))
    assert create_response.status_code == 200

    detail_response = client.get(f"/api/v1/leads/{lead.id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()["data"]
    assert detail["active_sequence_active"] is True
    assert detail["active_campaign_id"] == create_response.json()["data"]["id"]
    assert detail["active_campaign_channel"] == "whatsapp"
    assert detail["active_campaign_status"] == "active"
    assert "email_hash" not in detail
    assert "phone_hash" not in detail

    list_response = client.get("/api/v1/leads")
    row = list_response.json()["data"][0]
    assert row["active_sequence_active"] is True


def test_campaign_detail_requires_campaign_access(db):
    owner = _seed_user(db, email="owner@example.com")
    other = _seed_user(db, email="other@example.com")
    lead = _seed_lead(db)
    owner_client = _make_client(db, owner)
    other_client = _make_client(db, other)
    campaign_id = owner_client.post("/api/v1/campaigns", json=_payload(str(lead.id), str(owner.id))).json()["data"]["id"]

    owner_response = owner_client.get(f"/api/v1/campaigns/{campaign_id}")
    other_response = other_client.get(f"/api/v1/campaigns/{campaign_id}")

    assert owner_response.status_code == 200
    assert owner_response.json()["data"]["id"] == campaign_id
    assert other_response.status_code == 403


def test_campaign_state_pause_resume_stop_endpoints(db):
    current_user = _seed_user(db)
    lead = _seed_lead(db)
    client = _make_client(db, current_user)
    campaign_id = client.post("/api/v1/campaigns", json=_payload(str(lead.id), str(current_user.id))).json()["data"]["id"]
    steps = client.post(f"/api/v1/campaigns/{campaign_id}/steps/generate", json={}).json()["data"]["steps"]

    state_response = client.get(f"/api/v1/campaigns/{campaign_id}/state")
    assert state_response.status_code == 200
    state = state_response.json()["data"]
    assert state["execution_status"] == "active"
    assert state["current_step"]["id"] == steps[0]["id"]
    assert state["next_action"] == "review_step"

    pause_response = client.post(f"/api/v1/campaigns/{campaign_id}/pause", json={"reason": "manual hold"})
    assert pause_response.status_code == 200
    assert pause_response.json()["data"]["execution_status"] == "paused"
    assert pause_response.json()["data"]["next_action"] == "resume_campaign"

    resume_response = client.post(f"/api/v1/campaigns/{campaign_id}/resume", json={})
    assert resume_response.status_code == 200
    assert resume_response.json()["data"]["execution_status"] == "active"

    stop_response = client.post(f"/api/v1/campaigns/{campaign_id}/stop", json={"reason": "done"})
    assert stop_response.status_code == 200
    assert stop_response.json()["data"]["execution_status"] == "stopped"
    assert stop_response.json()["data"]["next_action"] == "none"

    blocked_resume = client.post(f"/api/v1/campaigns/{campaign_id}/resume", json={})
    assert blocked_resume.status_code == 400
    assert "Only paused campaigns" in blocked_resume.json()["detail"]
