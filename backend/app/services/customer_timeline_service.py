from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.models import Client, Contact, Conversation, Message, Project, Proposal, ProposalStatusHistory
from app.schemas.chat import (
    ConversationLinkedArtifactGapResponse,
    ConversationLinkedArtifactResponse,
    ConversationLinkedArtifactsResponse,
    CustomerTimelineEventResponse,
    CustomerTimelineResponse,
)


def _truncate(value: Optional[str], *, limit: int = 160) -> Optional[str]:
    if not value:
        return None
    clean = " ".join(value.strip().split())
    if len(clean) <= limit:
        return clean
    return f"{clean[: limit - 1].rstrip()}…"


def _contact_label(contact: Optional[Contact]) -> str:
    if not contact:
        return "Unknown contact"
    return contact.name or contact.channel_identifier or contact.email or contact.phone or "Unknown contact"


def _build_message_event(message: Message, *, client_id: Optional[UUID] = None) -> CustomerTimelineEventResponse:
    conversation = message.conversation
    contact = conversation.contact if conversation else None
    if message.is_internal:
        title = "Internal note added"
        event_type = "internal_note"
    elif message.inbound:
        title = "Inbound message received"
        event_type = "message_inbound"
    else:
        title = "Outbound message sent"
        event_type = "message_outbound"

    return CustomerTimelineEventResponse(
        id=f"message:{message.id}",
        event_type=event_type,
        occurred_at=message.created_at,
        title=title,
        description=_truncate(message.content),
        source_entity_type="message",
        source_entity_id=message.id,
        source_entity_label=_contact_label(contact),
        is_internal=bool(message.is_internal),
        conversation_id=message.conversation_id,
        client_id=client_id,
        href=f"/messages?conversationId={message.conversation_id}",
    )


def _build_conversation_created_event(conversation: Conversation, *, client_id: Optional[UUID] = None) -> CustomerTimelineEventResponse:
    contact = conversation.contact
    channel = conversation.channel.value if hasattr(conversation.channel, "value") else str(conversation.channel)
    return CustomerTimelineEventResponse(
        id=f"conversation:{conversation.id}:created",
        event_type="conversation_created",
        occurred_at=conversation.created_at,
        title="Conversation started",
        description=f"{channel.title()} conversation with {_contact_label(contact)}",
        source_entity_type="conversation",
        source_entity_id=conversation.id,
        source_entity_label=_contact_label(contact),
        conversation_id=conversation.id,
        client_id=client_id,
        href=f"/messages?conversationId={conversation.id}",
    )


def _build_proposal_created_event(proposal: Proposal) -> CustomerTimelineEventResponse:
    return CustomerTimelineEventResponse(
        id=f"proposal:{proposal.id}:created",
        event_type="proposal_created",
        occurred_at=proposal.created_at,
        title="Proposal created",
        description=f"{proposal.reference_code} · {proposal.title}",
        source_entity_type="proposal",
        source_entity_id=proposal.id,
        source_entity_label=proposal.reference_code,
        client_id=proposal.client_id,
        proposal_id=proposal.id,
        href=f"/proposals?proposalId={proposal.id}",
    )


def _build_proposal_status_event(status_history: ProposalStatusHistory, proposal: Proposal) -> CustomerTimelineEventResponse:
    title = f"Proposal moved to {status_history.to_status.replace('_', ' ')}"
    description = f"{proposal.reference_code} · {proposal.title}"
    if status_history.reason:
        description = f"{description} · {_truncate(status_history.reason, limit=100)}"
    return CustomerTimelineEventResponse(
        id=f"proposal-status:{status_history.id}",
        event_type="proposal_status_changed",
        occurred_at=status_history.created_at,
        title=title,
        description=description,
        source_entity_type="proposal_status_history",
        source_entity_id=status_history.id,
        source_entity_label=proposal.reference_code,
        client_id=proposal.client_id,
        proposal_id=proposal.id,
        href=f"/proposals?proposalId={proposal.id}",
    )


def _build_project_created_event(project: Project) -> CustomerTimelineEventResponse:
    return CustomerTimelineEventResponse(
        id=f"project:{project.id}:created",
        event_type="project_created",
        occurred_at=project.created_at,
        title="Project created",
        description=f"{project.reference_code} · {project.title}",
        source_entity_type="project",
        source_entity_id=project.id,
        source_entity_label=project.reference_code,
        conversation_id=project.source_conversation_id,
        client_id=project.client_id,
        project_id=project.id,
        href=f"/projects?projectId={project.id}",
    )


def _build_project_updated_event(project: Project) -> Optional[CustomerTimelineEventResponse]:
    if not project.updated_at or project.updated_at == project.created_at:
        return None
    status = project.status.value if hasattr(project.status, "value") else str(project.status)
    return CustomerTimelineEventResponse(
        id=f"project:{project.id}:updated",
        event_type="project_updated",
        occurred_at=project.updated_at,
        title="Project updated",
        description=f"{project.reference_code} · {project.title} · status {status}",
        source_entity_type="project",
        source_entity_id=project.id,
        source_entity_label=project.reference_code,
        conversation_id=project.source_conversation_id,
        client_id=project.client_id,
        project_id=project.id,
        href=f"/projects?projectId={project.id}",
    )


