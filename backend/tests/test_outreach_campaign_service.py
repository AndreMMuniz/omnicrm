from __future__ import annotations

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.models import (
    AuditLog,
    ChannelType,
    Client,
    Contact,
    Conversation,
    DefaultRole,
    DeliveryStatus,
    Lead,
    LeadIdentity,
    Message,
    OutreachCampaign,
    OutreachCampaignLead,
    OutreachSequenceStep,
    Project,
    ProjectStage,
    User,
    UserType,
)
from app.services.outreach_campaign_service import OutreachCampaignService


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
        LeadIdentity.__table__,
        Lead.__table__,
        OutreachCampaign.__table__,
        OutreachCampaignLead.__table__,
        OutreachSequenceStep.__table__,
        Message.__table__,
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
    email: str = "operator@example.com",
    *,
    can_view_all_conversations: bool = False,
    can_change_settings: bool = False,
    is_active: bool = True,
) -> User:
    user_type = UserType(
        name=f"Role {email}",
        base_role=DefaultRole.ADMIN if can_change_settings else DefaultRole.USER,
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
        is_active=is_active,
        is_approved=True,
    )
    db.add(user)
    db.flush()
    return user


def _seed_lead(
    db,
    name: str,
    *,
    channel: str = "whatsapp",
    status: str = "new",
    qualification_label: str | None = None,
    score: int | None = None,
    phone: str | None = "+5511999990000",
    role: str | None = None,
    score_rationale: str | None = None,
) -> Lead:
    lead = Lead(
        name=name,
        email=f"{name.lower().replace(' ', '.')}@example.com",
        phone=phone,
        company="Acme",
        source_channel=channel,
        status=status,
        qualification_label=qualification_label,
        score=score,
        role=role,
        score_rationale=score_rationale,
    )
    db.add(lead)
    db.flush()
    return lead


def test_launch_selected_leads_persists_campaign_memberships_and_audit(db):
    actor = _seed_user(db)
    lead_one = _seed_lead(db, "Marina Costa")
    lead_two = _seed_lead(db, "Pedro Silva")
    db.commit()

    result = OutreachCampaignService(db).launch_campaign(
        actor=actor,
        objective="Re-engage qualified leads",
        channel="whatsapp",
        cadence={"timezone": "America/Sao_Paulo", "follow_up_interval_days": 2, "planned_steps": 2},
        owner_user_id=actor.id,
        lead_ids=[lead_one.id, lead_two.id],
    )

    assert result.included_count == 2
    assert result.skipped_count == 0
    assert result.campaign.status == "active"
    assert result.campaign.source_type == "lead_selection"
    assert result.campaign.owner_user_id == actor.id

    memberships = db.query(OutreachCampaignLead).filter_by(campaign_id=result.campaign.id).all()
    assert {membership.lead_id for membership in memberships} == {lead_one.id, lead_two.id}
    assert all(membership.status == "active" for membership in memberships)

    audit = db.query(AuditLog).filter(AuditLog.action == "launch_outreach_campaign").one()
    assert audit.resource_type == "outreach_campaign"
    assert audit.resource_id == str(result.campaign.id)
    assert audit.details["included_count"] == 2
    assert audit.details["skipped_count"] == 0
    assert "marina@example.com" not in str(audit.details).lower()


def test_segment_launch_requires_elevated_permission(db):
    actor = _seed_user(db)
    owner = _seed_user(db, "owner@example.com")
    _seed_lead(db, "Hot Lead", channel="email", qualification_label="hot", score=90)
    db.commit()

    with pytest.raises(PermissionError, match="segment"):
        OutreachCampaignService(db).launch_campaign(
            actor=actor,
            objective="Follow up hot leads",
            channel="email",
            cadence={"timezone": "America/Sao_Paulo", "follow_up_interval_days": 3},
            owner_user_id=owner.id,
            segment_filter={"channel": "email", "qualification_label": "hot", "min_score": 80},
        )


