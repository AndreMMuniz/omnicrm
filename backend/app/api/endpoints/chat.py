import uuid as _uuid
from typing import List, Dict, Any, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from sqlalchemy import func, inspect
from sqlalchemy.orm import Session, joinedload, load_only
from sqlalchemy.orm.attributes import set_committed_value
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.models import Client, Conversation, Message, Project, Proposal, User
from app.services.customer_timeline_service import build_conversation_linked_artifacts, build_conversation_timeline
from app.schemas.chat import (
    AISuggestionResponse,
    AssignedUserSlim,
    ConversationAssignmentUpdate,
    ConversationLinkedArtifactsResponse,
    ConversationCustomerContextResponse,
    CustomerTimelineResponse,
    ConversationResponse,
    ContactResponse,
    CustomerContextClientResponse,
    CustomerContextProjectSummary,
    CustomerContextProposalSummary,
    CustomerContextSignalsResponse,
    InternalNoteCreate,
    ConversationUpdate,
    MessageResponse,
    normalize_conversation_tags,
    serialize_conversation_status,
)
from app.schemas.common import create_response, create_paginated_response, create_error_response
from app.core.websocket import manager  # still used by WebSocket endpoint
from app.core.auth import get_current_user, require_permission, get_client_ip
from app.models.models import ConversationStatus

router = APIRouter()


def _conversation_has_tags_column(db: Session) -> bool:
    columns = inspect(db.bind).get_columns("conversations")
    return any(column["name"] == "tags" for column in columns)


def _conversation_query(db: Session, *, eager: bool = False):
    query = db.query(Conversation)
    if eager:
        query = query.options(
            joinedload(Conversation.contact),
            joinedload(Conversation.assigned_user),
        )

    if not _conversation_has_tags_column(db):
        query = query.options(
            load_only(
                Conversation.id,
                Conversation.thread_id,
                Conversation.contact_id,
                Conversation.assigned_user_id,
                Conversation.project_context_id,
                Conversation.channel,
                Conversation.status,
                Conversation.tag,
                Conversation.is_unread,
                Conversation.last_message,
                Conversation.last_message_date,
                Conversation.first_response_at,
                Conversation.created_at,
                Conversation.updated_at,
            )
        )

    return query


def _hydrate_legacy_tags(db: Session, conversation: Conversation) -> Conversation:
    existing_tags = normalize_conversation_tags(getattr(conversation, "tags", None))
    if existing_tags:
        set_committed_value(conversation, "tags", existing_tags)
        return conversation

    legacy_tag = getattr(conversation, "tag", None)
    derived_tags = []
    if legacy_tag:
        derived_tags = normalize_conversation_tags([
            legacy_tag.value if hasattr(legacy_tag, "value") else legacy_tag
        ])

    set_committed_value(conversation, "tags", derived_tags)
    return conversation


def _normalize_status_filter(status: Optional[str]) -> Optional[ConversationStatus]:
    if not status:
        return None
    normalized = status.strip().lower()
    if normalized == "resolved":
        normalized = "closed"
    try:
        return ConversationStatus[normalized.upper()]
    except KeyError:
        return None


def _can_operate_conversation(current_user: User, conversation: Conversation) -> bool:
    if current_user.user_type and current_user.user_type.can_view_all_conversations:
        return True
    return conversation.assigned_user_id is None or conversation.assigned_user_id == current_user.id


def _serialize_customer_context_client(client: Client) -> CustomerContextClientResponse:
    client_type = client.client_type.value if hasattr(client.client_type, "value") else str(client.client_type)
    return CustomerContextClientResponse(
        id=client.id,
        name=client.name,
        company_name=client.company_name,
        country=client.country,
        client_type=client_type,
        currency=client.currency,
    )


def _serialize_customer_context_proposal(proposal: Proposal) -> CustomerContextProposalSummary:
    status = proposal.status.value if hasattr(proposal.status, "value") else str(proposal.status)
    return CustomerContextProposalSummary(
        id=proposal.id,
        reference=proposal.reference_code,
        title=proposal.title,
        status=status,
        total_amount=proposal.total_amount,
        updated_at=proposal.updated_at,
    )


