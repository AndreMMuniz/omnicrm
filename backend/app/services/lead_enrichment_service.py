import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.models import Contact, Conversation, Lead, Message


log = logging.getLogger(__name__)

LeadEnrichmentProvider = Callable[[dict[str, Any]], dict[str, Any]]


class LeadEnrichmentService:
    """Build and persist an operator-safe commercial profile for a captured lead."""

    def __init__(
        self,
        db: Session,
        enrichment_provider: LeadEnrichmentProvider | None = None,
    ) -> None:
        self.db = db
        self.enrichment_provider = enrichment_provider or self._default_provider

    def enrich_lead(self, lead_id: UUID | str) -> Lead:
        lead = self._get_lead(lead_id)
        context = self._build_context(lead)

        try:
            raw_result = self.enrichment_provider(context) or {}
            normalized = self._normalize_result(raw_result)
            lead.role = normalized["role"]
            lead.pain_points = normalized["pain_points"]
            lead.qualification_notes = normalized["qualification_notes"]
            lead.source_facts = context["source_facts"]
            lead.ai_inferences = normalized["ai_inferences"]
            lead.enrichment_status = "completed"
            lead.enrichment_error = None
            lead.enriched_at = datetime.now(timezone.utc)
        except Exception as exc:
            log.exception("lead_enrichment: failed for lead %s", lead_id)
            lead.enrichment_status = "failed"
            lead.enrichment_error = self._sanitize_error(exc)
            lead.enriched_at = datetime.now(timezone.utc)

        self.db.add(lead)
        self.db.commit()
        self.db.refresh(lead)
        return lead

    def _get_lead(self, lead_id: UUID | str) -> Lead:
        lead = (
            self.db.query(Lead)
            .options(
                joinedload(Lead.conversation)
                .joinedload(Conversation.contact)
                .joinedload(Contact.client)
            )
            .filter(Lead.id == lead_id)
            .first()
        )
        if not lead:
            raise LookupError(f"Lead not found: {lead_id}")
        return lead

    def _build_context(self, lead: Lead) -> dict[str, Any]:
        conversation = lead.conversation
        contact = conversation.contact if conversation else None
        client = contact.client if contact and contact.client else None
        messages = self._conversation_messages(conversation.id) if conversation else []

        source_facts: dict[str, Any] = {
            "lead": {
                "name": lead.name,
                "company": lead.company,
                "source_channel": lead.source_channel,
                "status": lead.status.value if hasattr(lead.status, "value") else lead.status,
                "extraction_confidence": lead.extraction_confidence or {},
            },
            "conversation": {
                "id": str(conversation.id) if conversation else None,
                "channel": (
                    conversation.channel.value
                    if conversation and hasattr(conversation.channel, "value")
                    else str(conversation.channel) if conversation else None
                ),
                "message_count": len(messages),
            },
            "contact": {
                "id": str(contact.id) if contact else None,
                "name": contact.name if contact else None,
                "email_present": bool(contact.email) if contact else False,
                "phone_present": bool(contact.phone) if contact else False,
            },
            "linked_company": {
                "id": str(client.id) if client else None,
                "name": client.name if client else None,
                "company_name": client.company_name if client else None,
                "country": client.country if client else None,
            },
        }

        return {
            "lead_id": str(lead.id),
            "source_facts": source_facts,
            "messages": messages,
            "conversation_text": "\n".join(f"{m['role']}: {m['content']}" for m in messages),
        }

    def _conversation_messages(self, conversation_id: UUID) -> list[dict[str, str]]:
        rows = (
            self.db.query(Message)
            .filter(Message.conversation_id == conversation_id, Message.is_internal == False)
            .order_by(Message.conversation_sequence.asc(), Message.created_at.asc())
            .limit(20)
            .all()
        )
        return [
            {
                "role": "customer" if row.inbound else "agent",
                "content": row.content or "",
                "created_at": row.created_at.isoformat() if row.created_at else "",
            }
            for row in rows
        ]

    def _default_provider(self, context: dict[str, Any]) -> dict[str, Any]:
        text = context.get("conversation_text", "")
        lowered = text.lower()
        role = self._infer_role(lowered)
        pain_points = self._infer_pain_points(lowered)
        notes = self._build_notes(role, pain_points, context["source_facts"])
        return {
            "role": {
                "value": role,
                "confidence": 0.58 if role else 0.0,
                "rationale": "Derived from commercial conversation wording.",
            } if role else None,
            "pain_points": [
                {
                    "value": item,
                    "confidence": 0.62,
                    "rationale": "Derived from repeated operational concern in conversation text.",
                }
                for item in pain_points
            ],
            "qualification_notes": notes,
        }

    def _infer_role(self, lowered_text: str) -> str | None:
        role_patterns = [
            (r"\b(?:i manage|i lead|responsible for|head of)\b.*\b(operation|operations|support|sales|commercial)\b", "Operations Manager"),
            (r"\b(?:founder|owner|ceo|director)\b", "Decision Maker"),
            (r"\b(?:procurement|buying|purchase)\b", "Procurement Contact"),
        ]
        for pattern, role in role_patterns:
            if re.search(pattern, lowered_text):
                return role
        return None

    def _infer_pain_points(self, lowered_text: str) -> list[str]:
        candidates = [
            ("fragment", "fragmented channel follow-up"),
            ("queue", "support queue visibility"),
            ("slow", "slow response handoff"),
            ("follow-up", "follow-up tracking"),
            ("follow up", "follow-up tracking"),
            ("proposal", "proposal follow-up clarity"),
        ]
        found: list[str] = []
        for needle, label in candidates:
            if needle in lowered_text and label not in found:
                found.append(label)
        return found[:5]

    def _build_notes(
        self,
        role: str | None,
        pain_points: list[str],
        source_facts: dict[str, Any],
    ) -> str | None:
        company = source_facts.get("linked_company", {}).get("name") or source_facts.get("lead", {}).get("company")
        parts = []
        if role:
            parts.append(f"Likely role: {role}.")
        if company:
            parts.append(f"Company context: {company}.")
        if pain_points:
            parts.append("Pain points: " + ", ".join(pain_points) + ".")
        return " ".join(parts) or None

    def _normalize_result(self, result: dict[str, Any]) -> dict[str, Any]:
        role_result = result.get("role")
        role = self._value_from_inference(role_result)
        pain_points, pain_point_inferences = self._normalize_pain_points(result.get("pain_points"))
        return {
            "role": role,
            "pain_points": pain_points,
            "qualification_notes": self._clean_text(result.get("qualification_notes")),
            "ai_inferences": {
                "role": self._normalize_inference(role_result),
                "pain_points": pain_point_inferences,
            },
        }

    def _normalize_pain_points(self, raw_items: Any) -> tuple[list[str], list[dict[str, Any]]]:
        if raw_items is None:
            items: list[Any] = []
        elif isinstance(raw_items, list):
            items = raw_items
        else:
            items = [raw_items]

        values: list[str] = []
        inferences: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in items:
            inference = self._normalize_inference(item)
            value = inference.get("value") if inference else None
            if not value:
                continue
            key = value.casefold()
            if key in seen:
                continue
            seen.add(key)
            values.append(value)
            inferences.append(inference)
            if len(values) >= 5:
                break
        return values, inferences

    def _value_from_inference(self, value: Any) -> str | None:
        if isinstance(value, dict):
            return self._clean_text(value.get("value"))
        return self._clean_text(value)

    def _normalize_inference(self, value: Any) -> dict[str, Any] | None:
        if not value:
            return None
        if isinstance(value, dict):
            return {
                "value": self._clean_text(value.get("value")),
                "confidence": self._safe_confidence(value.get("confidence")),
                "rationale": self._clean_text(value.get("rationale")),
            }
        return {"value": self._clean_text(value), "confidence": None, "rationale": None}

    def _safe_confidence(self, value: Any) -> float | None:
        try:
            if value is None:
                return None
            number = float(value)
            return max(0.0, min(number, 1.0))
        except (TypeError, ValueError):
            return None

    def _clean_text(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        return text[:1000]

    def _sanitize_error(self, exc: Exception) -> str:
        return "Lead enrichment failed. Check server logs for diagnostic details."
