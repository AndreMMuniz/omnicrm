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
        items=[_serialize_lead(l) for l in leads],
        total=total,
        skip=skip,
        limit=limit,
    )


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
