from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.models import Lead
from app.models.models import Client, Contact, Conversation, LeadScoringConfig, Message, Project, ProjectStage, User, UserType
from app.services.lead_scoring_service import DEFAULT_SCORING_CONFIG, LeadScoringService


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


def test_scoring_service_calculates_score_label_and_breakdown(db):
    lead = Lead(
        name="Marina Costa",
        company="Acme",
        email="marina@example.com",
        phone="+55 11 99999-1234",
        source_channel="whatsapp",
        extraction_confidence={"name": 0.9, "company": 0.8},
        duplicate_risk=False,
    )
    db.add(lead)
    db.commit()

    result = LeadScoringService(db).score_lead(lead.id)

    assert result.score is not None
    assert 0 <= result.score <= 100
    assert result.qualification_label in {"cold", "warm", "hot"}
    assert result.score_confidence >= DEFAULT_SCORING_CONFIG.low_confidence_threshold
    assert result.low_confidence is False
    assert any(item["component"] == "identity_completeness" for item in result.score_breakdown)

    db.refresh(lead)
    assert lead.score == result.score
    assert lead.qualification_label == result.qualification_label
    assert lead.scored_at is not None


def test_scoring_service_marks_missing_data_as_low_confidence(db):
    lead = Lead(
        source_channel="email",
        extraction_confidence={},
        extraction_error=True,
        duplicate_risk=True,
    )
    db.add(lead)
    db.commit()

    result = LeadScoringService(db).score_lead(lead.id)

    assert result.low_confidence is True
    assert result.qualification_label == "low_confidence"
    assert result.score_confidence < DEFAULT_SCORING_CONFIG.low_confidence_threshold
    assert "missing" in result.score_rationale.lower()


def test_scoring_service_marks_blank_lead_as_low_confidence(db):
    lead = Lead(source_channel="email", extraction_confidence={}, duplicate_risk=False)
    db.add(lead)
    db.commit()

    result = LeadScoringService(db).score_lead(lead.id)

    assert result.low_confidence is True
    assert result.qualification_label == "low_confidence"
    assert result.score_confidence < DEFAULT_SCORING_CONFIG.low_confidence_threshold


def test_scoring_service_uses_configured_thresholds_without_code_changes(db):
    lead = Lead(
        name="Qualified Lead",
        company="Acme",
        source_channel="whatsapp",
        extraction_confidence={"name": 0.8, "company": 0.8},
    )
    db.add(lead)
    db.commit()

    service = LeadScoringService(db)
    service.save_config(
        {
            "version": "test-strict",
            "thresholds": {"hot": 101, "warm": 101, "cold": 0},
            "low_confidence_threshold": 0.1,
            "components": {
                "identity_completeness": 20,
                "company_fit": 20,
                "pain_point_fit": 30,
                "engagement_signal": 20,
                "duplicate_risk": -10,
            },
        }
    )

    result = service.score_lead(lead.id)

    assert result.scoring_version == "test-strict"
    assert result.qualification_label == "cold"


def test_scoring_service_rejects_invalid_config(db):
    service = LeadScoringService(db)

    try:
        service.save_config({"version": "bad", "thresholds": {"hot": 80}})
    except ValueError as exc:
        assert "thresholds" in str(exc)
    else:
        raise AssertionError("Expected invalid config to raise ValueError")

    try:
        service.save_config(
            {
                "version": "bad-low-confidence",
                "thresholds": {"hot": 80, "warm": 50, "cold": 0},
                "low_confidence_threshold": None,
                "components": {
                    "identity_completeness": 20,
                    "company_fit": 20,
                    "pain_point_fit": 30,
                    "engagement_signal": 20,
                    "duplicate_risk": -10,
                },
            }
        )
    except ValueError as exc:
        assert "low_confidence_threshold" in str(exc)
    else:
        raise AssertionError("Expected invalid low-confidence threshold to raise ValueError")

    try:
        service.score_lead(uuid4())
    except ValueError as exc:
        assert "Lead not found" in str(exc)
    else:
        raise AssertionError("Expected missing lead to raise ValueError")
