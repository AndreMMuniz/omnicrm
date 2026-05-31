from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.models import Client, Contact, Conversation, Message, Project, Proposal, ProposalStatusHistory
from app.schemas.chat import CustomerTimelineEventResponse, CustomerTimelineResponse


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


@dataclass
class TimelineScope:
    client: Optional[Client]
    conversation: Optional[Conversation]


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


def build_conversation_timeline(db: Session, conversation: Conversation, *, limit: int = 25) -> CustomerTimelineResponse:
    contact = conversation.contact
    linked_client = None
    if contact and getattr(contact, "client_id", None):
        linked_client = (
            db.query(Client)
            .filter(Client.id == contact.client_id, Client.deleted_at.is_(None))
            .first()
        )

    messages = (
        db.query(Message)
        .options(joinedload(Message.conversation).joinedload(Conversation.contact))
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .all()
    )

    events: list[CustomerTimelineEventResponse] = [
        _build_conversation_created_event(conversation, client_id=linked_client.id if linked_client else None)
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
    conversations = (
        db.query(Conversation)
        .join(Contact, Contact.id == Conversation.contact_id)
        .options(joinedload(Conversation.contact))
        .filter(Contact.client_id == client.id)
        .order_by(Conversation.updated_at.desc())
        .limit(10)
        .all()
    )
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
