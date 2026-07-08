from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import (
    ChannelType,
    Contact,
    Conversation,
    DeliveryStatus,
    Lead,
    LeadStatus,
    OutreachCampaign,
    OutreachCampaignLead,
    OutreachCampaignLeadStatus,
    OutreachCampaignSourceType,
    OutreachCampaignStatus,
    OutreachSequenceStep,
    OutreachSequenceStepStatus,
    OutreachSequenceStepType,
    User,
)
from app.services.audit_service import log_action
from app.services.message_service import MessageService


ACTIVE_CAMPAIGN_STATUSES = {
    OutreachCampaignStatus.ACTIVE.value,
    OutreachCampaignStatus.DRAFT.value,
    OutreachCampaignStatus.PAUSED.value,
    OutreachCampaignStatus.FAILED.value,
}
ACTIVE_MEMBERSHIP_STATUSES = {OutreachCampaignLeadStatus.ACTIVE.value}
SUPPORTED_CHANNELS = {"whatsapp", "telegram", "email", "sms"}
GENERATABLE_CHANNELS = {"whatsapp", "telegram", "email"}
SEGMENT_FILTER_FIELDS = {"status", "channel", "qualification_label", "min_score"}
MIN_PLANNED_STEPS = 1
MAX_PLANNED_STEPS = 8
MIN_FOLLOW_UP_INTERVAL_DAYS = 0
MAX_FOLLOW_UP_INTERVAL_DAYS = 365


@dataclass(frozen=True)
class SkippedLead:
    lead_id: str
    reason: str

    def to_dict(self) -> dict[str, str]:
        return {"lead_id": self.lead_id, "reason": self.reason}


@dataclass(frozen=True)
class CampaignLaunchResult:
    campaign: OutreachCampaign
    included_count: int
    skipped_count: int
    skipped: list[dict[str, str]]
    memberships: list[OutreachCampaignLead]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": str(self.campaign.id),
            "objective": self.campaign.objective,
            "channel": self.campaign.channel,
            "cadence": self.campaign.cadence or {},
            "status": self.campaign.status,
            "owner_user_id": str(self.campaign.owner_user_id),
            "created_by_user_id": str(self.campaign.created_by_user_id),
            "source_type": self.campaign.source_type,
            "source_filter": self.campaign.source_filter or {},
            "recovery_attempts": self.campaign.recovery_attempts or 0,
            "included_count": self.included_count,
            "skipped_count": self.skipped_count,
            "skipped": self.skipped,
            "memberships": [
                {
                    "id": str(m.id),
                    "campaign_id": str(m.campaign_id),
                    "lead_id": str(m.lead_id),
                    "lead_identity_id": str(m.lead_identity_id) if m.lead_identity_id else None,
                    "status": m.status,
                    "skip_reason": m.skip_reason,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                    "updated_at": m.updated_at.isoformat() if m.updated_at else None,
                }
                for m in self.memberships
            ],
            "created_at": self.campaign.created_at.isoformat() if self.campaign.created_at else None,
            "updated_at": self.campaign.updated_at.isoformat() if self.campaign.updated_at else None,
        }