def _sort_events(events: list[CustomerTimelineEventResponse], *, limit: int) -> list[CustomerTimelineEventResponse]:
    ordered = sorted(
        events,
        key=lambda event: (event.occurred_at, event.id),
        reverse=True,
    )
    return ordered[:limit]

def _proposal_events(db: Session, *, client_id: UUID) -> list[CustomerTimelineEventResponse]:
    proposals = (
        db.query(Proposal)
        .options(joinedload(Proposal.status_history))
        .filter(Proposal.client_id == client_id)
        .order_by(Proposal.updated_at.desc())
        .limit(8)
        .all()
    )
    events: list[CustomerTimelineEventResponse] = []
    for proposal in proposals:
        events.append(_build_proposal_created_event(proposal))
        for status_history in proposal.status_history:
            events.append(_build_proposal_status_event(status_history, proposal))
    return events


def _serialize_status(value: object) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _linked_client_for_conversation(db: Session, conversation: Conversation) -> Optional[Client]:
    contact = conversation.contact
    if not contact or not getattr(contact, "client_id", None):
        return None
    return (
        db.query(Client)
        .filter(Client.id == contact.client_id, Client.deleted_at.is_(None))
        .first()
    )


def build_conversation_linked_artifacts(
    db: Session,
    conversation: Conversation,
    *,
    limit: int = 8,
) -> ConversationLinkedArtifactsResponse:
    linked_client = _linked_client_for_conversation(db, conversation)

    project_candidates: dict[str, tuple[Project, str]] = {}

    if conversation.project_context_id:
        current_project = db.query(Project).filter(Project.id == conversation.project_context_id).first()
        if current_project:
            project_candidates[str(current_project.id)] = (current_project, "conversation_context")

    message_action_projects = (
        db.query(Project)
        .join(Message, Message.id == Project.source_message_id)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Project.updated_at.desc())
        .all()
    )
    for project in message_action_projects:
        existing = project_candidates.get(str(project.id))
        if not existing:
            project_candidates[str(project.id)] = (project, "message_action")

    direct_projects = (
        db.query(Project)
        .filter(Project.source_conversation_id == conversation.id)
        .order_by(Project.updated_at.desc())
        .all()
    )
    for project in direct_projects:
        existing = project_candidates.get(str(project.id))
        if not existing:
            project_candidates[str(project.id)] = (project, "derived_context")

    if linked_client:
        client_projects = (
            db.query(Project)
            .filter(Project.client_id == linked_client.id)
            .order_by(Project.updated_at.desc())
            .limit(limit)
            .all()
        )
        for project in client_projects:
            existing = project_candidates.get(str(project.id))
            if not existing:
                project_candidates[str(project.id)] = (project, "client_relationship")

    proposal_artifacts: list[ConversationLinkedArtifactResponse] = []
    if linked_client:
        proposals = (
            db.query(Proposal)
            .filter(Proposal.client_id == linked_client.id)
            .order_by(Proposal.updated_at.desc())
            .limit(limit)
            .all()
        )
        proposal_artifacts = [
            ConversationLinkedArtifactResponse(
                id=proposal.id,
                entity_type="proposal",
                reference=proposal.reference_code,
                title=proposal.title,
                status=_serialize_status(proposal.status),
                origin_type="client_relationship",
                updated_at=proposal.updated_at,
                href=f"/proposals?proposalId={proposal.id}",
            )
            for proposal in proposals
        ]

    project_origin_order = {
        "conversation_context": 0,
        "message_action": 1,
        "derived_context": 2,
        "client_relationship": 3,
    }
    project_artifacts = [
        ConversationLinkedArtifactResponse(
            id=project.id,
            entity_type="project",
            reference=project.reference_code,
            title=project.title,
            status=_serialize_status(project.status),
            origin_type=origin_type,
            updated_at=project.updated_at,
            source_message_id=project.source_message_id,
            source_conversation_id=project.source_conversation_id,
            href=f"/projects?projectId={project.id}",
        )
        for project, origin_type in sorted(
            project_candidates.values(),
            key=lambda item: (
                project_origin_order.get(item[1], 99),
                -(item[0].updated_at.timestamp() if item[0].updated_at else 0),
                item[0].reference_code,
            ),
        )
    ]

    artifacts = (project_artifacts[:4] + proposal_artifacts[:4])[: max(1, min(limit, 12))]

    has_direct_artifact = any(
        artifact.origin_type in {"conversation_context", "message_action", "derived_context"}
        for artifact in project_artifacts
    )
    has_project_context = any(
        artifact.origin_type == "conversation_context"
        for artifact in project_artifacts
    )
    has_client_proposals = len(proposal_artifacts) > 0

    gaps: list[ConversationLinkedArtifactGapResponse] = []
    if not linked_client:
        gaps.append(
            ConversationLinkedArtifactGapResponse(
                code="missing_client_link",
                title="Client link missing",
                description="Link a client to surface proposal context related to this conversation.",
            )
        )
    if not has_project_context:
        gaps.append(
            ConversationLinkedArtifactGapResponse(
                code="missing_project_context",
                title="Project context missing",
                description="This conversation does not have a direct project context attached yet.",
            )
        )
    if linked_client and not has_client_proposals:
        gaps.append(
            ConversationLinkedArtifactGapResponse(
                code="missing_proposal_link",
                title="No proposal visible yet",
                description="This linked client does not have proposal context available from this conversation yet.",
            )
        )
    if linked_client and not has_direct_artifact:
        gaps.append(
            ConversationLinkedArtifactGapResponse(
                code="missing_direct_artifact",
                title="Direct commercial linkage missing",
                description="This conversation is related to the client, but no project or message-derived artifact is directly attached yet.",
            )
        )

    return ConversationLinkedArtifactsResponse(
        conversation_id=conversation.id,
        client_id=linked_client.id if linked_client else None,
        artifacts=artifacts,
        gaps=gaps,
    )