def _serialize_customer_context_project(project: Project, *, is_current_context: bool) -> CustomerContextProjectSummary:
    stage = project.stage.value if hasattr(project.stage, "value") else str(project.stage)
    status = project.status.value if hasattr(project.status, "value") else str(project.status)
    priority = project.priority.value if hasattr(project.priority, "value") else str(project.priority)
    return CustomerContextProjectSummary(
        id=project.id,
        reference=project.reference_code,
        title=project.title,
        stage=stage,
        status=status,
        priority=priority,
        updated_at=project.updated_at,
        is_current_context=is_current_context,
    )


def _load_conversation_customer_context(db: Session, conversation: Conversation) -> ConversationCustomerContextResponse:
    contact = conversation.contact
    if not contact:
        contact = conversation.contact

    linked_client = None
    if contact and getattr(contact, "client_id", None):
        linked_client = (
            db.query(Client)
            .filter(Client.id == contact.client_id, Client.deleted_at.is_(None))
            .first()
        )

    proposals: list[CustomerContextProposalSummary] = []
    if linked_client:
        recent_proposals = (
            db.query(Proposal)
            .filter(Proposal.client_id == linked_client.id)
            .order_by(Proposal.updated_at.desc())
            .limit(3)
            .all()
        )
        proposals = [_serialize_customer_context_proposal(proposal) for proposal in recent_proposals]

    project_candidates: dict[str, Project] = {}
    if linked_client:
        recent_projects = (
            db.query(Project)
            .filter(Project.client_id == linked_client.id)
            .order_by(Project.updated_at.desc())
            .limit(4)
            .all()
        )
        for project in recent_projects:
            project_candidates[str(project.id)] = project

    if conversation.project_context_id:
        current_project = (
            db.query(Project)
            .filter(Project.id == conversation.project_context_id)
            .first()
        )
        if current_project:
            project_candidates[str(current_project.id)] = current_project

    ordered_projects = sorted(
        project_candidates.values(),
        key=lambda project: (
            project.id != conversation.project_context_id,
            -(project.updated_at.timestamp() if project.updated_at else 0),
        ),
    )[:4]

    projects = [
        _serialize_customer_context_project(
            project,
            is_current_context=project.id == conversation.project_context_id,
        )
        for project in ordered_projects
    ]

    open_projects_count = 0
    if linked_client:
        open_projects_count = (
            db.query(Project)
            .filter(Project.client_id == linked_client.id, Project.status == "open")
            .count()
        )
    elif conversation.project_context_id:
        open_projects_count = int(any(project.status == "open" for project in projects))

    return ConversationCustomerContextResponse(
        contact=ContactResponse.model_validate(contact),
        client=_serialize_customer_context_client(linked_client) if linked_client else None,
        proposals=proposals,
        projects=projects,
        signals=CustomerContextSignalsResponse(
            has_linked_client=linked_client is not None,
            has_project_context=conversation.project_context_id is not None,
            recent_proposals_count=len(proposals),
            open_projects_count=open_projects_count,
        ),
    )

