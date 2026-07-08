from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.api import api_router
from app.core.database import Base
from app.core.database import get_db
from app.models.models import Client, Contact, Conversation, Lead, LeadIdentity, LeadScoringConfig, Message, Project, ProjectStage, User, UserType


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
        Conversation.__table__,
        Message.__table__,
        LeadIdentity.__table__,
        Lead.__table__,
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


def _make_client(db) -> TestClient:
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
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

    client = _make_client(db)
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

    client = _make_client(db)
    response = client.post(f"/api/v1/leads/{lead.id}/score")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["score"] is not None
    assert data["qualification_label"] in {"cold", "warm", "hot"}
    assert data["score_breakdown"]

    db.refresh(lead)
    assert lead.score == data["score"]


def test_scoring_config_endpoint_validates_and_changes_thresholds(db):
    client = _make_client(db)

    bad_response = client.patch(
        "/api/v1/leads/scoring/config",
        json={"version": "bad", "thresholds": {"hot": 90}},
    )
    assert bad_response.status_code == 400

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
