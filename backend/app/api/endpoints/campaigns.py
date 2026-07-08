from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.models import User
from app.schemas.campaign import (
    CampaignGenerateStepsRequest,
    CampaignLaunchRequest,
    CampaignStateTransitionRequest,
    CampaignStepReviewRequest,
    CampaignStepSkipRequest,
)
from app.schemas.common import create_response
from app.services.outreach_campaign_service import OutreachCampaignService


router = APIRouter()


def _raise_from_error(exc: Exception) -> None:
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        raise HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc))
    raise exc


@router.post("")
@limiter.limit("20/minute")
async def create_campaign(
    request: Request,
    body: CampaignLaunchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        result = OutreachCampaignService(db).launch_campaign(
            actor=current_user,
            objective=body.objective,
            channel=body.channel,
            cadence=body.cadence,
            owner_user_id=body.owner_user_id or current_user.id,
            lead_ids=body.lead_ids,
            segment_filter=body.segment_filter,
        )
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response(result.to_dict())


@router.post("/{campaign_id}/steps/generate")
@limiter.limit("20/minute")
async def generate_campaign_steps(
    request: Request,
    campaign_id: UUID,
    body: CampaignGenerateStepsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    service = OutreachCampaignService(db)
    try:
        steps = service.generate_sequence_steps(
            actor=current_user,
            campaign_id=campaign_id,
            step_types=body.step_types,
        )
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response({"steps": [service.serialize_step(step) for step in steps]})


@router.patch("/steps/{step_id}/review")
@limiter.limit("30/minute")
async def review_campaign_step(
    request: Request,
    step_id: UUID,
    body: CampaignStepReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    service = OutreachCampaignService(db)
    try:
        step = service.review_step(
            actor=current_user,
            step_id=step_id,
            reviewed_content=body.reviewed_content,
            approve=body.approve,
        )
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response(service.serialize_step(step))


@router.post("/steps/{step_id}/send")
@limiter.limit("30/minute")
async def send_campaign_step(
    request: Request,
    step_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    service = OutreachCampaignService(db)
    try:
        step = await service.send_step(actor=current_user, step_id=step_id)
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response(service.serialize_step(step))


@router.post("/steps/{step_id}/skip")
@limiter.limit("30/minute")
async def skip_campaign_step(
    request: Request,
    step_id: UUID,
    body: CampaignStepSkipRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    service = OutreachCampaignService(db)
    try:
        step = service.skip_step(actor=current_user, step_id=step_id, reason=body.reason)
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response(service.serialize_step(step))


@router.get("/{campaign_id}/state")
@limiter.limit("60/minute")
async def get_campaign_state(
    request: Request,
    campaign_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    service = OutreachCampaignService(db)
    try:
        campaign = service._get_campaign_for_actor(current_user, campaign_id)
        state = service.inspect_state(campaign.id)
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response(state)


@router.post("/{campaign_id}/pause")
@limiter.limit("20/minute")
async def pause_campaign(
    request: Request,
    campaign_id: UUID,
    body: CampaignStateTransitionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        state = OutreachCampaignService(db).pause_campaign(
            actor=current_user,
            campaign_id=campaign_id,
            reason=body.reason,
        )
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response(state)


@router.post("/{campaign_id}/resume")
@limiter.limit("20/minute")
async def resume_campaign(
    request: Request,
    campaign_id: UUID,
    body: CampaignStateTransitionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        state = OutreachCampaignService(db).resume_campaign(
            actor=current_user,
            campaign_id=campaign_id,
            reason=body.reason,
        )
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response(state)


@router.post("/{campaign_id}/stop")
@limiter.limit("20/minute")
async def stop_campaign(
    request: Request,
    campaign_id: UUID,
    body: CampaignStateTransitionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        state = OutreachCampaignService(db).stop_campaign(
            actor=current_user,
            campaign_id=campaign_id,
            reason=body.reason,
        )
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response(state)


@router.get("/{campaign_id}")
@limiter.limit("60/minute")
async def get_campaign(
    request: Request,
    campaign_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        result = OutreachCampaignService(db).get_campaign(campaign_id, actor=current_user)
    except (PermissionError, LookupError, ValueError) as exc:
        _raise_from_error(exc)
    return create_response(result)
