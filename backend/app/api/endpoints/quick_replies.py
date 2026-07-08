"""Quick Reply endpoints — CRUD for admin panel + search for chat input."""

from typing import Dict, Any, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_permission, get_current_user
from app.models.models import QuickReply, User
from app.schemas.quick_reply import QuickReplyCreate, QuickReplyUpdate, QuickReplyResponse
from app.schemas.common import create_response, create_paginated_response, create_error_response

router = APIRouter()


# ── Chat: search by shortcut prefix (used in autocomplete) ───────────────────

@router.get("/quick-replies/search")
async def search_quick_replies(
    q: str = Query("", description="Shortcut prefix to search"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Search quick replies by shortcut prefix. Returns top 5 matches."""
    query = db.query(QuickReply)
    if q:
        pattern = f"%{q.lower()}%"
        query = query.filter(QuickReply.shortcut.ilike(pattern))
    results = query.order_by(QuickReply.shortcut).limit(5).all()
    return create_response([QuickReplyResponse.model_validate(r) for r in results])


# ── Admin: CRUD ───────────────────────────────────────────────────────────────

@router.get("/quick-replies")
async def list_quick_replies(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """List all quick replies."""
    results = db.query(QuickReply).order_by(QuickReply.shortcut).offset(skip).limit(limit).all()
    total = db.query(QuickReply).count()
    return create_paginated_response(
        data=[QuickReplyResponse.model_validate(r) for r in results],
        total=total,
        page=(skip // limit) + 1,
        page_size=limit,
    )


@router.post("/quick-replies")
async def create_quick_reply(
    data: QuickReplyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_change_settings")),
) -> Dict[str, Any]:
    """Create a new quick reply shortcut."""
    # Normalize shortcut: ensure it starts with /
    shortcut = data.shortcut if data.shortcut.startswith("/") else f"/{data.shortcut}"

    existing = db.query(QuickReply).filter(QuickReply.shortcut == shortcut).first()
    if existing:
        error_response, status = create_error_response(
            code="DUPLICATE_SHORTCUT",
            message=f"Shortcut '{shortcut}' already exists",
            details={"field": "shortcut", "value": shortcut},
            status_code=409,
        )
        raise HTTPException(status_code=status, detail=error_response)

    qr = QuickReply(shortcut=shortcut, content=data.content)
    db.add(qr)
    db.commit()
    db.refresh(qr)
    return create_response(QuickReplyResponse.model_validate(qr))


@router.patch("/quick-replies/{qr_id}")
async def update_quick_reply(
    qr_id: UUID,
    data: QuickReplyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_change_settings")),
) -> Dict[str, Any]:
    """Update a quick reply shortcut or content."""
    qr = db.query(QuickReply).filter(QuickReply.id == qr_id).first()
    if not qr:
        error_response, status = create_error_response(
            code="NOT_FOUND", message="Quick reply not found", status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    if data.shortcut is not None:
        shortcut = data.shortcut if data.shortcut.startswith("/") else f"/{data.shortcut}"
        clash = db.query(QuickReply).filter(
            QuickReply.shortcut == shortcut, QuickReply.id != qr_id
        ).first()
        if clash:
            error_response, status = create_error_response(
                code="DUPLICATE_SHORTCUT",
                message=f"Shortcut '{shortcut}' already exists",
                status_code=409,
            )
            raise HTTPException(status_code=status, detail=error_response)
        qr.shortcut = shortcut

    if data.content is not None:
        qr.content = data.content

    db.commit()
    db.refresh(qr)
    return create_response(QuickReplyResponse.model_validate(qr))


@router.delete("/quick-replies/{qr_id}")
async def delete_quick_reply(
    qr_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_change_settings")),
) -> Dict[str, Any]:
    """Delete a quick reply."""
    qr = db.query(QuickReply).filter(QuickReply.id == qr_id).first()
    if not qr:
        error_response, status = create_error_response(
            code="NOT_FOUND", message="Quick reply not found", status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    db.delete(qr)
    db.commit()
    return create_response({"detail": "Quick reply deleted"})
