from __future__ import annotations

import logging
import re
from typing import Any
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.models.models import (
    CatalogItem,
    CatalogItemStatus,
    Client,
    Contact,
    Conversation,
    Lead,
    Message,
    Project,
    Proposal,
    ProposalStatus,
    User,
)


SENSITIVE_FIELD_PARTS = {"email", "phone", "hash", "token", "secret", "password", "credential"}
FALLBACK_INSTRUCTION = "use neutral outreach, no unsupported claims"
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)")
OUTREACH_CHANNELS = {"email", "whatsapp", "sms"}
ALLOWED_PROPOSAL_STATUSES = {ProposalStatus.SENT, ProposalStatus.APPROVED}

log = logging.getLogger(__name__)


class OutreachGroundingService:
    """Build source-attributed, operator-safe context for outreach personalization."""

    def __init__(self, db: Session):
        self.db = db

    def build_for_lead(
        self,
        *,
        actor: User,
        lead_id: UUID,
        channel: str | None = None,
        scope: str = "lead_outreach",
    ) -> dict[str, Any]:
        lead = self._get_lead(lead_id)
        self._ensure_actor_can_use_lead(actor, lead)

        facts: list[dict[str, Any]] = []
        inferences: list[dict[str, Any]] = []
        omitted_sources: list[dict[str, str]] = []

        self._add_source_fact_items(lead, facts)
        self._add_direct_lead_facts(lead, facts)
        self._add_identity_facts(lead, facts, omitted_sources)
        self._add_scoring_facts(lead, facts, omitted_sources)
        self._add_inferences(lead, inferences, omitted_sources)
        self._add_conversation_facts(lead, facts, omitted_sources)
        client = self._linked_client(lead, omitted_sources)
        self._add_client_facts(client, facts, omitted_sources)
        self._add_project_facts(actor, lead, client, facts, omitted_sources)
        self._add_proposal_facts(actor, client, facts, omitted_sources)
        self._add_catalog_facts(lead, client, channel, facts, omitted_sources)

        fallback_mode = not self._has_personalization_context(facts, inferences)
        citations = self._citations(facts, inferences)
        return {
            "entity_type": "lead",
            "entity_id": str(lead.id),
            "scope": scope,
            "channel": channel,
            "fallback_mode": fallback_mode,
            "facts": facts,
            "inferences": inferences,
            "citations": citations,
            "omitted_sources": self._dedupe_omissions(omitted_sources),
            "prompt_inputs": {
                "facts": facts,
                "inferences": inferences,
                "citations": citations,
                "generation_instruction": FALLBACK_INSTRUCTION if fallback_mode else "use cited facts only; do not invent unsupported claims",
            },
        }

    def _get_lead(self, lead_id: UUID) -> Lead:
        lead = (
            self.db.query(Lead)
            .options(
                joinedload(Lead.lead_identity),
                joinedload(Lead.conversation)
                .joinedload(Conversation.contact)
                .joinedload(Contact.client),
            )
            .filter(Lead.id == lead_id)
            .first()
        )
        if not lead:
            raise LookupError("Lead not found")
        return lead

    def _ensure_actor_can_use_lead(self, actor: User, lead: Lead) -> None:
        conversation = lead.conversation
        can_view_all = bool(
            actor.user_type
            and (actor.user_type.can_view_all_conversations or actor.user_type.can_change_settings)
        )
        if not conversation or not conversation.assigned_user_id:
            if can_view_all:
                return
            raise PermissionError("Permission denied for this lead grounding scope")
        if conversation.assigned_user_id != actor.id and not can_view_all:
            raise PermissionError("Permission denied for this lead grounding scope")

    def _add_source_fact_items(self, lead: Lead, facts: list[dict[str, Any]]) -> None:
        source_facts = lead.source_facts or {}
        if not isinstance(source_facts, dict):
            return
        for group, group_value in source_facts.items():
            if not isinstance(group_value, dict):
                self._append_fact(
                    facts,
                    key=f"{group}",
                    value=group_value,
                    source_type="lead",
                    source_id=str(lead.id),
                    source_field=f"source_facts.{group}",
                )
                continue
            for field, value in group_value.items():
                if field == "id":
                    continue
                self._append_fact(
                    facts,
                    key=f"{group}.{field}",
                    value=value,
                    source_type="lead",
                    source_id=str(lead.id),
                    source_field=f"source_facts.{group}.{field}",
                )

    def _add_direct_lead_facts(self, lead: Lead, facts: list[dict[str, Any]]) -> None:
        for key, value in {
            "lead.company": lead.company,
            "lead.source_channel": lead.source_channel,
            "lead.status": lead.status.value if hasattr(lead.status, "value") else lead.status,
        }.items():
            self._append_fact(
                facts,
                key=key,
                value=value,
                source_type="lead",
                source_id=str(lead.id),
                source_field=key.replace("lead.", ""),
            )

    def _add_identity_facts(
        self,
        lead: Lead,
        facts: list[dict[str, Any]],
        omitted_sources: list[dict[str, str]],
    ) -> None:
        if not lead.lead_identity and (not lead.identity_resolution_status or lead.identity_resolution_status == "unresolved"):
            omitted_sources.append({"source_type": "lead_identity", "reason": "not_resolved"})
            return
        source_id = str(lead.lead_identity_id or lead.id)
        for key, value, field in [
            ("lead.identity_status", lead.identity_resolution_status, "identity_resolution_status"),
            ("lead.identity_confidence", lead.identity_confidence, "identity_confidence"),
            ("lead.identity_match_reasons", lead.identity_match_reasons or [], "identity_match_reasons"),
        ]:
            self._append_fact(
                facts,
                key=key,
                value=value,
                source_type="lead_identity",
                source_id=source_id,
                source_field=field,
            )

    def _add_scoring_facts(
        self,
        lead: Lead,
        facts: list[dict[str, Any]],
        omitted_sources: list[dict[str, str]],
    ) -> None:
        if lead.score is None:
            omitted_sources.append({"source_type": "lead_scoring", "reason": "not_scored"})
            return
        for key, value, field, confidence in [
            ("lead.score", lead.score, "score", lead.score_confidence),
            ("lead.qualification_label", lead.qualification_label, "qualification_label", lead.score_confidence),
            ("lead.score_rationale", lead.score_rationale, "score_rationale", lead.score_confidence),
        ]:
            self._append_fact(
                facts,
                key=key,
                value=value,
                source_type="lead_scoring",
                source_id=str(lead.id),
                source_field=field,
                confidence=confidence,
            )

    def _add_inferences(
        self,
        lead: Lead,
        inferences: list[dict[str, Any]],
        omitted_sources: list[dict[str, str]],
    ) -> None:
        source = lead.ai_inferences or {}
        if not source or lead.enrichment_status != "completed":
            omitted_sources.append({"source_type": "lead_enrichment", "reason": "not_enriched"})
            return
        for key, value in source.items():
            entries = value if isinstance(value, list) else [value]
            for entry in entries:
                if isinstance(entry, dict):
                    self._append_inference(
                        inferences,
                        key=f"lead.{key}",
                        value=entry.get("value"),
                        source_id=str(lead.id),
                        source_field=f"ai_inferences.{key}",
                        confidence=entry.get("confidence"),
                        rationale=entry.get("rationale"),
                    )
                else:
                    self._append_inference(
                        inferences,
                        key=f"lead.{key}",
                        value=entry,
                        source_id=str(lead.id),
                        source_field=f"ai_inferences.{key}",
                    )

    def _add_conversation_facts(
        self,
        lead: Lead,
        facts: list[dict[str, Any]],
        omitted_sources: list[dict[str, str]],
    ) -> None:
        conversation = lead.conversation
        if not conversation:
            omitted_sources.append({"source_type": "conversation", "reason": "not_linked"})
            return
        try:
            rows = (
                self.db.query(Message)
                .filter(Message.conversation_id == conversation.id)
                .order_by(Message.conversation_sequence.asc(), Message.created_at.asc())
                .limit(20)
                .all()
            )
        except SQLAlchemyError as exc:
            self._record_source_error("conversation", exc, omitted_sources)
            return
        public_rows = [row for row in rows if not row.is_internal]
        if len(public_rows) != len(rows):
            omitted_sources.append({"source_type": "conversation", "reason": "internal_message"})
        for index, row in enumerate(public_rows[:3], start=1):
            self._append_fact(
                facts,
                key=f"conversation.message_{index}",
                value=row.content,
                source_type="conversation",
                source_id=str(row.id),
                source_field="messages.content",
            )

    def _linked_client(
        self,
        lead: Lead,
        omitted_sources: list[dict[str, str]],
    ) -> Client | None:
        conversation = lead.conversation
        contact = conversation.contact if conversation else None
        if contact and contact.client:
            return contact.client
        if contact and contact.client_id:
            try:
                return self.db.query(Client).filter(Client.id == contact.client_id).first()
            except SQLAlchemyError as exc:
                self._record_source_error("client", exc, omitted_sources)
                return None
        return None

    def _add_client_facts(
        self,
        client: Client | None,
        facts: list[dict[str, Any]],
        omitted_sources: list[dict[str, str]],
    ) -> None:
        if not client:
            omitted_sources.append({"source_type": "client", "reason": "not_linked"})
            omitted_sources.append({"source_type": "linked_company", "reason": "not_linked"})
            return
        for key, value, field in [
            ("client.name", client.name, "name"),
            ("client.company_name", client.company_name, "company_name"),
            ("client.country", client.country, "country"),
        ]:
            self._append_fact(
                facts,
                key=key,
                value=value,
                source_type="client",
                source_id=str(client.id),
                source_field=field,
            )

    def _add_project_facts(
        self,
        actor: User,
        lead: Lead,
        client: Client | None,
        facts: list[dict[str, Any]],
        omitted_sources: list[dict[str, str]],
    ) -> None:
        if not client and not lead.conversation_id:
            omitted_sources.append({"source_type": "project", "reason": "not_linked"})
            return
        try:
            query = self.db.query(Project)
            if lead.conversation_id:
                query = query.filter(Project.source_conversation_id == lead.conversation_id)
                project = query.order_by(Project.updated_at.desc()).first()
            else:
                project = None
            if not project and client:
                query = self.db.query(Project).filter(Project.client_id == client.id)
                if not self._actor_can_use_related_records(actor):
                    query = query.filter(
                        (Project.owner_user_id == actor.id)
                        | (Project.created_by_user_id == actor.id)
                    )
                project = query.order_by(Project.updated_at.desc()).first()
        except SQLAlchemyError as exc:
            self._record_source_error("project", exc, omitted_sources)
            return
        if not project:
            omitted_sources.append(
                {
                    "source_type": "project",
                    "reason": "not_permitted" if client and not self._actor_can_use_related_records(actor) else "not_linked",
                }
            )
            return
        for key, value, field in [
            ("project.title", project.title, "title"),
            ("project.stage", project.stage, "stage"),
            ("project.status", project.status.value if hasattr(project.status, "value") else project.status, "status"),
        ]:
            self._append_fact(
                facts,
                key=key,
                value=value,
                source_type="project",
                source_id=str(project.id),
                source_field=field,
            )

    def _add_proposal_facts(
        self,
        actor: User,
        client: Client | None,
        facts: list[dict[str, Any]],
        omitted_sources: list[dict[str, str]],
    ) -> None:
        if not client:
            omitted_sources.append({"source_type": "proposal", "reason": "not_linked"})
            return
        try:
            query = self.db.query(Proposal).filter(
                Proposal.client_id == client.id,
                Proposal.status.in_(ALLOWED_PROPOSAL_STATUSES),
            )
            if not self._actor_can_use_related_records(actor):
                query = query.filter(
                    (Proposal.owner_user_id == actor.id)
                    | (Proposal.created_by_user_id == actor.id)
                )
            proposal = query.order_by(Proposal.updated_at.desc()).first()
        except SQLAlchemyError as exc:
            self._record_source_error("proposal", exc, omitted_sources)
            return
        if not proposal:
            omitted_sources.append(
                {
                    "source_type": "proposal",
                    "reason": "not_permitted" if not self._actor_can_use_related_records(actor) else "not_linked",
                }
            )
            return
        for key, value, field in [
            ("proposal.title", proposal.title, "title"),
            ("proposal.status", proposal.status.value if hasattr(proposal.status, "value") else proposal.status, "status"),
            ("proposal.total_amount", proposal.total_amount, "total_amount"),
        ]:
            self._append_fact(
                facts,
                key=key,
                value=value,
                source_type="proposal",
                source_id=str(proposal.id),
                source_field=field,
            )

    def _add_catalog_facts(
        self,
        lead: Lead,
        client: Client | None,
        channel: str | None,
        facts: list[dict[str, Any]],
        omitted_sources: list[dict[str, str]],
    ) -> None:
        if channel and channel not in OUTREACH_CHANNELS:
            omitted_sources.append({"source_type": "catalog_item", "reason": "not_permitted"})
            return
        if not client and not lead.company:
            omitted_sources.append({"source_type": "catalog_item", "reason": "not_linked"})
            return
        try:
            items = (
                self.db.query(CatalogItem)
                .filter(
                    CatalogItem.status == CatalogItemStatus.ACTIVE,
                    CatalogItem.active_for_support.is_(True),
                )
                .order_by(CatalogItem.updated_at.desc())
                .limit(2)
                .all()
            )
        except SQLAlchemyError as exc:
            self._record_source_error("catalog_item", exc, omitted_sources)
            return
        if not items:
            omitted_sources.append({"source_type": "catalog_item", "reason": "not_linked"})
            return
        for item in items:
            self._append_fact(
                facts,
                key="catalog_item.commercial_name",
                value=item.commercial_name,
                source_type="catalog_item",
                source_id=str(item.id),
                source_field="commercial_name",
            )

    def _append_fact(
        self,
        facts: list[dict[str, Any]],
        *,
        key: str,
        value: Any,
        source_type: str,
        source_id: str,
        source_field: str,
        confidence: float | None = None,
    ) -> None:
        clean_value = self._safe_value(key, value)
        if clean_value is None:
            return
        facts.append(
            {
                "key": key,
                "value": clean_value,
                "source_type": source_type,
                "source_id": source_id,
                "source_field": source_field,
                "confidence": confidence,
            }
        )

    def _append_inference(
        self,
        inferences: list[dict[str, Any]],
        *,
        key: str,
        value: Any,
        source_id: str,
        source_field: str,
        confidence: float | None = None,
        rationale: str | None = None,
    ) -> None:
        clean_value = self._safe_value(key, value)
        if clean_value is None:
            return
        inferences.append(
            {
                "key": key,
                "value": clean_value,
                "source_type": "lead_enrichment",
                "source_id": source_id,
                "source_field": source_field,
                "confidence": confidence,
                "rationale": self._safe_value(f"{key}.rationale", rationale),
            }
        )

    def _actor_can_use_related_records(self, actor: User) -> bool:
        return bool(
            actor.user_type
            and (actor.user_type.can_view_all_conversations or actor.user_type.can_change_settings)
        )

    def _record_source_error(
        self,
        source_type: str,
        exc: SQLAlchemyError,
        omitted_sources: list[dict[str, str]],
    ) -> None:
        log.warning("outreach_grounding: source %s unavailable: %s", source_type, exc)
        self.db.rollback()
        omitted_sources.append({"source_type": source_type, "reason": "source_error"})

    def _safe_value(self, key: str, value: Any) -> Any:
        if value is None or value == "":
            return None
        lowered_key = key.lower()
        if any(part in lowered_key for part in SENSITIVE_FIELD_PARTS):
            return None
        if isinstance(value, dict):
            safe = {
                item_key: self._safe_value(f"{key}.{item_key}", item_value)
                for item_key, item_value in value.items()
            }
            return {item_key: item_value for item_key, item_value in safe.items() if item_value is not None} or None
        if isinstance(value, list):
            safe_items = [self._safe_value(key, item) for item in value]
            return [item for item in safe_items if item is not None] or None
        if isinstance(value, str):
            lowered_value = value.lower()
            if any(marker in lowered_value for marker in ["access_token", "secret", "password"]):
                return None
            if any(part in lowered_value for part in SENSITIVE_FIELD_PARTS):
                return None
            return self._redact_sensitive_text(value)
        return value

    def _redact_sensitive_text(self, value: str) -> str:
        redacted = EMAIL_RE.sub("[redacted-email]", value)
        redacted = PHONE_RE.sub("[redacted-phone]", redacted)
        return redacted

    def _has_personalization_context(
        self,
        facts: list[dict[str, Any]],
        inferences: list[dict[str, Any]],
    ) -> bool:
        if inferences:
            return True
        minimal_fact_keys = {
            "lead.source_channel",
            "lead.status",
            "lead.identity_status",
            "lead.identity_confidence",
            "lead.identity_match_reasons",
        }
        return any(
            item["key"] not in minimal_fact_keys
            and item["source_type"] != "catalog_item"
            for item in facts
        )

    def _citations(
        self,
        facts: list[dict[str, Any]],
        inferences: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        seen: set[tuple[str, str, str]] = set()
        citations: list[dict[str, str]] = []
        for item in [*facts, *inferences]:
            key = (item["source_type"], item["source_id"], item["source_field"])
            if key in seen:
                continue
            seen.add(key)
            citations.append(
                {
                    "source_type": item["source_type"],
                    "source_id": item["source_id"],
                    "source_field": item["source_field"],
                }
            )
        return citations

    def _dedupe_omissions(self, omitted_sources: list[dict[str, str]]) -> list[dict[str, str]]:
        seen: set[tuple[str, str]] = set()
        result: list[dict[str, str]] = []
        for item in omitted_sources:
            key = (item["source_type"], item["reason"])
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
        return result