class OutreachCampaignService:
    def __init__(self, db: Session):
        self.db = db

    def launch_campaign(
        self,
        *,
        actor: User,
        objective: str,
        channel: str,
        cadence: dict[str, Any],
        owner_user_id: UUID | None = None,
        lead_ids: list[UUID] | None = None,
        segment_filter: dict[str, Any] | None = None,
    ) -> CampaignLaunchResult:
        lead_ids = lead_ids or None
        segment_filter = segment_filter or None
        owner_user_id = owner_user_id or actor.id
        channel = channel.strip().lower()
        self._validate_launch_input(objective, channel, cadence, lead_ids, segment_filter)
        owner = self._validate_owner(owner_user_id)
        self._enforce_permission(actor, owner, segment_filter)

        source_type = (
            OutreachCampaignSourceType.LEAD_SEGMENT.value
            if segment_filter
            else OutreachCampaignSourceType.LEAD_SELECTION.value
        )
        leads = self._resolve_leads(lead_ids=lead_ids, segment_filter=segment_filter)

        campaign = OutreachCampaign(
            objective=objective.strip(),
            channel=channel,
            cadence=dict(cadence),
            status=OutreachCampaignStatus.ACTIVE.value,
            owner_user_id=owner.id,
            created_by_user_id=actor.id,
            source_type=source_type,
            source_filter=dict(segment_filter or {}),
        )
        self.db.add(campaign)
        self.db.flush()

        included: list[Lead] = []
        skipped: list[SkippedLead] = []
        for lead in leads:
            if self._has_active_membership(lead.id):
                skipped.append(SkippedLead(str(lead.id), "already_in_active_sequence"))
                continue

            membership = OutreachCampaignLead(
                campaign_id=campaign.id,
                lead_id=lead.id,
                lead_identity_id=lead.lead_identity_id,
                status=OutreachCampaignLeadStatus.ACTIVE.value,
            )
            self.db.add(membership)
            included.append(lead)

        if not included:
            self.db.rollback()
            raise ValueError("No leads available for campaign launch")

        try:
            self.db.flush()
            result = CampaignLaunchResult(
                campaign=campaign,
                included_count=len(included),
                skipped_count=len(skipped),
                skipped=[item.to_dict() for item in skipped],
                memberships=list(campaign.leads),
            )
            self._log_launch(actor, campaign, result, lead_ids, segment_filter)
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ValueError("Lead is already in an active sequence") from exc
        self.db.refresh(campaign)
        return result

    def get_campaign(self, campaign_id: UUID, actor: User | None = None) -> dict[str, Any]:
        campaign = self._get_campaign_for_actor(actor, campaign_id) if actor else self.db.query(OutreachCampaign).filter(OutreachCampaign.id == campaign_id).first()
        if not campaign:
            raise LookupError("Campaign not found")
        memberships = [
            {
                "id": str(m.id),
                "lead_id": str(m.lead_id),
                "lead_identity_id": str(m.lead_identity_id) if m.lead_identity_id else None,
                "status": m.status,
                "skip_reason": m.skip_reason,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in campaign.leads
        ]
        data = self._serialize_campaign(campaign)
        data["memberships"] = memberships
        data["included_count"] = len([m for m in memberships if m["status"] == OutreachCampaignLeadStatus.ACTIVE.value])
        data["skipped_count"] = len([m for m in memberships if m["status"] == OutreachCampaignLeadStatus.SKIPPED.value])
        data["skipped"] = []
        data["steps"] = [self._serialize_step(step) for step in sorted(campaign.steps, key=lambda s: (s.position, s.created_at or datetime.min.replace(tzinfo=timezone.utc)))]
        data["state"] = self.inspect_state(campaign_id)
        return data

    def inspect_state(self, campaign_id: UUID) -> dict[str, Any]:
        campaign = self.db.query(OutreachCampaign).filter(OutreachCampaign.id == campaign_id).first()
        if not campaign:
            raise LookupError("Campaign not found")
        return self._build_state(campaign)

    def pause_campaign(self, *, actor: User, campaign_id: UUID, reason: str | None = None) -> dict[str, Any]:
        campaign = self._get_campaign_for_actor(actor, campaign_id)
        if campaign.status != OutreachCampaignStatus.ACTIVE.value:
            raise ValueError("Only active campaigns can be paused")
        previous_status = campaign.status
        campaign.status = OutreachCampaignStatus.PAUSED.value
        self._log_state_transition(actor, campaign, "pause_outreach_campaign", reason, previous_status)
        self.db.commit()
        self.db.refresh(campaign)
        return self._build_state(campaign)

    def resume_campaign(self, *, actor: User, campaign_id: UUID, reason: str | None = None) -> dict[str, Any]:
        campaign = self._get_campaign_for_actor(actor, campaign_id)
        if campaign.status != OutreachCampaignStatus.PAUSED.value:
            raise ValueError("Only paused campaigns can be resumed")
        previous_status = campaign.status
        campaign.status = OutreachCampaignStatus.ACTIVE.value
        recovered = self.recover_sequence(campaign_id=campaign.id, commit=False)
        self._log_state_transition(actor, campaign, "resume_outreach_campaign", reason, previous_status, {"recovered_steps": recovered})
        self.db.commit()
        self.db.refresh(campaign)
        return self._build_state(campaign)

    def stop_campaign(self, *, actor: User, campaign_id: UUID, reason: str | None = None) -> dict[str, Any]:
        campaign = self._get_campaign_for_actor(actor, campaign_id)
        if campaign.status == OutreachCampaignStatus.STOPPED.value:
            return self._build_state(campaign)
        if campaign.status == OutreachCampaignStatus.COMPLETED.value:
            raise ValueError("Completed campaigns cannot be stopped")
        previous_status = campaign.status
        campaign.status = OutreachCampaignStatus.STOPPED.value
        cancelled = 0
        for step in campaign.steps:
            if step.status not in self._terminal_step_statuses():
                step.status = OutreachSequenceStepStatus.CANCELLED.value
                step.skip_reason = (reason or "campaign_stopped").strip()[:255]
                cancelled += 1
        for membership in campaign.leads:
            if membership.status == OutreachCampaignLeadStatus.ACTIVE.value:
                membership.status = OutreachCampaignLeadStatus.CANCELLED.value
                membership.skip_reason = (reason or "campaign_stopped").strip()[:255]
        self._log_state_transition(actor, campaign, "stop_outreach_campaign", reason, previous_status, {"cancelled_steps": cancelled})
        self.db.commit()
        self.db.refresh(campaign)
        return self._build_state(campaign)

    def recover_sequence(self, *, campaign_id: UUID, commit: bool = True) -> int:
        campaign = self.db.query(OutreachCampaign).filter(OutreachCampaign.id == campaign_id).first()
        if not campaign:
            raise LookupError("Campaign not found")

        recovered = 0
        for step in campaign.steps:
            if step.status != OutreachSequenceStepStatus.SENDING.value:
                continue
            if step.message_id:
                if step.message and step.message.delivery_status == DeliveryStatus.FAILED:
                    step.status = OutreachSequenceStepStatus.FAILED.value
                    step.failure_reason = step.message.delivery_error or "delivery_failed"
                    campaign.status = OutreachCampaignStatus.FAILED.value
                elif step.message and step.message.delivery_status in {DeliveryStatus.SENT, DeliveryStatus.DELIVERED}:
                    step.status = OutreachSequenceStepStatus.SENT.value
                    step.committed_at = step.committed_at or datetime.now(timezone.utc)
                else:
                    step.status = OutreachSequenceStepStatus.SENDING.value
            else:
                existing_message = None
                if step.idempotency_key:
                    existing_message = MessageService(self.db)._creation.find_by_idempotency_key(step.idempotency_key)
                if existing_message and existing_message.delivery_status in {DeliveryStatus.SENT, DeliveryStatus.DELIVERED}:
                    step.message_id = existing_message.id
                    step.status = OutreachSequenceStepStatus.SENT.value
                    step.committed_at = step.committed_at or datetime.now(timezone.utc)
                elif existing_message and existing_message.delivery_status == DeliveryStatus.FAILED:
                    step.message_id = existing_message.id
                    step.status = OutreachSequenceStepStatus.FAILED.value
                    step.failure_reason = existing_message.delivery_error or "delivery_failed"
                    campaign.status = OutreachCampaignStatus.FAILED.value
                elif existing_message:
                    step.message_id = existing_message.id
                    step.status = OutreachSequenceStepStatus.SENDING.value
                else:
                    step.status = (
                        OutreachSequenceStepStatus.APPROVED.value
                        if step.reviewed_content
                        else OutreachSequenceStepStatus.NEEDS_REVIEW.value
                    )
                step.started_at = None
            recovered += 1

        if recovered:
            campaign.recovery_attempts = (campaign.recovery_attempts or 0) + 1

        if (
            campaign.status == OutreachCampaignStatus.ACTIVE.value
            and campaign.steps
            and all(step.status in self._successful_terminal_step_statuses() for step in campaign.steps)
        ):
            campaign.status = OutreachCampaignStatus.COMPLETED.value
            self._complete_active_memberships(campaign)

        if recovered and commit:
            self.db.commit()
            self.db.refresh(campaign)
        return recovered

    def recover_due_runs(self, *, limit: int = 100) -> dict[str, int]:
        if limit < 1 or limit > 1000:
            raise ValueError("limit must be between 1 and 1000")
        campaigns = (
            self.db.query(OutreachCampaign)
            .join(OutreachSequenceStep, OutreachSequenceStep.campaign_id == OutreachCampaign.id)
            .filter(
                OutreachCampaign.status.in_(
                    [
                        OutreachCampaignStatus.ACTIVE.value,
                        OutreachCampaignStatus.PAUSED.value,
                    ]
                ),
                OutreachSequenceStep.status == OutreachSequenceStepStatus.SENDING.value,
            )
            .order_by(OutreachCampaign.updated_at.asc())
            .distinct()
            .limit(limit)
            .all()
        )
        recovered_steps = 0
        for campaign in campaigns:
            recovered_steps += self.recover_sequence(campaign_id=campaign.id, commit=False)
        if recovered_steps:
            self.db.commit()
        return {"recovered_campaigns": len(campaigns), "recovered_steps": recovered_steps}

    def generate_sequence_steps(
        self,
        *,
        actor: User,
        campaign_id: UUID,
        step_types: list[str] | None = None,
    ) -> list[OutreachSequenceStep]:
        campaign = self.db.query(OutreachCampaign).filter(OutreachCampaign.id == campaign_id).first()
        if not campaign:
            raise LookupError("Campaign not found")
        self._ensure_campaign_actor(actor, campaign)
        if campaign.status not in {OutreachCampaignStatus.ACTIVE.value, OutreachCampaignStatus.PAUSED.value}:
            raise ValueError("Sequence steps can only be generated for active or paused campaigns")

        normalized_step_types = self._normalize_step_types(step_types, campaign.cadence or {})
        created: list[OutreachSequenceStep] = []
        memberships = [
            membership
            for membership in campaign.leads
            if membership.status == OutreachCampaignLeadStatus.ACTIVE.value
        ]
        for membership in memberships:
            for position, step_type in enumerate(normalized_step_types, start=1):
                existing = (
                    self.db.query(OutreachSequenceStep)
                    .filter(
                        OutreachSequenceStep.campaign_id == campaign.id,
                        OutreachSequenceStep.lead_id == membership.lead_id,
                        OutreachSequenceStep.position == position,
                    )
                    .first()
                )
                if existing:
                    created.append(existing)
                    continue
                step = self._build_sequence_step(campaign, membership, step_type, position)
                self.db.add(step)
                created.append(step)

        self.db.flush()
        self._refresh_campaign_terminal_status(campaign)
        self.db.commit()
        for step in created:
            self.db.refresh(step)
        return created

    def review_step(
        self,
        *,
        actor: User,
        step_id: UUID,
        reviewed_content: str | None,
        approve: bool,
    ) -> OutreachSequenceStep:
        step = self._get_step(step_id)
        self._ensure_campaign_actor(actor, step.campaign)
        if step.status == OutreachSequenceStepStatus.SKIPPED.value:
            raise ValueError("Skipped steps cannot be reviewed")
        if step.status in self._terminal_step_statuses():
            raise ValueError("Terminal steps cannot be reviewed")
        if step.campaign.status in {
            OutreachCampaignStatus.STOPPED.value,
            OutreachCampaignStatus.COMPLETED.value,
            OutreachCampaignStatus.FAILED.value,
        }:
            raise ValueError("Campaign is not reviewable")
        content = (reviewed_content or step.generated_content or "").strip()
        if approve and not content:
            raise ValueError("reviewed_content is required to approve a step")
        step.reviewed_content = content or None
        step.reviewed_by_id = actor.id
        step.reviewed_at = datetime.now(timezone.utc)
        step.status = (
            OutreachSequenceStepStatus.APPROVED.value
            if approve
            else OutreachSequenceStepStatus.NEEDS_REVIEW.value
        )
        self.db.commit()
        self.db.refresh(step)
        return step

    def skip_step(self, *, actor: User, step_id: UUID, reason: str) -> OutreachSequenceStep:
        step = self._get_step(step_id)
        self._ensure_campaign_actor(actor, step.campaign)
        if step.status in self._terminal_step_statuses() or step.status == OutreachSequenceStepStatus.SENDING.value:
            raise ValueError("Step cannot be skipped in its current status")
        if step.campaign.status in {
            OutreachCampaignStatus.PAUSED.value,
            OutreachCampaignStatus.FAILED.value,
            OutreachCampaignStatus.STOPPED.value,
            OutreachCampaignStatus.COMPLETED.value,
        }:
            raise ValueError("Campaign is not skippable")
        step.status = OutreachSequenceStepStatus.SKIPPED.value
        step.skip_reason = (reason or "operator_skipped").strip()[:255]
        self._refresh_campaign_terminal_status(step.campaign)
        self.db.commit()
        self.db.refresh(step)
        return step

    async def send_step(self, *, actor: User, step_id: UUID) -> OutreachSequenceStep:
        step = self._get_step(step_id)
        self._ensure_campaign_actor(actor, step.campaign)
        if step.status == OutreachSequenceStepStatus.SENT.value and step.message_id:
            return step
        if step.status != OutreachSequenceStepStatus.APPROVED.value:
            raise ValueError("Step must be approved before send")
        if step.campaign.status == OutreachCampaignStatus.PAUSED.value:
            raise ValueError("Campaign is paused")
        if step.campaign.status == OutreachCampaignStatus.STOPPED.value:
            raise ValueError("Campaign is stopped")
        if step.campaign.status == OutreachCampaignStatus.FAILED.value:
            raise ValueError("Campaign is failed")
        if step.campaign.status == OutreachCampaignStatus.COMPLETED.value:
            raise ValueError("Campaign is completed")
        if step.channel not in GENERATABLE_CHANNELS:
            return self._mark_step_skipped(step, "unsupported_channel")
        content = (step.reviewed_content or "").strip()
        if not content:
            raise ValueError("Step must have reviewed content before send")
        missing_recipient = self._missing_recipient_reason(step)
        if missing_recipient:
            return self._mark_step_skipped(step, missing_recipient)
        self._ensure_prior_steps_complete(step)

        idempotency_key = step.idempotency_key or f"outreach_step:{step.id}:send"
        started_at = datetime.now(timezone.utc)
        claimed = (
            self.db.query(OutreachSequenceStep)
            .filter(
                OutreachSequenceStep.id == step.id,
                OutreachSequenceStep.status == OutreachSequenceStepStatus.APPROVED.value,
            )
            .update(
                {
                    OutreachSequenceStep.idempotency_key: idempotency_key,
                    OutreachSequenceStep.status: OutreachSequenceStepStatus.SENDING.value,
                    OutreachSequenceStep.started_at: started_at,
                },
                synchronize_session=False,
            )
        )
        if claimed != 1:
            self.db.rollback()
            latest = self._get_step(step_id)
            if latest.status == OutreachSequenceStepStatus.SENT.value and latest.message_id:
                return latest
            if latest.status == OutreachSequenceStepStatus.SENDING.value:
                raise ValueError("Step is already sending")
            raise ValueError("Step must be approved before send")
        self.db.commit()
        self.db.refresh(step)

        self._ensure_step_claim_still_sendable(step)
        try:
            conversation = self._conversation_for_step(step)
            message = await MessageService(self.db).send_from_dashboard(
                conversation=conversation,
                content=content,
                owner_id=actor.id,
                message_type="TEXT",
                idempotency_key=idempotency_key,
            )
        except Exception as exc:
            step.status = OutreachSequenceStepStatus.FAILED.value
            step.failure_reason = str(exc) or "send_failed"
            step.campaign.status = OutreachCampaignStatus.FAILED.value
            self.db.commit()
            self.db.refresh(step)
            raise ValueError("Failed to send outreach step") from exc
        step.message_id = message.id
        step.committed_at = step.committed_at or datetime.now(timezone.utc)
        if message.delivery_status == DeliveryStatus.FAILED:
            step.status = OutreachSequenceStepStatus.FAILED.value
            step.failure_reason = message.delivery_error or "delivery_failed"
            step.campaign.status = OutreachCampaignStatus.FAILED.value
        elif message.delivery_status in {DeliveryStatus.SENT, DeliveryStatus.DELIVERED}:
            step.status = OutreachSequenceStepStatus.SENT.value
            step.failure_reason = None
            self._refresh_campaign_terminal_status(step.campaign)
        else:
            step.status = OutreachSequenceStepStatus.SENDING.value
            step.failure_reason = None
        self.db.commit()
        self.db.refresh(step)
        return step

    def _validate_launch_input(
        self,
        objective: str,
        channel: str,
        cadence: dict[str, Any],
        lead_ids: list[UUID] | None,
        segment_filter: dict[str, Any] | None,
    ) -> None:
        if not objective or not objective.strip():
            raise ValueError("objective is required")
        if channel not in SUPPORTED_CHANNELS:
            raise ValueError(f"Unsupported channel: {channel}")
        if not isinstance(cadence, dict):
            raise ValueError("cadence must be an object")
        if not cadence:
            raise ValueError("cadence is required")
        self._validate_cadence(cadence)
        if bool(lead_ids) == bool(segment_filter):
            raise ValueError("Provide either lead_ids or segment_filter, but not both")
        if segment_filter:
            unsupported = set(segment_filter) - SEGMENT_FILTER_FIELDS
            if unsupported:
                raise ValueError(f"Unsupported segment filter fields: {sorted(unsupported)}")

    def _validate_owner(self, owner_user_id: UUID) -> User:
        owner = self.db.query(User).filter(User.id == owner_user_id).first()
        if not owner:
            raise ValueError("Campaign owner not found")
        if not owner.is_active or not owner.is_approved:
            raise ValueError("Campaign owner must be an active approved user")
        return owner

    def _enforce_permission(self, actor: User, owner: User, segment_filter: dict[str, Any] | None) -> None:
        user_type = actor.user_type
        can_manage_campaign_scope = bool(
            user_type
            and (user_type.can_view_all_conversations or user_type.can_change_settings)
        )
        if segment_filter and not can_manage_campaign_scope:
            raise PermissionError("Permission denied: segment launch requires 'can_view_all_conversations' or 'can_change_settings'")
        if owner.id != actor.id and not can_manage_campaign_scope:
            raise PermissionError("Permission denied: assigning another owner requires 'can_view_all_conversations' or 'can_change_settings'")

    def _resolve_leads(
        self,
        *,
        lead_ids: list[UUID] | None,
        segment_filter: dict[str, Any] | None,
    ) -> list[Lead]:
        if lead_ids:
            unique_ids = list(dict.fromkeys(lead_ids))
            leads = self.db.query(Lead).filter(Lead.id.in_(unique_ids)).all()
            found_ids = {lead.id for lead in leads}
            missing_ids = [str(lead_id) for lead_id in unique_ids if lead_id not in found_ids]
            if missing_ids:
                raise ValueError(f"Lead not found: {', '.join(missing_ids)}")
            return leads

        q = self.db.query(Lead)
        filters = segment_filter or {}
        if status := filters.get("status"):
            try:
                status_value = LeadStatus(status).value
            except ValueError:
                raise ValueError(f"Invalid lead status: {status}")
            q = q.filter(Lead.status == status_value)
        if channel := filters.get("channel"):
            q = q.filter(Lead.source_channel == channel)
        if qualification_label := filters.get("qualification_label"):
            q = q.filter(Lead.qualification_label == qualification_label)
        if filters.get("min_score") is not None:
            try:
                min_score = int(filters["min_score"])
            except (TypeError, ValueError):
                raise ValueError("min_score must be an integer")
            q = q.filter(Lead.score >= min_score)
        return q.order_by(Lead.created_at.desc()).all()

    def _has_active_membership(self, lead_id: UUID) -> bool:
        return (
            self.db.query(OutreachCampaignLead)
            .join(OutreachCampaign, OutreachCampaign.id == OutreachCampaignLead.campaign_id)
            .filter(
                OutreachCampaignLead.lead_id == lead_id,
                OutreachCampaignLead.status.in_(ACTIVE_MEMBERSHIP_STATUSES),
                OutreachCampaign.status.in_(ACTIVE_CAMPAIGN_STATUSES),
            )
            .first()
            is not None
        )

    def _serialize_campaign(self, campaign: OutreachCampaign) -> dict[str, Any]:
        return {
            "id": str(campaign.id),
            "objective": campaign.objective,
            "channel": campaign.channel,
            "cadence": campaign.cadence or {},
            "status": campaign.status,
            "owner_user_id": str(campaign.owner_user_id),
            "created_by_user_id": str(campaign.created_by_user_id),
            "source_type": campaign.source_type,
            "source_filter": campaign.source_filter or {},
            "recovery_attempts": campaign.recovery_attempts or 0,
            "created_at": campaign.created_at.isoformat() if campaign.created_at else None,
            "updated_at": campaign.updated_at.isoformat() if campaign.updated_at else None,
        }

    def serialize_step(self, step: OutreachSequenceStep) -> dict[str, Any]:
        return self._serialize_step(step)

    def _serialize_step(self, step: OutreachSequenceStep) -> dict[str, Any]:
        return {
            "id": str(step.id),
            "campaign_id": str(step.campaign_id),
            "lead_id": str(step.lead_id),
            "campaign_lead_id": str(step.campaign_lead_id) if step.campaign_lead_id else None,
            "step_type": step.step_type,
            "channel": step.channel,
            "position": step.position,
            "due_at": step.due_at.isoformat() if step.due_at else None,
            "status": step.status,
            "generated_content": step.generated_content,
            "reviewed_content": step.reviewed_content,
            "generation_metadata": step.generation_metadata or {},
            "reviewed_by_id": str(step.reviewed_by_id) if step.reviewed_by_id else None,
            "reviewed_at": step.reviewed_at.isoformat() if step.reviewed_at else None,
            "message_id": str(step.message_id) if step.message_id else None,
            "idempotency_key": step.idempotency_key,
            "started_at": step.started_at.isoformat() if step.started_at else None,
            "committed_at": step.committed_at.isoformat() if step.committed_at else None,
            "failure_reason": step.failure_reason,
            "skip_reason": step.skip_reason,
            "created_at": step.created_at.isoformat() if step.created_at else None,
            "updated_at": step.updated_at.isoformat() if step.updated_at else None,
        }

    def _normalize_step_types(self, step_types: list[str] | None, cadence: dict[str, Any]) -> list[str]:
        if step_types:
            normalized = [item.strip().lower() for item in step_types if item and item.strip()]
        else:
            planned_steps = self._planned_step_count(cadence)
            normalized = [OutreachSequenceStepType.INITIAL_OUTREACH.value]
            if planned_steps > 1:
                normalized.extend([OutreachSequenceStepType.FOLLOW_UP.value] * (planned_steps - 1))
        if not normalized:
            raise ValueError("At least one step type is required")
        if len(normalized) > MAX_PLANNED_STEPS:
            raise ValueError(f"step_types must include at most {MAX_PLANNED_STEPS} steps")
        allowed = {item.value for item in OutreachSequenceStepType}
        invalid = [item for item in normalized if item not in allowed]
        if invalid:
            raise ValueError(f"Unsupported step types: {invalid}")
        return normalized

    def _planned_step_count(self, cadence: dict[str, Any]) -> int:
        try:
            planned_steps = int(cadence.get("planned_steps") or 2)
        except (TypeError, ValueError) as exc:
            raise ValueError("cadence.planned_steps must be an integer") from exc
        if planned_steps < MIN_PLANNED_STEPS or planned_steps > MAX_PLANNED_STEPS:
            raise ValueError(f"cadence.planned_steps must be between {MIN_PLANNED_STEPS} and {MAX_PLANNED_STEPS}")
        return planned_steps

    def _validate_cadence(self, cadence: dict[str, Any]) -> None:
        self._planned_step_count(cadence)
        self._follow_up_interval_days(cadence)

    def _build_sequence_step(
        self,
        campaign: OutreachCampaign,
        membership: OutreachCampaignLead,
        step_type: str,
        position: int,
    ) -> OutreachSequenceStep:
        channel = campaign.channel.lower()
        due_at = self._due_at(campaign.cadence or {}, position)
        if channel not in GENERATABLE_CHANNELS:
            return OutreachSequenceStep(
                campaign_id=campaign.id,
                lead_id=membership.lead_id,
                campaign_lead_id=membership.id,
                step_type=step_type,
                channel=channel,
                position=position,
                due_at=due_at,
                status=OutreachSequenceStepStatus.SKIPPED.value,
                generated_content="",
                generation_metadata={"policy": "unsupported", "reason": "unsupported_channel"},
                skip_reason="unsupported_channel",
            )
        generated_content, metadata = self._generate_channel_content(campaign, membership.lead, step_type, position)
        return OutreachSequenceStep(
            campaign_id=campaign.id,
            lead_id=membership.lead_id,
            campaign_lead_id=membership.id,
            step_type=step_type,
            channel=channel,
            position=position,
            due_at=due_at,
            status=OutreachSequenceStepStatus.NEEDS_REVIEW.value,
            generated_content=generated_content,
            generation_metadata=metadata,
        )

    def _due_at(self, cadence: dict[str, Any], position: int) -> datetime:
        start_at = datetime.now(timezone.utc)
        interval_days = self._follow_up_interval_days(cadence)
        return start_at + timedelta(days=max(position - 1, 0) * interval_days)

    def _follow_up_interval_days(self, cadence: dict[str, Any]) -> int:
        try:
            interval_days = int(cadence.get("follow_up_interval_days") or 2)
        except (TypeError, ValueError) as exc:
            raise ValueError("cadence.follow_up_interval_days must be an integer") from exc
        if interval_days < MIN_FOLLOW_UP_INTERVAL_DAYS or interval_days > MAX_FOLLOW_UP_INTERVAL_DAYS:
            raise ValueError(
                "cadence.follow_up_interval_days must be between "
                f"{MIN_FOLLOW_UP_INTERVAL_DAYS} and {MAX_FOLLOW_UP_INTERVAL_DAYS}"
            )
        return interval_days

    def _generate_channel_content(
        self,
        campaign: OutreachCampaign,
        lead: Lead,
        step_type: str,
        position: int,
    ) -> tuple[str, dict[str, Any]]:
        lead_name = lead.name or "there"
        company = lead.company or "your team"
        role = lead.role or "your role"
        objective = " ".join((campaign.objective or "").split())
        pain_points = ", ".join(lead.pain_points or []) if isinstance(lead.pain_points, list) else ""
        missing_context = not any([pain_points, lead.qualification_notes, lead.role, lead.score_rationale])
        context_line = pain_points or lead.qualification_notes or "available lead details are limited"
        qualifier = f"{lead.qualification_label} lead" if lead.qualification_label else "qualified lead"
        score = f" Score: {lead.score}." if lead.score is not None else ""
        rationale = f" Rationale: {lead.score_rationale}" if lead.score_rationale else ""
        role_line = f" in {role}" if role else ""
        follow_up_intro = "Following up on my previous note" if step_type == OutreachSequenceStepType.FOLLOW_UP.value else "I noticed your interest"

        if campaign.channel == "email":
            subject = f"Subject: {company} and {objective[:48]}"
            body = (
                f"Hi {lead_name},\n\n"
                f"{follow_up_intro} around {context_line}. "
                f"I am reaching out because {company}{role_line} looks like a {qualifier} for {objective}."
                f"{score}{rationale}\n\n"
                f"Would it be useful to compare priorities and decide whether a short discovery call makes sense?\n\n"
                f"Best,\n{campaign.owner.full_name if campaign.owner else 'The team'}"
            )
            return f"{subject}\n\n{body}", {
                "policy": "Email: subject plus structured body, slightly formal tone",
                "position": position,
                "missing_context": missing_context,
            }

        if campaign.channel == "telegram":
            text = (
                f"Hi {lead_name}, {follow_up_intro.lower()} about {context_line}. "
                f"Would you like to quickly check if {objective} fits what {company}{role_line} needs now?"
            )
            return text, {
                "policy": "Telegram: concise chat-style copy, light formatting",
                "position": position,
                "missing_context": missing_context,
            }

        text = (
            f"Hi {lead_name}, {follow_up_intro.lower()} about {context_line}. "
            f"Could we talk briefly about {objective} for {company}{role_line}?"
        )
        return text, {
            "policy": "WhatsApp: concise conversational tone, no subject line",
            "position": position,
            "missing_context": missing_context,
        }

    def _get_step(self, step_id: UUID) -> OutreachSequenceStep:
        step = self.db.query(OutreachSequenceStep).filter(OutreachSequenceStep.id == step_id).first()
        if not step:
            raise LookupError("Outreach step not found")
        return step

    def _get_campaign_for_actor(self, actor: User, campaign_id: UUID) -> OutreachCampaign:
        campaign = self.db.query(OutreachCampaign).filter(OutreachCampaign.id == campaign_id).first()
        if not campaign:
            raise LookupError("Campaign not found")
        self._ensure_campaign_actor(actor, campaign)
        return campaign

    def _build_state(self, campaign: OutreachCampaign) -> dict[str, Any]:
        steps = sorted(campaign.steps, key=lambda s: (s.position, s.created_at or datetime.min.replace(tzinfo=timezone.utc)))
        pending_steps = [step for step in steps if step.status not in self._terminal_step_statuses()]
        current_step = pending_steps[0] if pending_steps else None
        last_step = self._last_action_step(steps)
        return {
            "campaign_id": str(campaign.id),
            "execution_status": campaign.status,
            "current_step": self._serialize_step(current_step) if current_step else None,
            "last_action": self._action_summary(last_step) if last_step else None,
            "next_action": self._next_action(campaign, current_step),
            "recoverable": self._is_recoverable(campaign),
            "recovery_attempts": campaign.recovery_attempts or 0,
        }

    def _last_action_step(self, steps: list[OutreachSequenceStep]) -> OutreachSequenceStep | None:
        acted_steps = [
            step
            for step in steps
            if step.committed_at or step.reviewed_at or step.started_at or step.created_at
        ]
        return max(
            acted_steps,
            key=lambda step: step.committed_at or step.reviewed_at or step.started_at or step.created_at,
            default=None,
        )

    def _action_summary(self, step: OutreachSequenceStep) -> dict[str, Any]:
        action = "generated"
        occurred_at = step.created_at
        if step.committed_at:
            action = "sent" if step.status == OutreachSequenceStepStatus.SENT.value else step.status
            occurred_at = step.committed_at
        elif step.reviewed_at:
            action = "approved" if step.status == OutreachSequenceStepStatus.APPROVED.value else "reviewed"
            occurred_at = step.reviewed_at
        elif step.started_at:
            action = "sending"
            occurred_at = step.started_at
        return {
            "step_id": str(step.id),
            "action": action,
            "status": step.status,
            "occurred_at": occurred_at.isoformat() if occurred_at else None,
        }

    def _next_action(self, campaign: OutreachCampaign, current_step: OutreachSequenceStep | None) -> str:
        if campaign.status == OutreachCampaignStatus.PAUSED.value:
            return "resume_campaign"
        if campaign.status == OutreachCampaignStatus.STOPPED.value:
            return "none"
        if campaign.status == OutreachCampaignStatus.COMPLETED.value:
            return "none"
        if campaign.status == OutreachCampaignStatus.FAILED.value:
            return "review_failure"
        if not current_step:
            return "complete_campaign"
        if current_step.status == OutreachSequenceStepStatus.NEEDS_REVIEW.value:
            return "review_step"
        if current_step.status == OutreachSequenceStepStatus.APPROVED.value:
            return "send_step"
        if current_step.status == OutreachSequenceStepStatus.SENDING.value:
            return "recover_or_wait"
        if current_step.status == OutreachSequenceStepStatus.FAILED.value:
            return "review_failure"
        return "inspect_step"

    def _terminal_step_statuses(self) -> set[str]:
        return {
            OutreachSequenceStepStatus.SENT.value,
            OutreachSequenceStepStatus.FAILED.value,
            OutreachSequenceStepStatus.SKIPPED.value,
            OutreachSequenceStepStatus.CANCELLED.value,
        }

    def _successful_terminal_step_statuses(self) -> set[str]:
        return {
            OutreachSequenceStepStatus.SENT.value,
            OutreachSequenceStepStatus.SKIPPED.value,
            OutreachSequenceStepStatus.CANCELLED.value,
        }

    def _is_recoverable(self, campaign: OutreachCampaign) -> bool:
        if campaign.status in {OutreachCampaignStatus.STOPPED.value, OutreachCampaignStatus.COMPLETED.value}:
            return False
        return any(step.status == OutreachSequenceStepStatus.SENDING.value for step in campaign.steps)

    def _ensure_campaign_actor(self, actor: User, campaign: OutreachCampaign) -> None:
        user_type = actor.user_type
        can_manage = bool(user_type and (user_type.can_view_all_conversations or user_type.can_change_settings))
        if actor.id not in {campaign.owner_user_id, campaign.created_by_user_id} and not can_manage:
            raise PermissionError("Permission denied for this campaign")

    def _ensure_step_claim_still_sendable(self, step: OutreachSequenceStep) -> None:
        self.db.refresh(step)
        self.db.refresh(step.campaign)
        if step.status != OutreachSequenceStepStatus.SENDING.value:
            raise ValueError("Step is no longer sending")
        if step.campaign.status != OutreachCampaignStatus.ACTIVE.value:
            step.status = OutreachSequenceStepStatus.APPROVED.value
            step.started_at = None
            self.db.commit()
            raise ValueError("Campaign is not active")

    def _mark_step_skipped(self, step: OutreachSequenceStep, reason: str) -> OutreachSequenceStep:
        step.status = OutreachSequenceStepStatus.SKIPPED.value
        step.skip_reason = reason
        self._refresh_campaign_terminal_status(step.campaign)
        self.db.commit()
        self.db.refresh(step)
        return step

    def _ensure_prior_steps_complete(self, step: OutreachSequenceStep) -> None:
        prior_open = (
            self.db.query(OutreachSequenceStep)
            .filter(
                OutreachSequenceStep.campaign_id == step.campaign_id,
                OutreachSequenceStep.lead_id == step.lead_id,
                OutreachSequenceStep.position < step.position,
                ~OutreachSequenceStep.status.in_(self._terminal_step_statuses()),
            )
            .first()
        )
        if prior_open:
            raise ValueError("Previous sequence steps must complete before sending this step")

    def _missing_recipient_reason(self, step: OutreachSequenceStep) -> str | None:
        lead = step.lead
        if step.channel == "email" and not lead.email:
            return "missing_email"
        if step.channel == "whatsapp" and not lead.phone:
            return "missing_phone"
        if step.channel == "telegram" and not self._lead_channel_identifier(lead, step.channel):
            return "missing_telegram_recipient"
        return None

    def _complete_active_memberships(self, campaign: OutreachCampaign) -> None:
        for membership in campaign.leads:
            if membership.status == OutreachCampaignLeadStatus.ACTIVE.value:
                membership.status = OutreachCampaignLeadStatus.COMPLETED.value

    def _refresh_campaign_terminal_status(self, campaign: OutreachCampaign) -> None:
        if not campaign.steps:
            return
        if any(step.status == OutreachSequenceStepStatus.FAILED.value for step in campaign.steps):
            campaign.status = OutreachCampaignStatus.FAILED.value
            return
        if (
            campaign.status == OutreachCampaignStatus.ACTIVE.value
            and all(step.status in self._terminal_step_statuses() for step in campaign.steps)
        ):
            campaign.status = OutreachCampaignStatus.COMPLETED.value
            self._complete_active_memberships(campaign)

    def _conversation_for_step(self, step: OutreachSequenceStep) -> Conversation:
        lead = step.lead
        if lead.conversation_id:
            conversation = self.db.query(Conversation).filter(Conversation.id == lead.conversation_id).first()
            if conversation and conversation.channel == ChannelType(step.channel):
                return conversation

        contact = Contact(
            name=lead.name,
            email=lead.email if step.channel == "email" else None,
            phone=lead.phone if step.channel in {"whatsapp", "sms"} else None,
            channel_identifier=self._lead_channel_identifier(lead, step.channel),
        )
        self.db.add(contact)
        self.db.flush()
        conversation = Conversation(
            contact_id=contact.id,
            assigned_user_id=step.campaign.owner_user_id,
            channel=ChannelType(step.channel),
        )
        self.db.add(conversation)
        self.db.flush()
        lead.conversation_id = conversation.id
        return conversation

    def _lead_channel_identifier(self, lead: Lead, channel: str) -> str | None:
        if channel == "email":
            return lead.email
        if channel in {"whatsapp", "sms"}:
            return lead.phone
        if channel == "telegram":
            source_facts = lead.source_facts if isinstance(lead.source_facts, dict) else {}
            value = (
                source_facts.get("telegram_chat_id")
                or source_facts.get("telegram_username")
                or source_facts.get("channel_identifier")
            )
            return str(value) if value else None
        return None

    def _log_launch(
        self,
        actor: User,
        campaign: OutreachCampaign,
        result: CampaignLaunchResult,
        lead_ids: list[UUID] | None,
        segment_filter: dict[str, Any] | None,
    ) -> None:
        objective_summary = " ".join((campaign.objective or "").split())[:120]
        details = {
            "campaign_id": str(campaign.id),
            "channel": campaign.channel,
            "owner_user_id": str(campaign.owner_user_id),
            "created_by_user_id": str(actor.id),
            "source_type": campaign.source_type,
            "selected_lead_ids": [str(item) for item in lead_ids or []],
            "segment_filter": segment_filter or {},
            "cadence": campaign.cadence or {},
            "objective_summary": objective_summary,
            "objective_length": len(campaign.objective or ""),
            "included_count": result.included_count,
            "skipped_count": result.skipped_count,
            "skipped": result.skipped,
        }
        log_action(
            self.db,
            actor.id,
            "launch_outreach_campaign",
            "outreach_campaign",
            str(campaign.id),
            details,
            commit=False,
        )

    def _log_state_transition(
        self,
        actor: User,
        campaign: OutreachCampaign,
        action: str,
        reason: str | None,
        previous_status: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        details = {
            "campaign_id": str(campaign.id),
            "previous_status": previous_status,
            "new_status": campaign.status,
            "reason": reason,
            **(extra or {}),
        }
        log_action(
            self.db,
            actor.id,
            action,
            "outreach_campaign",
            str(campaign.id),
            details,
            commit=False,
        )
