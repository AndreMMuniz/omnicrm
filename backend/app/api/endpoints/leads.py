"""Leads API — Sprint 1.

GET  /leads            list with pagination + filters
GET  /leads/{id}       single lead with masked PII
"""

import re
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.limiter import limiter
from app.models.models import Conversation, Lead, LeadStatus
from app.schemas.common import create_paginated_response, create_response
from app.services.lead_enrichment_service import LeadEnrichmentService
from app.services.lead_scoring_service import LeadScoringService

router = APIRouter()


# ── PII masking helpers ───────────────────────────────────────────────────────

def _mask_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    parts = email.split("@")
    if len(parts) != 2:
        return "***"
    local = parts[0]
    return f"{local[:3]}***@{parts[1]}"


def _mask_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 4:
        return "***"
    return f"{'*' * (len(digits) - 4)}{digits[-4:]}"


def _serialize_lead(lead: Lead, reveal: bool = False) -> Dict[str, Any]:
    return {
        "id": str(lead.id),
        "conversation_id": str(lead.conversation_id) if lead.conversation_id else None,
        "name": lead.name or "Desconhecido",
        "email": lead.email if reveal else _mask_email(lead.email),
        "phone": lead.phone if reveal else _mask_phone(lead.phone),
        "company": lead.company,
        "source_channel": lead.source_channel,
        "status": lead.status.value if lead.status else LeadStatus.NEW.value,
        "extraction_confidence": lead.extraction_confidence or {},
        "duplicate_risk": lead.duplicate_risk,
        "lead_identity_id": str(lead.lead_identity_id) if lead.lead_identity_id else None,
        "identity_resolution_status": lead.identity_resolution_status or "unresolved",
        "identity_confidence": lead.identity_confidence,
        "identity_match_reasons": lead.identity_match_reasons or [],
        "identity_review_required": bool(lead.identity_review_required),
        "identity_candidates": lead.identity_candidates or [],
        "role": lead.role,
        "pain_points": lead.pain_points or [],
        "qualification_notes": lead.qualification_notes,
        "source_facts": lead.source_facts or {},
        "ai_inferences": lead.ai_inferences or {},
        "enrichment_status": lead.enrichment_status or "pending",
        "enrichment_error": lead.enrichment_error,
        "enriched_at": lead.enriched_at.isoformat() if lead.enriched_at else None,
        "score": lead.score,
        "qualification_label": lead.qualification_label,
        "score_confidence": lead.score_confidence,
        "low_confidence": (
            lead.score_confidence is not None
            and lead.qualification_label == "low_confidence"
        ),
        "score_breakdown": lead.score_breakdown or [],
        "score_rationale": lead.score_rationale,
        "scoring_version": lead.scoring_version,
        "scored_at": lead.scored_at.isoformat() if lead.scored_at else None,
        "created_at": lead.created_at.isoformat() if lead.created_at else None,
        "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
@limiter.limit("60/minute")
async def list_leads(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """List leads with pagination and optional filters."""
    q = db.query(Lead).order_by(Lead.created_at.desc())

    if status:
        try:
            status_enum = LeadStatus(status)
            q = q.filter(Lead.status == status_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    if channel:
        q = q.filter(Lead.source_channel == channel)

    total = q.count()
    leads = q.offset(skip).limit(limit).all()

    return create_paginated_response(
        data=[_serialize_lead(l) for l in leads],
        total=total,
        page=(skip // limit) + 1,
        page_size=limit,
    )


@router.get("/scoring/config")
@limiter.limit("30/minute")
async def get_scoring_config(
    request: Request,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Return the active lead scoring config."""
    return create_response(LeadScoringService(db).get_config().to_dict())


@router.patch("/scoring/config")
@limiter.limit("10/minute")
async def update_scoring_config(
    request: Request,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Update scoring thresholds and component weights."""
    try:
        config = LeadScoringService(db).save_config(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return create_response(config.to_dict())


@router.get("/{lead_id}")
@limiter.limit("60/minute")
async def get_lead(
    request: Request,
    lead_id: UUID,
    reveal: bool = Query(False, description="Reveal masked PII fields"),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Get a single lead. PII is masked by default; pass ?reveal=true to unmask."""
    lead = (
        db.query(Lead)
        .options(joinedload(Lead.conversation))
        .filter(Lead.id == lead_id)
        .first()
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    data = _serialize_lead(lead, reveal=reveal)

    # Attach conversation message count if available
    if lead.conversation:
        data["message_count"] = len(lead.conversation.messages)

    return create_response(data)


@router.post("/{lead_id}/score")
@limiter.limit("30/minute")
async def score_lead(
    request: Request,
    lead_id: UUID,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Calculate or recalculate a lead score using the active config."""
    try:
        LeadScoringService(db).score_lead(lead_id)
    except ValueError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc))
        raise HTTPException(status_code=400, detail=str(exc))

    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    return create_response(_serialize_lead(lead))


@router.patch("/{lead_id}/status")
@limiter.limit("30/minute")
async def update_lead_status(
    request: Request,
    lead_id: UUID,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Update lead status (new → contacted → converted / disqualified)."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    new_status = body.get("status")
    if not new_status:
        raise HTTPException(status_code=400, detail="Field 'status' is required")

    try:
        lead.status = LeadStatus(new_status)
    except ValueError:
        valid = [s.value for s in LeadStatus]
        raise HTTPException(status_code=400, detail=f"Invalid status. Valid: {valid}")

    db.commit()
    db.refresh(lead)
    return create_response(_serialize_lead(lead))


@router.post("/{lead_id}/enrich")
@limiter.limit("20/minute")
async def enrich_lead(
    request: Request,
    lead_id: UUID,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Retry lead enrichment without changing lead creation semantics."""
    try:
        lead = LeadEnrichmentService(db).enrich_lead(lead_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Lead not found")

    return create_response(_serialize_lead(lead))
