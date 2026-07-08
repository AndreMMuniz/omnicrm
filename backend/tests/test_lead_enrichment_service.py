from uuid import uuid4

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.models import ChannelType, Client, Contact, Conversation, Lead, LeadIdentity, Message, Project, ProjectStage, User, UserType
from app.services.lead_enrichment_service import LeadEnrichmentService


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


def _session():
    _reset_schema()
    session = TestingSessionLocal()
    try:
        return session
    except Exception:
        session.close()
        raise


def _seed_lead(db):
    contact = Contact(name="Marina Costa", email="marina@example.com", channel_identifier="@marina")
    db.add(contact)
    db.flush()

    conversation = Conversation(contact_id=contact.id, channel=ChannelType.WHATSAPP)
    db.add(conversation)
    db.flush()

    db.add_all(
        [
            Message(
                conversation_id=conversation.id,
                content="I manage operations and our support queue is fragmented.",
                inbound=True,
                conversation_sequence=1,
            ),
            Message(
                conversation_id=conversation.id,
                content="We need better follow-up visibility before buying.",
                inbound=True,
                conversation_sequence=2,
            ),
        ]
    )
    lead = Lead(
        conversation_id=conversation.id,
        name="Marina Costa",
        email="marina@example.com",
        company="Acme",
        source_channel="whatsapp",
        extraction_confidence={"name": 0.9, "email": 0.88, "company": 0.7},
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


def test_enrich_lead_persists_facts_and_ai_inferences():
    db = _session()
    try:
        lead = _seed_lead(db)
        result = {
            "role": {"value": "Operations Manager", "confidence": 0.76, "rationale": "Mentions managing operations."},
            "pain_points": [
                {"value": "fragmented support queue", "confidence": 0.84, "rationale": "Stated directly."}
            ],
            "qualification_notes": "Evaluating support operations improvements.",
        }

        enriched = LeadEnrichmentService(db, enrichment_provider=lambda context: result).enrich_lead(lead.id)

        assert enriched.role == "Operations Manager"
        assert enriched.pain_points == ["fragmented support queue"]
        assert enriched.qualification_notes == "Evaluating support operations improvements."
        assert enriched.enrichment_status == "completed"
        assert enriched.enrichment_error is None
        assert enriched.enriched_at is not None
        assert enriched.source_facts["lead"]["company"] == "Acme"
        assert enriched.source_facts["contact"]["name"] == "Marina Costa"
        assert "channel_identifier" not in enriched.source_facts["contact"]
        assert enriched.ai_inferences["role"]["value"] == "Operations Manager"
        assert enriched.ai_inferences["pain_points"][0]["value"] == "fragmented support queue"
    finally:
        db.close()
        _reset_schema()


def test_enrich_lead_failure_marks_failed_without_deleting_lead():
    db = _session()
    try:
        lead = _seed_lead(db)

        def fail(context):
            raise RuntimeError("LLM provider unavailable with sensitive trace")

        enriched = LeadEnrichmentService(db, enrichment_provider=fail).enrich_lead(lead.id)

        assert enriched.id == lead.id
        assert enriched.enrichment_status == "failed"
        assert enriched.enrichment_error == "Lead enrichment failed. Check server logs for diagnostic details."
        assert "sensitive trace" not in enriched.enrichment_error
        assert db.query(Lead).filter(Lead.id == lead.id).first() is not None
    finally:
        db.close()
        _reset_schema()


def test_enrich_lead_caps_and_deduplicates_provider_pain_points():
    db = _session()
    try:
        lead = _seed_lead(db)
        result = {
            "pain_points": [
                {"value": "Queue visibility", "confidence": 0.7},
                {"value": "queue visibility", "confidence": 0.8},
                {"value": "Follow-up tracking", "confidence": 0.7},
                {"value": "Proposal clarity", "confidence": 0.7},
                {"value": "Response handoff", "confidence": 0.7},
                {"value": "Channel fragmentation", "confidence": 0.7},
                {"value": "Extra ignored", "confidence": 0.7},
            ],
        }

        enriched = LeadEnrichmentService(db, enrichment_provider=lambda context: result).enrich_lead(lead.id)

        assert enriched.pain_points == [
            "Queue visibility",
            "Follow-up tracking",
            "Proposal clarity",
            "Response handoff",
            "Channel fragmentation",
        ]
        assert len(enriched.ai_inferences["pain_points"]) == 5
    finally:
        db.close()
        _reset_schema()


def test_enrich_missing_lead_raises_lookup_error():
    db = _session()
    try:
        try:
            LeadEnrichmentService(db, enrichment_provider=lambda context: {}).enrich_lead(uuid4())
        except LookupError as exc:
            assert "Lead not found" in str(exc)
        else:
            raise AssertionError("Expected LookupError")
    finally:
        db.close()
        _reset_schema()