def test_segment_launch_resolves_allowed_filters_and_stores_filter_summary(db):
    manager = _seed_user(db, can_view_all_conversations=True)
    matching = _seed_lead(db, "Hot Lead", channel="email", qualification_label="hot", score=90)
    _seed_lead(db, "Cold Lead", channel="email", qualification_label="cold", score=20)
    _seed_lead(db, "WhatsApp Lead", channel="whatsapp", qualification_label="hot", score=90)
    db.commit()

    result = OutreachCampaignService(db).launch_campaign(
        actor=manager,
        objective="Follow up hot email leads",
        channel="email",
        cadence={"timezone": "America/Sao_Paulo", "follow_up_interval_days": 3},
        owner_user_id=manager.id,
        segment_filter={"channel": "email", "qualification_label": "hot", "min_score": 80},
    )

    assert result.included_count == 1
    assert result.campaign.source_type == "lead_segment"
    assert result.campaign.source_filter == {"channel": "email", "qualification_label": "hot", "min_score": 80}
    membership = db.query(OutreachCampaignLead).one()
    assert membership.lead_id == matching.id


def test_duplicate_active_membership_rejects_empty_campaign(db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Marina Costa")
    db.commit()

    first = OutreachCampaignService(db).launch_campaign(
        actor=actor,
        objective="Initial campaign",
        channel="whatsapp",
        cadence={"timezone": "America/Sao_Paulo"},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    )
    with pytest.raises(ValueError, match="No leads available"):
        OutreachCampaignService(db).launch_campaign(
            actor=actor,
            objective="Duplicate campaign",
            channel="whatsapp",
            cadence={"timezone": "America/Sao_Paulo"},
            owner_user_id=actor.id,
            lead_ids=[lead.id],
        )

    assert first.included_count == 1
    assert db.query(OutreachCampaignLead).filter_by(lead_id=lead.id, status="active").count() == 1
    assert db.query(OutreachCampaign).count() == 1


def test_launch_rejects_inactive_owner(db):
    actor = _seed_user(db)
    inactive_owner = _seed_user(db, "inactive@example.com", is_active=False)
    lead = _seed_lead(db, "Marina Costa")
    db.commit()

    with pytest.raises(ValueError, match="owner"):
        OutreachCampaignService(db).launch_campaign(
            actor=actor,
            objective="Re-engage",
            channel="whatsapp",
            cadence={"timezone": "America/Sao_Paulo"},
            owner_user_id=inactive_owner.id,
            lead_ids=[lead.id],
        )


def test_launch_rejects_unknown_segment_filter_key(db):
    manager = _seed_user(db, can_view_all_conversations=True)
    db.commit()

    with pytest.raises(ValueError, match="Unsupported segment filter"):
        OutreachCampaignService(db).launch_campaign(
            actor=manager,
            objective="Bad filter",
            channel="email",
            cadence={"timezone": "America/Sao_Paulo"},
            owner_user_id=manager.id,
            segment_filter={"email_hash": "must-not-be-queryable"},
        )


def test_launch_rejects_empty_selection_mode(db):
    actor = _seed_user(db)
    db.commit()

    with pytest.raises(ValueError, match="lead_ids or segment_filter"):
        OutreachCampaignService(db).launch_campaign(
            actor=actor,
            objective="No target",
            channel="whatsapp",
            cadence={"timezone": "America/Sao_Paulo"},
            owner_user_id=actor.id,
        )


def test_launch_rejects_unbounded_planned_step_count(db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Cadence Lead")
    db.commit()

    with pytest.raises(ValueError, match="planned_steps"):
        OutreachCampaignService(db).launch_campaign(
            actor=actor,
            objective="Too many touches",
            channel="whatsapp",
            cadence={"timezone": "America/Sao_Paulo", "planned_steps": 99},
            owner_user_id=actor.id,
            lead_ids=[lead.id],
        )


def test_state_controls_pause_resume_stop_and_audit(db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "State Lead", channel="whatsapp")
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="Inspect sequence state",
        channel="whatsapp",
        cadence={"planned_steps": 2},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign
    steps = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)

    state = service.inspect_state(campaign.id)
    assert state["execution_status"] == "active"
    assert state["current_step"]["id"] == str(steps[0].id)
    assert state["last_action"]["action"] == "generated"
    assert state["next_action"] == "review_step"

    paused = service.pause_campaign(actor=actor, campaign_id=campaign.id, reason="operator pause")
    assert paused["execution_status"] == "paused"
    assert paused["next_action"] == "resume_campaign"

    resumed = service.resume_campaign(actor=actor, campaign_id=campaign.id, reason="operator resume")
    assert resumed["execution_status"] == "active"
    assert resumed["next_action"] == "review_step"

    stopped = service.stop_campaign(actor=actor, campaign_id=campaign.id, reason="no longer needed")
    assert stopped["execution_status"] == "stopped"
    assert stopped["next_action"] == "none"
    assert {step.status for step in steps} == {"cancelled"}

    audit_entries = db.query(AuditLog).order_by(AuditLog.created_at).all()
    actions = [row.action for row in audit_entries]
    assert "pause_outreach_campaign" in actions
    assert "resume_outreach_campaign" in actions
    assert "stop_outreach_campaign" in actions
    stop_log = next(row for row in audit_entries if row.action == "stop_outreach_campaign")
    assert stop_log.details["previous_status"] == "active"
    assert stop_log.details["new_status"] == "stopped"


def test_recovery_preserves_committed_steps_and_reopens_uncommitted_send(db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Recovery Lead", channel="whatsapp")
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="Recover without duplicates",
        channel="whatsapp",
        cadence={"planned_steps": 2},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign
    first, second = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)
    first.status = "sent"
    first.committed_at = first.created_at
    second.status = "sending"
    second.reviewed_content = "Approved draft"
    second.started_at = second.created_at
    db.commit()

    recovered = service.recover_sequence(campaign_id=campaign.id)
    db.refresh(first)
    db.refresh(second)

    assert recovered == 1
    assert first.status == "sent"
    assert second.status == "approved"
    assert second.started_at is None
    state = service.inspect_state(campaign.id)
    assert state["current_step"]["id"] == str(second.id)
    assert state["next_action"] == "send_step"


def test_generate_sequence_steps_honors_planned_step_count_and_context(db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Context Lead", role="operations lead", score=91, score_rationale="High urgency")
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="Book discovery call",
        channel="whatsapp",
        cadence={"planned_steps": 4},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign

    steps = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)

    assert [step.position for step in steps] == [1, 2, 3, 4]
    assert [step.step_type for step in steps] == ["initial_outreach", "follow_up", "follow_up", "follow_up"]
    assert "operations lead" in steps[0].generated_content
    assert steps[0].generation_metadata["missing_context"] is False


def test_review_and_skip_reject_terminal_steps(db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Terminal Lead")
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="Protect terminal state",
        channel="whatsapp",
        cadence={"planned_steps": 1},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign
    step = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)[0]
    step.status = "sent"
    db.commit()

    with pytest.raises(ValueError, match="Terminal"):
        service.review_step(actor=actor, step_id=step.id, reviewed_content="Edit after send", approve=True)
    with pytest.raises(ValueError, match="cannot be skipped"):
        service.skip_step(actor=actor, step_id=step.id, reason="operator")


@pytest.mark.asyncio
async def test_send_exception_marks_step_and_campaign_failed(monkeypatch, db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Exception Lead")
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="Catch send exception",
        channel="whatsapp",
        cadence={"planned_steps": 1},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign
    step = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)[0]
    approved = service.review_step(actor=actor, step_id=step.id, reviewed_content="Approved", approve=True)

    async def fake_send(self, **kwargs):
        raise RuntimeError("provider offline")

    monkeypatch.setattr("app.services.message_service.MessageService.send_from_dashboard", fake_send)

    with pytest.raises(ValueError, match="Failed to send"):
        await service.send_step(actor=actor, step_id=approved.id)

    db.refresh(approved)
    db.refresh(campaign)
    assert approved.status == "failed"
    assert approved.failure_reason == "provider offline"
    assert campaign.status == "failed"


@pytest.mark.asyncio
async def test_failed_delivery_marks_campaign_failed(monkeypatch, db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Failed Delivery Lead")
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="Mirror failed delivery",
        channel="whatsapp",
        cadence={"planned_steps": 1},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign
    step = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)[0]
    approved = service.review_step(actor=actor, step_id=step.id, reviewed_content="Approved", approve=True)

    async def fake_failed_send(self, conversation, content, owner_id=None, message_type="TEXT", image=None, file=None, idempotency_key=None):
        message = Message(
            conversation_id=conversation.id,
            content=content,
            inbound=False,
            owner_id=owner_id,
            delivery_status=DeliveryStatus.FAILED,
            delivery_error="channel rejected",
            idempotency_key=idempotency_key,
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return message

    monkeypatch.setattr("app.services.message_service.MessageService.send_from_dashboard", fake_failed_send)

    sent = await service.send_step(actor=actor, step_id=approved.id)

    db.refresh(campaign)
    assert sent.status == "failed"
    assert sent.failure_reason == "channel rejected"
    assert campaign.status == "failed"


@pytest.mark.asyncio
async def test_send_uses_channel_matching_conversation(monkeypatch, db):
    actor = _seed_user(db)
    contact = Contact(name="Existing Chat", phone="+5511888880000")
    db.add(contact)
    db.flush()
    existing_conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=actor.id,
        channel=ChannelType.WHATSAPP,
    )
    db.add(existing_conversation)
    db.flush()
    lead = _seed_lead(db, "Email Lead", channel="email", phone="+5511888880000")
    lead.conversation_id = existing_conversation.id
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="Use email channel",
        channel="email",
        cadence={"planned_steps": 1},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign
    step = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)[0]
    approved = service.review_step(actor=actor, step_id=step.id, reviewed_content="Approved email", approve=True)
    sent_channels: list[ChannelType] = []

    async def fake_sent_send(self, conversation, content, owner_id=None, message_type="TEXT", image=None, file=None, idempotency_key=None):
        sent_channels.append(conversation.channel)
        message = Message(
            conversation_id=conversation.id,
            content=content,
            inbound=False,
            owner_id=owner_id,
            delivery_status=DeliveryStatus.SENT,
            idempotency_key=idempotency_key,
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return message

    monkeypatch.setattr("app.services.message_service.MessageService.send_from_dashboard", fake_sent_send)

    sent = await service.send_step(actor=actor, step_id=approved.id)

    db.refresh(lead)
    assert sent.status == "sent"
    assert sent_channels == [ChannelType.EMAIL]
    assert lead.conversation_id != existing_conversation.id


@pytest.mark.asyncio
async def test_missing_recipient_is_skipped_before_delivery(monkeypatch, db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Missing Phone Lead", phone=None)
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="Skip missing recipient",
        channel="whatsapp",
        cadence={"planned_steps": 1},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign
    step = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)[0]
    approved = service.review_step(actor=actor, step_id=step.id, reviewed_content="Approved", approve=True)

    async def unexpected_send(self, **kwargs):
        raise AssertionError("send should not be called")

    monkeypatch.setattr("app.services.message_service.MessageService.send_from_dashboard", unexpected_send)

    skipped = await service.send_step(actor=actor, step_id=approved.id)

    assert skipped.status == "skipped"
    assert skipped.skip_reason == "missing_phone"


@pytest.mark.asyncio
async def test_follow_up_cannot_send_before_prior_step_completes(monkeypatch, db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Ordered Lead")
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="Respect order",
        channel="whatsapp",
        cadence={"planned_steps": 2},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign
    first, second = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)
    service.review_step(actor=actor, step_id=second.id, reviewed_content="Follow-up", approve=True)

    with pytest.raises(ValueError, match="Previous sequence steps"):
        await service.send_step(actor=actor, step_id=second.id)

    db.refresh(first)
    db.refresh(second)
    assert first.status == "needs_review"
    assert second.status == "approved"


@pytest.mark.asyncio
async def test_completed_campaign_releases_membership_for_relaunch(monkeypatch, db):
    actor = _seed_user(db)
    lead = _seed_lead(db, "Relaunch Lead")
    service = OutreachCampaignService(db)
    campaign = service.launch_campaign(
        actor=actor,
        objective="First run",
        channel="whatsapp",
        cadence={"planned_steps": 1},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    ).campaign
    step = service.generate_sequence_steps(actor=actor, campaign_id=campaign.id)[0]
    approved = service.review_step(actor=actor, step_id=step.id, reviewed_content="Approved", approve=True)

    async def fake_sent_send(self, conversation, content, owner_id=None, message_type="TEXT", image=None, file=None, idempotency_key=None):
        message = Message(
            conversation_id=conversation.id,
            content=content,
            inbound=False,
            owner_id=owner_id,
            delivery_status=DeliveryStatus.SENT,
            idempotency_key=idempotency_key,
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return message

    monkeypatch.setattr("app.services.message_service.MessageService.send_from_dashboard", fake_sent_send)

    await service.send_step(actor=actor, step_id=approved.id)
    db.refresh(campaign)
    membership = db.query(OutreachCampaignLead).filter_by(campaign_id=campaign.id).one()
    assert campaign.status == "completed"
    assert membership.status == "completed"

    relaunch = service.launch_campaign(
        actor=actor,
        objective="Second run",
        channel="whatsapp",
        cadence={"planned_steps": 1},
        owner_user_id=actor.id,
        lead_ids=[lead.id],
    )
    assert relaunch.included_count == 1