# --- WebSocket ---
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Real-time WebSocket endpoint.

    Client sends JSON frames:
      {"type": "subscribe",   "conversation_id": "<uuid>"}
      {"type": "unsubscribe", "conversation_id": "<uuid>"}
      {"type": "ack",         "conversation_id": "<uuid>", "sequence": 123}
      {"type": "ping"}

    Server sends SequencedEvent JSON (see websocket.py).
    """
    client_id = str(_uuid.uuid4())
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "identify":
                # Operator sends their identity once after connecting
                manager.identify(
                    client_id,
                    user_id=data.get("user_id", ""),
                    display_name=data.get("display_name", ""),
                )

            elif msg_type == "subscribe":
                conv_id = data.get("conversation_id", "")
                manager.subscribe(client_id, conv_id)
                await manager.send_personal(client_id, "subscribed", {"conversation_id": conv_id})

            elif msg_type == "unsubscribe":
                conv_id = data.get("conversation_id", "")
                manager.unsubscribe(client_id, conv_id)

            elif msg_type == "ack":
                conv_id = data.get("conversation_id", "")
                sequence = data.get("sequence", 0)
                manager.acknowledge(client_id, conv_id, sequence)

            elif msg_type == "ping":
                await manager.send_personal(client_id, "pong", {})

    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except Exception:
        manager.disconnect(client_id)

# --- REST Endpoints ---
@router.get("/conversations")
@limiter.limit("60/minute")
async def get_conversations(
    request: Request,
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    tag: Optional[str] = None,
    assigned_user_id: Optional[UUID] = None,
    needs_follow_up: Optional[bool] = None,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """List conversations with optional filters. Eager-loads contact and assigned_user."""
    has_tags_column = _conversation_has_tags_column(db)
    q = _conversation_query(db, eager=True)
    if status:
        normalized_status = _normalize_status_filter(status)
        if normalized_status:
            q = q.filter(Conversation.status == normalized_status)
    if tag:
        normalized_tag = normalize_conversation_tags([tag])
        if normalized_tag:
            if has_tags_column:
                q = q.filter(
                    (Conversation.tag == normalized_tag[0]) |
                    (Conversation.tags.contains([normalized_tag[0]]))
                )
            else:
                q = q.filter(Conversation.tag == normalized_tag[0])
    if assigned_user_id:
        q = q.filter(Conversation.assigned_user_id == assigned_user_id)
    if needs_follow_up is not None:
        q = q.filter(Conversation.needs_follow_up == needs_follow_up)

    total = q.order_by(None).with_entities(func.count(Conversation.id)).scalar() or 0
    conversations = q.order_by(Conversation.last_message_date.desc().nulls_last()).offset(skip).limit(limit).all()
    conversations = [_hydrate_legacy_tags(db, conversation) for conversation in conversations]
    return create_paginated_response(
        data=[ConversationResponse.model_validate(c) for c in conversations],
        total=total,
        page=(skip // limit) + 1,
        page_size=limit,
    )


@router.get("/conversations/{conversation_id}/context")
@limiter.limit("60/minute")
async def get_conversation_context(
    request: Request,
    conversation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    conversation = (
        _conversation_query(db, eager=True)
        .options(joinedload(Conversation.contact))
        .filter(Conversation.id == conversation_id)
        .first()
    )
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND",
            message="Conversation not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)

    if not _can_operate_conversation(current_user, conversation):
        error_response, status = create_error_response(
            code="FORBIDDEN",
            message="You do not have permission to view this conversation context",
            details={"conversation_id": str(conversation_id)},
            status_code=403,
        )
        raise HTTPException(status_code=status, detail=error_response)

    context = _load_conversation_customer_context(db, conversation)
    return create_response(context)


@router.get("/conversations/{conversation_id}/linked-artifacts")
@limiter.limit("60/minute")
async def get_conversation_linked_artifacts(
    request: Request,
    conversation_id: UUID,
    limit: int = 8,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    conversation = (
        _conversation_query(db, eager=True)
        .options(joinedload(Conversation.contact))
        .filter(Conversation.id == conversation_id)
        .first()
    )
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND",
            message="Conversation not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)

    if not _can_operate_conversation(current_user, conversation):
        error_response, status = create_error_response(
            code="FORBIDDEN",
            message="You do not have permission to view linked artifacts for this conversation",
            details={"conversation_id": str(conversation_id)},
            status_code=403,
        )
        raise HTTPException(status_code=status, detail=error_response)

    linked_artifacts = build_conversation_linked_artifacts(db, conversation, limit=max(1, min(limit, 12)))
    return create_response(ConversationLinkedArtifactsResponse.model_validate(linked_artifacts))


@router.get("/conversations/{conversation_id}/timeline")
@limiter.limit("60/minute")
async def get_conversation_timeline(
    request: Request,
    conversation_id: UUID,
    limit: int = 25,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    conversation = (
        _conversation_query(db, eager=True)
        .options(joinedload(Conversation.contact))
        .filter(Conversation.id == conversation_id)
        .first()
    )
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND",
            message="Conversation not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)

    if not _can_operate_conversation(current_user, conversation):
        error_response, status = create_error_response(
            code="FORBIDDEN",
            message="You do not have permission to view this conversation timeline",
            details={"conversation_id": str(conversation_id)},
            status_code=403,
        )
        raise HTTPException(status_code=status, detail=error_response)

    timeline = build_conversation_timeline(db, conversation, limit=max(1, min(limit, 50)))
    return create_response(CustomerTimelineResponse.model_validate(timeline))


@router.get("/assignable-users")
@limiter.limit("60/minute")
async def list_assignable_users(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """List approved and active internal users available for conversation ownership."""
    users = (
        db.query(User)
        .filter(User.is_approved == True, User.is_active == True)
        .order_by(User.full_name.asc())
        .all()
    )
    return create_response([AssignedUserSlim.model_validate(user) for user in users])

@router.get("/conversations/{conversation_id}/messages")
@limiter.limit("60/minute")
async def get_conversation_messages(
    request: Request,
    conversation_id: UUID,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Get all messages for a specific conversation."""
    from sqlalchemy.orm import joinedload

    conversation = _conversation_query(db).filter(Conversation.id == conversation_id).first()
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND",
            message="Conversation not found",
            status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    messages = (
        db.query(Message)
        .options(joinedload(Message.owner))
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.conversation_sequence.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    total = db.query(Message).filter(Message.conversation_id == conversation_id).count()
    return create_paginated_response(
        data=[MessageResponse.model_validate(m) for m in messages],
        total=total,
        page=(skip // limit) + 1,
        page_size=limit
    )

from app.schemas.chat import MessageCreate
from app.services.conversation_service import ConversationService, get_conversation_service
from app.services.message_service import MessageService, get_message_service
from app.models.models import AISuggestion
from app.services.audit_service import log_action

@router.delete("/conversations/{conversation_id}")
@limiter.limit("30/minute")
async def delete_conversation(
    request: Request,
    conversation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Delete a conversation and all its messages. Requires can_delete_conversations permission."""
    if not current_user.user_type.can_delete_conversations:
        error_response, status = create_error_response(
            code="FORBIDDEN", message="Not enough permissions", status_code=403
        )
        raise HTTPException(status_code=status, detail=error_response)

    conversation = _conversation_query(db).filter(Conversation.id == conversation_id).first()
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND", message="Conversation not found", status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    db.query(AISuggestion).filter(AISuggestion.conversation_id == conversation_id).delete()
    db.query(Message).filter(Message.conversation_id == conversation_id).delete()
    db.delete(conversation)
    db.commit()

    return create_response({"deleted": True, "id": str(conversation_id)})

@router.patch("/conversations/{conversation_id}")
@limiter.limit("60/minute")
async def update_conversation(
    request: Request,
    conversation_id: UUID,
    update_data: ConversationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Update conversation status, tag, or read state."""
    conversation = _conversation_query(db).filter(Conversation.id == conversation_id).first()
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND",
            message="Conversation not found",
            status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    if not _can_operate_conversation(current_user, conversation):
        error_response, status = create_error_response(
            code="FORBIDDEN",
            message="You do not have permission to update this conversation",
            details={
                "conversation_id": str(conversation_id),
                "assigned_user_id": str(conversation.assigned_user_id) if conversation.assigned_user_id else None,
            },
            status_code=403,
        )
        raise HTTPException(status_code=status, detail=error_response)

    svc = ConversationService(db)
    conversation = await svc.update_and_broadcast(
        conversation, update_data.model_dump(exclude_unset=True)
    )
    conversation = _hydrate_legacy_tags(db, conversation)
    return create_response(ConversationResponse.model_validate(conversation))


@router.post("/conversations/{conversation_id}/messages")
@limiter.limit("60/minute")
async def send_message(
    request: Request,
    conversation_id: UUID,
    message_data: MessageCreate,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Send a message from the dashboard to a conversation."""
    conversation = _conversation_query(db).filter(Conversation.id == conversation_id).first()
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND",
            message="Conversation not found",
            status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    svc = MessageService(db)
    new_message = await svc.send_from_dashboard(
        conversation=conversation,
        content=message_data.content,
        owner_id=message_data.owner_id,
        message_type=message_data.message_type.value if hasattr(message_data.message_type, "value") else str(message_data.message_type),
        image=message_data.image,
        file=message_data.file,
        idempotency_key=message_data.idempotency_key,
    )

    return create_response(MessageResponse.model_validate(new_message))


@router.post("/conversations/{conversation_id}/internal-notes")
@limiter.limit("60/minute")
async def create_internal_note(
    request: Request,
    conversation_id: UUID,
    note_data: InternalNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Persist an internal note on a conversation without sending anything to external channels."""
    conversation = _conversation_query(db).filter(Conversation.id == conversation_id).first()
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND",
            message="Conversation not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)

    if not _can_operate_conversation(current_user, conversation):
        error_response, status = create_error_response(
            code="FORBIDDEN",
            message="You do not have permission to add notes to this conversation",
            details={
                "conversation_id": str(conversation_id),
                "assigned_user_id": str(conversation.assigned_user_id) if conversation.assigned_user_id else None,
            },
            status_code=403,
        )
        raise HTTPException(status_code=status, detail=error_response)

    note_content = note_data.content.strip()
    if not note_content:
        error_response, status = create_error_response(
            code="VALIDATION_ERROR",
            message="Internal note content cannot be empty",
            status_code=422,
        )
        raise HTTPException(status_code=status, detail=error_response)

    svc = MessageService(db)
    note = await svc.create_internal_note(
        conversation=conversation,
        content=note_content,
        owner_id=current_user.id,
    )
    return create_response(MessageResponse.model_validate(note))


# ── Conversation Assignment (Story 3.5) ──────────────────────────────────────

@router.patch("/conversations/{conversation_id}/assign")
@limiter.limit("60/minute")
async def assign_conversation(
    request: Request,
    conversation_id: UUID,
    body: ConversationAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Assign or unassign a conversation to an agent. Pass {assigned_user_id: uuid|null}."""
    has_tags_column = _conversation_has_tags_column(db)
    conversation = _conversation_query(db).filter(Conversation.id == conversation_id).first()
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND", message="Conversation not found", status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    previous_assigned_user_id = conversation.assigned_user_id
    previous_assigned_user_name = conversation.assigned_user.full_name if conversation.assigned_user else None
    new_uid = body.assigned_user_id

    if new_uid:
        user = (
            db.query(User)
            .filter(User.id == new_uid, User.is_approved == True, User.is_active == True)
            .first()
        )
        if not user:
            error_response, status = create_error_response(
                code="USER_NOT_FOUND", message="User not found", status_code=404
            )
            raise HTTPException(status_code=status, detail=error_response)
        conversation.assigned_user_id = user.id
        conversation.assigned_user = user
    else:
        conversation.assigned_user_id = None
        conversation.assigned_user = None

    db.commit()
    if has_tags_column:
        db.refresh(conversation)
    conversation = _hydrate_legacy_tags(db, conversation)

    log_action(
        db,
        current_user.id,
        "assign_conversation",
        "conversation",
        str(conversation_id),
        details={
            "previous_assigned_user_id": str(previous_assigned_user_id) if previous_assigned_user_id else None,
            "previous_assigned_user_name": previous_assigned_user_name,
            "assigned_user_id": str(conversation.assigned_user_id) if conversation.assigned_user_id else None,
            "assigned_user_name": conversation.assigned_user.full_name if conversation.assigned_user else None,
        },
        ip_address=get_client_ip(request),
    )

    await manager.broadcast_global(
        "conversation_updated",
        {
            "id": str(conversation.id),
            "status": serialize_conversation_status(conversation.status),
            "tag": conversation.tag.value if conversation.tag else None,
            "tags": normalize_conversation_tags(getattr(conversation, "tags", None)),
            "is_unread": conversation.is_unread,
            "assigned_user_id": str(conversation.assigned_user_id) if conversation.assigned_user_id else None,
            "assigned_user": AssignedUserSlim.model_validate(conversation.assigned_user).model_dump(mode="json")
            if conversation.assigned_user
            else None,
        },
    )

    conversation = _hydrate_legacy_tags(db, conversation)
    return create_response(ConversationResponse.model_validate(conversation))


# ── Message Retry (Story 4.3) ─────────────────────────────────────────────────

@router.post("/conversations/{conversation_id}/messages/{message_id}/retry")
@limiter.limit("20/minute")
async def retry_message(
    request: Request,
    conversation_id: UUID,
    message_id: UUID,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Retry a failed outbound message (max 3 attempts)."""
    from app.models.models import Message, DeliveryStatus

    conversation = _conversation_query(db).filter(Conversation.id == conversation_id).first()
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND", message="Conversation not found", status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    message = db.query(Message).filter(
        Message.id == message_id,
        Message.conversation_id == conversation_id,
    ).first()
    if not message:
        error_response, status = create_error_response(
            code="MESSAGE_NOT_FOUND", message="Message not found", status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    if message.delivery_status != DeliveryStatus.FAILED:
        error_response, status = create_error_response(
            code="NOT_FAILED", message="Message is not in failed state", status_code=400
        )
        raise HTTPException(status_code=status, detail=error_response)

    from app.services.message_service import MessageService
    try:
        updated = await MessageService(db).retry_message(message, conversation)
        return create_response(MessageResponse.model_validate(updated))
    except ValueError as e:
        error_response, status = create_error_response(
            code="RETRY_LIMIT", message=str(e), status_code=400
        )
        raise HTTPException(status_code=status, detail=error_response)


@router.delete("/conversations/{conversation_id}/messages/{message_id}")
@limiter.limit("30/minute")
async def delete_message(
    request: Request,
    conversation_id: UUID,
    message_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_delete_messages")),
) -> Dict[str, Any]:
    """Delete a message if it is not referenced by downstream project provenance."""
    from app.models.models import Project

    conversation = _conversation_query(db).filter(Conversation.id == conversation_id).first()
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND", message="Conversation not found", status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    message = db.query(Message).filter(
        Message.id == message_id,
        Message.conversation_id == conversation_id,
    ).first()
    if not message:
        error_response, status = create_error_response(
            code="MESSAGE_NOT_FOUND", message="Message not found", status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    linked_project = db.query(Project).filter(Project.source_message_id == message_id).first()
    if linked_project:
        error_response, status = create_error_response(
            code="MESSAGE_LINKED_TO_PROJECT",
            message="This message cannot be deleted because it is linked to a project card",
            details={"project_id": str(linked_project.id), "project_reference": linked_project.reference_code},
            status_code=409,
        )
        raise HTTPException(status_code=status, detail=error_response)

    deleted_preview = message.content[:120]
    db.delete(message)
    db.flush()

    latest_message = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.conversation_sequence.desc())
        .first()
    )
    conversation.last_message = latest_message.content if latest_message else None
    conversation.last_message_date = latest_message.created_at if latest_message else None
    conversation.is_unread = latest_message.inbound if latest_message else False
    db.commit()
    if _conversation_has_tags_column(db):
        db.refresh(conversation)
    conversation = _hydrate_legacy_tags(db, conversation)

    log_action(
        db,
        current_user.id,
        "delete_message",
        "message",
        str(message_id),
        details={"conversation_id": str(conversation_id), "content_preview": deleted_preview},
        ip_address=get_client_ip(request),
    )

    await manager.broadcast_to_conversation(
        conversation_id=str(conversation_id),
        event_type="message_deleted",
        data={"conversation_id": str(conversation_id), "message_id": str(message_id)},
    )
    await manager.broadcast_global(
        "conversation_updated",
        {
            "id": str(conversation.id),
            "status": serialize_conversation_status(conversation.status),
            "tag": conversation.tag.value if conversation.tag else None,
            "tags": normalize_conversation_tags(getattr(conversation, "tags", None)),
            "is_unread": conversation.is_unread,
        },
    )

    return create_response({"deleted": True, "id": str(message_id)})


# ── AI Suggestions ────────────────────────────────────────────────────────────

@router.get("/conversations/{conversation_id}/suggestions")
@limiter.limit("60/minute")
async def get_suggestions(
    request: Request,
    conversation_id: UUID,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Return cached AI suggestions for a conversation (no LLM call)."""
    from app.services.ai_service import AIService
    svc = AIService(db)
    suggestions = svc.get_cached(conversation_id)
    return create_response({"suggestions": suggestions, "conversation_id": str(conversation_id)})


@router.post("/conversations/{conversation_id}/suggestions/generate")
@limiter.limit("30/minute")
async def generate_suggestions(
    request: Request,
    conversation_id: UUID,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Generate fresh AI reply suggestions using LLM. Replaces cached suggestions."""
    conversation = _conversation_query(db).filter(Conversation.id == conversation_id).first()
    if not conversation:
        error_response, status = create_error_response(
            code="CONVERSATION_NOT_FOUND",
            message="Conversation not found",
            status_code=404
        )
        raise HTTPException(status_code=status, detail=error_response)

    from app.services.ai_service import AIService
    suggestions = await AIService(db).generate(conversation_id)
    return create_response({"suggestions": suggestions, "conversation_id": str(conversation_id)})