def _project_events(db: Session, *, client_id: Optional[UUID], project_context_id: Optional[UUID]) -> list[CustomerTimelineEventResponse]:
    project_candidates: dict[str, Project] = {}
    if client_id:
        projects = (
            db.query(Project)
            .filter(Project.client_id == client_id)
            .order_by(Project.updated_at.desc())
            .limit(8)
            .all()
        )
        for project in projects:
            project_candidates[str(project.id)] = project

    if project_context_id:
        current_project = db.query(Project).filter(Project.id == project_context_id).first()
        if current_project:
            project_candidates[str(current_project.id)] = current_project

    events: list[CustomerTimelineEventResponse] = []
    for project in project_candidates.values():
        events.append(_build_project_created_event(project))
        updated_event = _build_project_updated_event(project)
        if updated_event:
            events.append(updated_event)
    return events


def _client_conversations(db: Session, *, client_id: UUID, limit: int = 10) -> list[Conversation]:
    return (
        db.query(Conversation)
        .join(Contact, Contact.id == Conversation.contact_id)
        .options(joinedload(Conversation.contact))
        .filter(Contact.client_id == client_id)
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
        .all()
    )


def build_conversation_timeline(db: Session, conversation: Conversation, *, limit: int = 25) -> CustomerTimelineResponse:
    linked_client = _linked_client_for_conversation(db, conversation)

    conversations: list[Conversation]
    if linked_client:
        conversations = _client_conversations(db, client_id=linked_client.id, limit=10)
        if all(existing.id != conversation.id for existing in conversations):
            conversations.append(conversation)
    else:
        conversations = [conversation]
    conversation_ids = [item.id for item in conversations]

    messages = (
        db.query(Message)
        .options(joinedload(Message.conversation).joinedload(Conversation.contact))
        .filter(Message.conversation_id.in_(conversation_ids))
        .order_by(Message.created_at.desc())
        .limit(limit)
        .all()
    )

    events: list[CustomerTimelineEventResponse] = [
        _build_conversation_created_event(item, client_id=linked_client.id if linked_client else None)
        for item in conversations
    ]
    events.extend(
        _build_message_event(message, client_id=linked_client.id if linked_client else None)
        for message in messages
    )

    if linked_client:
        events.extend(_proposal_events(db, client_id=linked_client.id))

    events.extend(
        _project_events(
            db,
            client_id=linked_client.id if linked_client else None,
            project_context_id=conversation.project_context_id,
        )
    )

    return CustomerTimelineResponse(
        scope="conversation",
        conversation_id=conversation.id,
        client_id=linked_client.id if linked_client else None,
        events=_sort_events(events, limit=limit),
    )


def build_client_timeline(db: Session, client: Client, *, limit: int = 25) -> CustomerTimelineResponse:
    conversations = _client_conversations(db, client_id=client.id, limit=10)
    conversation_ids = [conversation.id for conversation in conversations]

    messages: list[Message] = []
    if conversation_ids:
        messages = (
            db.query(Message)
            .options(joinedload(Message.conversation).joinedload(Conversation.contact))
            .filter(Message.conversation_id.in_(conversation_ids))
            .order_by(Message.created_at.desc())
            .limit(limit)
            .all()
        )

    events: list[CustomerTimelineEventResponse] = []
    events.extend(_build_conversation_created_event(conversation, client_id=client.id) for conversation in conversations)
    events.extend(_build_message_event(message, client_id=client.id) for message in messages)
    events.extend(_proposal_events(db, client_id=client.id))
    events.extend(_project_events(db, client_id=client.id, project_context_id=None))

    return CustomerTimelineResponse(
        scope="client",
        client_id=client.id,
        events=_sort_events(events, limit=limit),
    )
