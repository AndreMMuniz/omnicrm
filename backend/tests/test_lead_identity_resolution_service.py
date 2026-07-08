from unittest.mock import patch
from uuid import UUID

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.ai_engine.adapters.sqlalchemy_adapter import SQLAlchemyLeadAdapter
from app.core.database import Base
from app.models.models import ChannelType, Client, Contact, Conversation, Lead, LeadIdentity, Project, ProjectStage, User, UserType
from app.services.lead_enrichment_service import LeadEnrichmentService
from app.services.lead_identity_resolution_service import LeadIdentityResolutionService


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
        ProjectStage.__table__,
        Project.__table__,
        Conversation.__table__,
        LeadIdentity.__table__,
        Lead.__table__,
    ]
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        Base.metadata.drop_all(bind=connection, tables=tables)
        Base.metadata.create_all(bind=connection, tables=tables)
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")


def _session():
    _reset_schema()
    return TestingSessionLocal()


def test_exact_email_hash_attaches_repeated_capture_to_existing_identity():
    db = _session()
    try:
        first = Lead(
            name="Marina Costa",
            email="marina@example.com",
            company="Acme",
            source_channel="whatsapp",
        )
        second = Lead(
            name="Marina C.",
            email="MARINA@example.com",
            company="Acme",
            source_channel="email",
        )
        db.add_all([first, second])
        db.commit()

        service = LeadIdentityResolutionService(db)
        first_result = service.resolve_for_lead(first.id)
        second_result = service.resolve_for_lead(second.id)

        assert first_result.status == "resolved"
        assert second_result.status == "resolved"
        assert second_result.lead_identity_id == first_result.lead_identity_id

        db.refresh(second)
        assert second.lead_identity_id == first.lead_identity_id
        assert second.identity_review_required is False
        assert "email_hash_match" in second.identity_match_reasons
    finally:
        db.close()
        _reset_schema()


def test_exact_phone_hash_attaches_to_existing_identity():
    db = _session()
    try:
        first = Lead(
            name="Pedro Silva",
            phone="+55 11 99999-0000",
            company="Beta",
            source_channel="whatsapp",
        )
        second = Lead(
            name="Pedro Silva",
            phone="5511999990000",
            company="Beta",
            source_channel="sms",
        )
        db.add_all([first, second])
        db.commit()

        service = LeadIdentityResolutionService(db)
        first_result = service.resolve_for_lead(first.id)
        second_result = service.resolve_for_lead(second.id)

        assert second_result.lead_identity_id == first_result.lead_identity_id
        assert "phone_hash_match" in second.identity_match_reasons
    finally:
        db.close()
        _reset_schema()


def test_name_company_only_match_is_flagged_for_review():
    db = _session()
    try:
        identity = LeadIdentity(
            display_name="Marina Costa",
            company="Acme",
            normalized_name="marina costa",
            normalized_company="acme",
            resolution_status="resolved",
            confidence=0.92,
            match_reasons=["seed"],
        )
        lead = Lead(
            name="Marina Costa",
            company="Acme",
            source_channel="web",
        )
        db.add_all([identity, lead])
        db.commit()

        result = LeadIdentityResolutionService(db).resolve_for_lead(lead.id)

        assert result.status == "ambiguous"
        assert result.lead_identity_id is None
        assert result.review_required is True

        db.refresh(lead)
        assert lead.lead_identity_id is None
        assert lead.identity_resolution_status == "ambiguous"
        assert lead.identity_review_required is True
        assert lead.identity_candidates[0]["lead_identity_id"] == str(identity.id)
        assert "normalized_name_company_match" in lead.identity_match_reasons
    finally:
        db.close()
        _reset_schema()


def test_conflicting_exact_email_and_phone_matches_are_flagged_for_review():
    db = _session()
    try:
        email_identity = LeadIdentity(
            display_name="Marina Email",
            company="Acme",
            email_hash="email-hash",
            normalized_name="marina email",
            normalized_company="acme",
            resolution_status="resolved",
            confidence=0.95,
            match_reasons=["email_hash_match"],
        )
        phone_identity = LeadIdentity(
            display_name="Marina Phone",
            company="Acme",
            phone_hash="phone-hash",
            normalized_name="marina phone",
            normalized_company="acme",
            resolution_status="resolved",
            confidence=0.95,
            match_reasons=["phone_hash_match"],
        )
        lead = Lead(
            name="Marina Costa",
            company="Acme",
            email_hash="email-hash",
            phone_hash="phone-hash",
            source_channel="whatsapp",
        )
        db.add_all([email_identity, phone_identity, lead])
        db.commit()

        result = LeadIdentityResolutionService(db).resolve_for_lead(lead.id)

        assert result.status == "ambiguous"
        assert result.lead_identity_id is None
        assert result.review_required is True
        assert "conflicting_exact_identifier_match" in result.match_reasons
        assert {candidate["lead_identity_id"] for candidate in result.candidates} == {
            str(email_identity.id),
            str(phone_identity.id),
        }

        db.refresh(lead)
        assert lead.lead_identity_id is None
        assert lead.identity_resolution_status == "ambiguous"
        assert lead.identity_review_required is True
    finally:
        db.close()
        _reset_schema()


def test_adapter_logs_and_rolls_back_when_identity_resolution_fails(caplog):
    db = _session()
    try:
        contact = Contact(name="Marina Costa", channel_identifier="marina@example.com")
        conversation = Conversation(contact=contact, channel=ChannelType.WHATSAPP)
        db.add_all([contact, conversation])
        db.commit()

        adapter = SQLAlchemyLeadAdapter(db)

        with (
            patch.object(
                LeadIdentityResolutionService,
                "resolve_for_lead",
                side_effect=RuntimeError("identity store unavailable"),
            ),
            patch.object(LeadEnrichmentService, "enrich_lead", return_value=None),
            patch.object(db, "rollback", wraps=db.rollback) as rollback,
            caplog.at_level("ERROR", logger="app.ai_engine.adapters.sqlalchemy_adapter"),
        ):
            lead_id = adapter.create_lead(
                conversation_id=conversation.id,
                channel="whatsapp",
                entities={"name": "Marina Costa", "email": "marina@example.com"},
                confidence={"name": 0.9, "email": 0.9},
            )

        assert lead_id
        assert rollback.called
        assert "Lead identity resolution failed after lead creation" in caplog.text

        stored = db.query(Lead).filter(Lead.id == UUID(lead_id)).first()
        assert stored is not None
        assert stored.identity_resolution_status == "unresolved"
    finally:
        db.close()
        _reset_schema()
