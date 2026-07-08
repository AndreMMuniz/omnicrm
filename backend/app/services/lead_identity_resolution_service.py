from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.hashing import hash_identifier
from app.models.models import Lead, LeadIdentity


@dataclass(frozen=True)
class LeadIdentityResolutionResult:
    lead_identity_id: str | None
    status: str
    confidence: float
    match_reasons: list[str]
    review_required: bool
    candidates: list[dict[str, Any]]


class LeadIdentityResolutionService:
    """Resolve repeated lead captures into deterministic operator-reviewable identities."""

    STRONG_MATCH_CONFIDENCE = 0.95
    AMBIGUOUS_NAME_COMPANY_CONFIDENCE = 0.65

    def __init__(self, db: Session):
        self.db = db

    def resolve_for_lead(self, lead_id: UUID | str) -> LeadIdentityResolutionResult:
        lead = self.db.query(Lead).filter(Lead.id == lead_id).first()
        if not lead:
            raise LookupError(f"Lead not found: {lead_id}")

        signals = self._signals_for_lead(lead)
        exact_matches = self._find_exact_matches(signals)
        if len(exact_matches) == 1:
            exact_identity, exact_reasons = next(iter(exact_matches.values()))
            return self._attach(
                lead=lead,
                identity=exact_identity,
                status="resolved",
                confidence=self.STRONG_MATCH_CONFIDENCE,
                match_reasons=exact_reasons,
                review_required=False,
                candidates=[],
            )
        if len(exact_matches) > 1:
            candidates = [self._candidate_payload(identity) for identity, _ in exact_matches.values()]
            return self._mark_ambiguous(
                lead=lead,
                confidence=self.STRONG_MATCH_CONFIDENCE,
                match_reasons=["conflicting_exact_identifier_match"],
                candidates=candidates,
            )

        ambiguous_candidates = self._find_ambiguous_candidates(signals)
        if ambiguous_candidates:
            candidates = [self._candidate_payload(candidate) for candidate in ambiguous_candidates]
            return self._mark_ambiguous(
                lead=lead,
                confidence=self.AMBIGUOUS_NAME_COMPANY_CONFIDENCE,
                match_reasons=["normalized_name_company_match"],
                candidates=candidates,
            )

        identity = LeadIdentity(
            display_name=lead.name,
            company=lead.company,
            email_hash=signals["email_hash"],
            phone_hash=signals["phone_hash"],
            normalized_name=signals["normalized_name"],
            normalized_company=signals["normalized_company"],
            resolution_status="resolved",
            confidence=1.0 if (signals["email_hash"] or signals["phone_hash"]) else 0.5,
            match_reasons=["new_identity"],
        )
        self.db.add(identity)
        self.db.flush()
        return self._attach(
            lead=lead,
            identity=identity,
            status="resolved" if (signals["email_hash"] or signals["phone_hash"]) else "needs_review",
            confidence=identity.confidence,
            match_reasons=["new_identity"],
            review_required=not (signals["email_hash"] or signals["phone_hash"]),
            candidates=[],
        )

    def _signals_for_lead(self, lead: Lead) -> dict[str, str | None]:
        return {
            "email_hash": hash_identifier(lead.email) if lead.email else getattr(lead, "email_hash", None),
            "phone_hash": hash_identifier(self._normalize_phone(lead.phone)) if lead.phone else getattr(lead, "phone_hash", None),
            "normalized_name": self._normalize_text(lead.name),
            "normalized_company": self._normalize_text(lead.company),
        }

    def _find_exact_matches(self, signals: dict[str, str | None]) -> dict[str, tuple[LeadIdentity, list[str]]]:
        matches: dict[str, tuple[LeadIdentity, list[str]]] = {}
        if signals["email_hash"]:
            for identity in (
                self.db.query(LeadIdentity)
                .filter(LeadIdentity.email_hash == signals["email_hash"])
                .order_by(LeadIdentity.created_at.asc())
                .all()
            ):
                key = str(identity.id)
                _, reasons = matches.setdefault(key, (identity, []))
                reasons.append("email_hash_match")
        if signals["phone_hash"]:
            for identity in (
                self.db.query(LeadIdentity)
                .filter(LeadIdentity.phone_hash == signals["phone_hash"])
                .order_by(LeadIdentity.created_at.asc())
                .all()
            ):
                key = str(identity.id)
                _, reasons = matches.setdefault(key, (identity, []))
                reasons.append("phone_hash_match")
        return matches

    def _find_ambiguous_candidates(self, signals: dict[str, str | None]) -> list[LeadIdentity]:
        if not signals["normalized_name"] or not signals["normalized_company"]:
            return []
        return (
            self.db.query(LeadIdentity)
            .filter(
                LeadIdentity.normalized_name == signals["normalized_name"],
                LeadIdentity.normalized_company == signals["normalized_company"],
            )
            .order_by(LeadIdentity.created_at.asc())
            .limit(5)
            .all()
        )

    def _attach(
        self,
        *,
        lead: Lead,
        identity: LeadIdentity,
        status: str,
        confidence: float,
        match_reasons: list[str],
        review_required: bool,
        candidates: list[dict[str, Any]],
    ) -> LeadIdentityResolutionResult:
        now = datetime.now(timezone.utc)
        identity.resolution_status = "resolved" if not review_required else status
        identity.confidence = max(float(identity.confidence or 0), confidence)
        identity.match_reasons = self._dedupe([*(identity.match_reasons or []), *match_reasons])
        identity.updated_at = now

        lead.lead_identity_id = identity.id
        lead.identity_resolution_status = status
        lead.identity_confidence = confidence
        lead.identity_match_reasons = match_reasons
        lead.identity_review_required = review_required
        lead.identity_candidates = candidates
        self.db.commit()
        self.db.refresh(lead)
        return LeadIdentityResolutionResult(
            lead_identity_id=str(identity.id),
            status=status,
            confidence=confidence,
            match_reasons=match_reasons,
            review_required=review_required,
            candidates=candidates,
        )

    def _mark_ambiguous(
        self,
        *,
        lead: Lead,
        confidence: float,
        match_reasons: list[str],
        candidates: list[dict[str, Any]],
    ) -> LeadIdentityResolutionResult:
        lead.lead_identity_id = None
        lead.identity_resolution_status = "ambiguous"
        lead.identity_confidence = confidence
        lead.identity_match_reasons = match_reasons
        lead.identity_review_required = True
        lead.identity_candidates = candidates
        self.db.commit()
        self.db.refresh(lead)
        return LeadIdentityResolutionResult(
            lead_identity_id=None,
            status="ambiguous",
            confidence=confidence,
            match_reasons=match_reasons,
            review_required=True,
            candidates=candidates,
        )

    def _candidate_payload(self, identity: LeadIdentity) -> dict[str, Any]:
        return {
            "lead_identity_id": str(identity.id),
            "display_name": identity.display_name,
            "company": identity.company,
            "confidence": identity.confidence,
            "match_reasons": identity.match_reasons or [],
        }

    def _normalize_phone(self, value: str | None) -> str | None:
        if not value:
            return None
        digits = re.sub(r"\D", "", value)
        return digits or None

    def _normalize_text(self, value: str | None) -> str | None:
        if not value:
            return None
        lowered = value.strip().lower()
        collapsed = re.sub(r"\s+", " ", lowered)
        normalized = re.sub(r"[^\w\s]", "", collapsed)
        return normalized.strip() or None

    def _dedupe(self, values: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            result.append(value)
        return result
