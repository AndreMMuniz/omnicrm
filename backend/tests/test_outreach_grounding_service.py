from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.models import (
    AuditLog,
    CatalogCategory,
    CatalogItem,
    ChannelType,
    Client,
    Contact,
    Conversation,
    DefaultRole,
    Lead,
    LeadIdentity,
    Message,
    Project,
    ProjectStage,
    Proposal,
    User,
    UserType,
)
from app.services.outreach_grounding_service import OutreachGroundingService


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
        Proposal.__table__,
        CatalogCategory.__table__,
        CatalogItem.__table__,
        Conversation.__table__,
        Message.__table__,
        LeadIdentity.__table__,
        Lead.__table__,
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


def _seed_user(db, *, email: str = "operator@example.com", can_view_all: bool = False) -> User:
    user_type = UserType(
        name=f"Grounding Role {email}",
        base_role=DefaultRole.USER,
        is_system=False,
        can_view_all_conversations=can_view_all,
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


def _seed_grounded_lead(db, actor: User) -> Lead:
    client = Client(
        name="Acme SA",
        company_name="Acme Industrial",
        country="BR",
        created_by_user_id=actor.id,
    )
    db.add(client)
    db.flush()
    contact = Contact(
        name="Marina Costa",
        email="marina@example.com",
        phone="+5511999990000",
        client_id=client.id,
    )
    db.add(contact)
    db.flush()
    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=actor.id,
        channel=ChannelType.WHATSAPP,
    )
    db.add(conversation)
    db.flush()
    db.add_all(
        [
            Message(
                conversation_id=conversation.id,
                content="We need better proposal follow-up and support queue visibility.",
                inbound=True,
                is_internal=False,
                conversation_sequence=1,
            ),
            Message(
                conversation_id=conversation.id,
                content="Internal: this customer is price sensitive.",
                inbound=False,
                is_internal=True,
                conversation_sequence=2,
            ),
        ]
    )
    identity = LeadIdentity(
        display_name="Marina Costa",
        company="Acme Industrial",
        resolution_status="resolved",
        confidence=0.95,
        match_reasons=["email_hash_match"],
    )
    db.add(identity)
    db.flush()
    lead = Lead(
        conversation_id=conversation.id,
        lead_identity_id=identity.id,
        name="Marina Costa",
        email="marina@example.com",
        phone="+5511999990000",
        company="Acme Industrial",
        source_channel="whatsapp",
        source_facts={
            "lead": {"name": "Marina Costa", "company": "Acme Industrial"},
            "linked_company": {"id": str(client.id), "name": "Acme SA", "country": "BR"},
        },
        ai_inferences={
            "role": {"value": "Operations Manager", "confidence": 0.71, "rationale": "Conversation wording."},
            "pain_points": [{"value": "proposal follow-up clarity", "confidence": 0.82}],
        },
        enrichment_status="completed",
        score=86,
        qualification_label="hot",
        score_confidence=0.8,
        score_rationale="Company and pain-point signals are strong.",
        identity_resolution_status="resolved",
        identity_confidence=0.95,
        identity_match_reasons=["email_hash_match"],
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


def test_grounding_includes_attributed_sources_and_excludes_sensitive_internal_context(db):
    actor = _seed_user(db)
    lead = _seed_grounded_lead(db, actor)

    result = OutreachGroundingService(db).build_for_lead(
        actor=actor,
        lead_id=lead.id,
        channel="whatsapp",
    )

    assert result["entity_type"] == "lead"
    assert result["entity_id"] == str(lead.id)
    assert result["scope"] == "lead_outreach"
    assert result["fallback_mode"] is False
    assert any(item["key"] == "lead.company" for item in result["facts"])
    assert any(item["key"] == "lead.score" and item["value"] == 86 for item in result["facts"])
    assert any(item["key"] == "lead.pain_points" for item in result["inferences"])
    assert all({"source_type", "source_id", "source_field"}.issubset(item) for item in result["citations"])
    rendered = str(result)
    assert "email_hash" not in rendered
    assert "phone_hash" not in rendered
    assert "marina@example.com" not in rendered
    assert "+5511999990000" not in rendered
    assert "price sensitive" not in rendered
    assert "proposal follow-up" in rendered


def test_grounding_degrades_to_fallback_with_omissions_for_sparse_context(db):
    actor = _seed_user(db)
    lead = Lead(name="Sparse Lead", company=None, source_channel="email")
    db.add(lead)
    db.commit()
    db.refresh(lead)

    result = OutreachGroundingService(db).build_for_lead(actor=actor, lead_id=lead.id, channel="email")

    assert result["fallback_mode"] is True
    assert result["prompt_inputs"]["generation_instruction"] == "use neutral outreach, no unsupported claims"
    omission_reasons = {item["reason"] for item in result["omitted_sources"]}
    assert {"not_enriched", "not_scored", "not_linked"}.issubset(omission_reasons)


def test_grounding_rejects_unassigned_conversation_without_manager_permission(db):
    owner = _seed_user(db, email="owner@example.com")
    other = _seed_user(db, email="other@example.com")
    manager = _seed_user(db, email="manager@example.com", can_view_all=True)
    lead = _seed_grounded_lead(db, owner)

    with pytest.raises(PermissionError):
        OutreachGroundingService(db).build_for_lead(actor=other, lead_id=lead.id, channel="whatsapp")

    result = OutreachGroundingService(db).build_for_lead(actor=manager, lead_id=lead.id, channel="whatsapp")
    assert result["fallback_mode"] is False


def test_ai_engine_graphs_do_not_import_orm_for_grounding():
    graph_dir = Path(__file__).resolve().parents[1] / "app" / "ai_engine" / "graphs"
    forbidden = ["app.models", "app.core.database", "sqlalchemy", "outreach_grounding_service"]
    offenders: list[str] = []
    for file_path in graph_dir.glob("*.py"):
        content = file_path.read_text(encoding="utf-8")
        if any(token in content for token in forbidden):
            offenders.append(file_path.name)

    assert offenders == []
