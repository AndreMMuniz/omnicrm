from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.models import User
from app.schemas.common import create_error_response, create_paginated_response, create_response
from app.models.models import ProposalServiceDetails
from app.schemas.proposal import (
    ProposalCreate,
    ProposalDetailResponse,
    ProposalFromCatalogCreate,
    ProposalItemFromCatalogCreate,
    ProposalItemUpdate,
    ProposalResponse,
    ProposalServiceDetailsCreate,
    ProposalServiceDetailsResponse,
    ProposalServiceDetailsUpdate,
    ProposalUpdate,
)
from app.services.proposal_service import ProposalService, serialize_proposal, serialize_service_details

router = APIRouter()


@router.get("/proposals")
@limiter.limit("60/minute")
async def list_proposals(
    request: Request,
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProposalService(db)
    proposals = await service.proposals.list_with_filters(skip=skip, limit=limit, search=search, status=status)
    total = await service.proposals.count_with_filters(search=search, status=status)
    return create_paginated_response(
        data=[ProposalResponse.model_validate(serialize_proposal(proposal)) for proposal in proposals],
        total=total,
        page=(skip // limit) + 1,
        page_size=limit,
    )


@router.post("/proposals")
@limiter.limit("60/minute")
async def create_proposal(
    request: Request,
    payload: ProposalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    proposal = await ProposalService(db).create_proposal(payload, current_user)
    return create_response(ProposalResponse.model_validate(serialize_proposal(proposal)))


@router.get("/proposals/{proposal_id}")
@limiter.limit("60/minute")
async def get_proposal(
    request: Request,
    proposal_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    proposal = await ProposalService(db).proposals.find_proposal(proposal_id)
    if not proposal:
        error_response, status = create_error_response(
            code="PROPOSAL_NOT_FOUND",
            message="Proposal not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    return create_response(ProposalDetailResponse.model_validate(serialize_proposal(proposal, include_items=True)))


@router.patch("/proposals/{proposal_id}")
@limiter.limit("60/minute")
async def update_proposal(
    request: Request,
    proposal_id: UUID,
    payload: ProposalUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProposalService(db)
    proposal = await service.proposals.find_proposal(proposal_id)
    if not proposal:
        error_response, status = create_error_response(
            code="PROPOSAL_NOT_FOUND",
            message="Proposal not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    updated = await service.update_proposal(proposal, payload, current_user)
    return create_response(ProposalResponse.model_validate(serialize_proposal(updated)))


@router.post("/proposals/from-catalog/{catalog_item_id}")
@limiter.limit("60/minute")
async def create_proposal_from_catalog(
    request: Request,
    catalog_item_id: UUID,
    payload: ProposalFromCatalogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    proposal = await ProposalService(db).create_proposal_from_catalog(catalog_item_id, payload, current_user)
    return create_response(ProposalDetailResponse.model_validate(serialize_proposal(proposal, include_items=True)))


@router.post("/proposals/{proposal_id}/items/from-catalog/{catalog_item_id}")
@limiter.limit("60/minute")
async def add_catalog_item_to_proposal(
    request: Request,
    proposal_id: UUID,
    catalog_item_id: UUID,
    payload: ProposalItemFromCatalogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProposalService(db)
    await service.add_catalog_item_to_proposal(
        proposal_id=proposal_id,
        catalog_item_id=catalog_item_id,
        payload=payload,
    )
    proposal = await service.proposals.find_proposal(proposal_id)
    return create_response(ProposalDetailResponse.model_validate(serialize_proposal(proposal, include_items=True)))


@router.patch("/proposals/{proposal_id}/items/{proposal_item_id}")
@limiter.limit("60/minute")
async def update_proposal_item(
    request: Request,
    proposal_id: UUID,
    proposal_item_id: UUID,
    payload: ProposalItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProposalService(db)
    await service.update_proposal_item(
        proposal_id=proposal_id,
        proposal_item_id=proposal_item_id,
        payload=payload,
    )
    proposal = await service.proposals.find_proposal(proposal_id)
    return create_response(ProposalDetailResponse.model_validate(serialize_proposal(proposal, include_items=True)))


@router.delete("/proposals/{proposal_id}/items/{proposal_item_id}")
@limiter.limit("60/minute")
async def delete_proposal_item(
    request: Request,
    proposal_id: UUID,
    proposal_item_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProposalService(db)
    await service.delete_proposal_item(
        proposal_id=proposal_id,
        proposal_item_id=proposal_item_id,
    )
    proposal = await service.proposals.find_proposal(proposal_id)
    return create_response(ProposalDetailResponse.model_validate(serialize_proposal(proposal, include_items=True)))


@router.delete("/proposals/{proposal_id}")
@limiter.limit("30/minute")
async def delete_proposal(
    request: Request,
    proposal_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    await ProposalService(db).delete_proposal(proposal_id)
    return create_response({"deleted": True, "proposal_id": str(proposal_id)})


# ── service details ────────────────────────────────────────────────────────────

def _get_proposal_or_404(db: Session, proposal_id: UUID):
    from app.models.models import Proposal as _Proposal
    from sqlalchemy import select
    from sqlalchemy.orm import joinedload
    stmt = (
        select(_Proposal)
        .options(
            joinedload(_Proposal.created_by),
            joinedload(_Proposal.items),
            joinedload(_Proposal.service_details),
        )
        .where(_Proposal.id == proposal_id)
    )
    proposal = db.execute(stmt).unique().scalars().first()
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")
    return proposal


@router.post("/proposals/{proposal_id}/service-details")
@limiter.limit("30/minute")
async def create_service_details(
    request: Request,
    proposal_id: UUID,
    payload: ProposalServiceDetailsCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    _get_proposal_or_404(db, proposal_id)

    existing = db.query(ProposalServiceDetails).filter(
        ProposalServiceDetails.proposal_id == proposal_id
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Detalhes de serviço já existem. Use PATCH para atualizar.")

    import uuid as _uuid
    sd = ProposalServiceDetails(
        id=_uuid.uuid4(),
        proposal_id=proposal_id,
        **payload.model_dump(),
    )
    db.add(sd)
    db.commit()
    db.refresh(sd)
    return create_response(ProposalServiceDetailsResponse.model_validate(serialize_service_details(sd)))


@router.patch("/proposals/{proposal_id}/service-details")
@limiter.limit("30/minute")
async def update_service_details(
    request: Request,
    proposal_id: UUID,
    payload: ProposalServiceDetailsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    _get_proposal_or_404(db, proposal_id)

    sd = db.query(ProposalServiceDetails).filter(
        ProposalServiceDetails.proposal_id == proposal_id
    ).first()
    if not sd:
        raise HTTPException(status_code=404, detail="Detalhes de serviço não encontrados. Use POST para criar.")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sd, field, value)

    db.commit()
    db.refresh(sd)
    return create_response(ProposalServiceDetailsResponse.model_validate(serialize_service_details(sd)))
