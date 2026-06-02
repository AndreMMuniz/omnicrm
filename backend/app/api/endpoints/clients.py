from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased, joinedload

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.models import Client, Contact, Conversation, User
from app.schemas.chat import CustomerTimelineResponse
from app.schemas.client import (
    ClientContactListResponse,
    ClientCreate,
    ClientListResponse,
    ClientResponse,
    ClientUpdate,
)
from app.schemas.common import create_paginated_response, create_response
from app.services.customer_timeline_service import build_client_timeline

router = APIRouter()


def _get_client_or_404(client_id: UUID, db: Session) -> Client:
    client = (
        db.query(Client)
        .options(joinedload(Client.owner), joinedload(Client.created_by))
        .filter(Client.id == client_id, Client.deleted_at.is_(None))
        .first()
    )
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return client


def _ensure_client_owner_exists(owner_user_id: Optional[UUID], db: Session) -> None:
    if not owner_user_id:
        return

    owner = db.query(User).filter(User.id == owner_user_id, User.is_active.is_(True)).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Owner user not found")


def _serialize_client_list_row(client: Client) -> ClientListResponse:
    return ClientListResponse(
        id=client.id,
        name=client.name,
        company_name=client.company_name,
        country=client.country,
        client_type=client.client_type.value if hasattr(client.client_type, "value") else client.client_type,
        currency=client.currency,
        website=client.website,
        owner_user_id=client.owner_user_id,
        owner_name=client.owner.full_name if client.owner else None,
        created_at=client.created_at,
        updated_at=client.updated_at,
        deleted_at=client.deleted_at,
    )


def _serialize_client(client: Client) -> ClientResponse:
    return ClientResponse(
        id=client.id,
        name=client.name,
        country=client.country,
        client_type=client.client_type.value if hasattr(client.client_type, "value") else client.client_type,
        tax_id=client.tax_id,
        tax_id_type=client.tax_id_type,
        currency=client.currency,
        company_name=client.company_name,
        website=client.website,
        notes=client.notes,
        contact_id=client.contact_id,
        owner_user_id=client.owner_user_id,
        owner_name=client.owner.full_name if client.owner else None,
        created_by_user_id=client.created_by_user_id,
        created_by_name=client.created_by.full_name if client.created_by else None,
        created_at=client.created_at,
        updated_at=client.updated_at,
        deleted_at=client.deleted_at,
    )


@router.get("/clients")
@limiter.limit("60/minute")
async def list_clients(
    request: Request,
    skip: int = 0,
    limit: int = 50,
    search: Optional[str] = Query(default=None),
    client_type: Optional[str] = Query(default=None),
    country: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    owner_user = aliased(User)
    query = (
        db.query(Client)
        .options(joinedload(Client.owner), joinedload(Client.created_by))
        .filter(Client.deleted_at.is_(None))
    )

    if search:
        pattern = f"%{search}%"
        query = query.outerjoin(Contact, Contact.client_id == Client.id).outerjoin(owner_user, Client.owner_user_id == owner_user.id)
        query = query.filter(
            or_(
                Client.name.ilike(pattern),
                Client.company_name.ilike(pattern),
                Client.country.ilike(pattern),
                owner_user.full_name.ilike(pattern),
                Contact.name.ilike(pattern),
                Contact.email.ilike(pattern),
                Contact.phone.ilike(pattern),
                Contact.channel_identifier.ilike(pattern),
            )
        ).distinct()
    if client_type:
        query = query.filter(Client.client_type == client_type)
    if country:
        query = query.filter(Client.country == country.upper())

    total = query.count()
    clients = query.order_by(Client.updated_at.desc(), Client.name.asc()).offset(skip).limit(limit).all()

    return create_paginated_response(
        data=[_serialize_client_list_row(c) for c in clients],
        total=total,
        page=(skip // limit) + 1,
        page_size=limit,
    )


@router.post("/clients")
@limiter.limit("30/minute")
async def create_client(
    request: Request,
    payload: ClientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    _ensure_client_owner_exists(payload.owner_user_id, db)

    client = Client(
        **payload.model_dump(exclude={"contact_id"}),
        contact_id=payload.contact_id,
        created_by_user_id=current_user.id,
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return create_response(_serialize_client(_get_client_or_404(client.id, db)))


@router.get("/clients/{client_id}")
@limiter.limit("60/minute")
async def get_client(
    request: Request,
    client_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    client = _get_client_or_404(client_id, db)
    return create_response(_serialize_client(client))


@router.get("/clients/{client_id}/contacts")
@limiter.limit("60/minute")
async def list_client_contacts(
    request: Request,
    client_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    _get_client_or_404(client_id, db)
    contacts = (
        db.query(Contact)
        .filter(Contact.client_id == client_id)
        .order_by(func.coalesce(Contact.name, Contact.channel_identifier, Contact.email, Contact.phone))
        .all()
    )
    return create_response([ClientContactListResponse.model_validate(contact) for contact in contacts])


@router.get("/clients/{client_id}/timeline")
@limiter.limit("60/minute")
async def get_client_timeline(
    request: Request,
    client_id: UUID,
    limit: int = 25,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    client = _get_client_or_404(client_id, db)
    timeline = build_client_timeline(db, client, limit=max(1, min(limit, 50)))
    return create_response(CustomerTimelineResponse.model_validate(timeline))


@router.patch("/clients/{client_id}")
@limiter.limit("30/minute")
async def update_client(
    request: Request,
    client_id: UUID,
    payload: ClientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    client = _get_client_or_404(client_id, db)
    _ensure_client_owner_exists(payload.owner_user_id, db)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(client, field, value)

    db.commit()
    db.refresh(client)
    return create_response(_serialize_client(_get_client_or_404(client.id, db)))


@router.delete("/clients/{client_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_client(
    request: Request,
    client_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    from datetime import datetime, timezone

    client = _get_client_or_404(client_id, db)
    client.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.get("/clients/{client_id}/conversations")
@limiter.limit("60/minute")
async def get_client_conversations(
    request: Request,
    client_id: UUID,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    _get_client_or_404(client_id, db)
    conversations = (
        db.query(Conversation)
        .join(Contact, Contact.id == Conversation.contact_id)
        .filter(Contact.client_id == client_id)
        .options(joinedload(Conversation.contact))
        .order_by(Conversation.updated_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    total = (
        db.query(func.count(Conversation.id))
        .join(Contact, Contact.id == Conversation.contact_id)
        .filter(Contact.client_id == client_id)
        .scalar()
    )
    data = [
        {
            "id": str(c.id),
            "channel": c.channel.value if hasattr(c.channel, "value") else c.channel,
            "status": c.status.value if hasattr(c.status, "value") else c.status,
            "last_message": c.last_message,
            "last_message_date": c.last_message_date,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
            "contact_id": str(c.contact_id),
            "contact_name": c.contact.name if c.contact else None,
            "channel_identifier": c.contact.channel_identifier if c.contact else None,
        }
        for c in conversations
    ]
    return create_paginated_response(data=data, total=total, page=(skip // limit) + 1, page_size=limit)


class ContactClientLinkRequest(BaseModel):
    client_id: Optional[UUID] = None


@router.patch("/contacts/{contact_id}/client")
@limiter.limit("30/minute")
async def link_contact_to_client(
    request: Request,
    contact_id: UUID,
    payload: ContactClientLinkRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contato não encontrado")

    if payload.client_id is not None:
        client = db.query(Client).filter(
            Client.id == payload.client_id,
            Client.deleted_at.is_(None),
        ).first()
        if not client:
            raise HTTPException(status_code=404, detail="Cliente não encontrado")

    contact.client_id = payload.client_id
    db.commit()
    db.refresh(contact)
    return create_response({"contact_id": str(contact.id), "client_id": str(contact.client_id) if contact.client_id else None})


@router.get("/conversations/{conversation_id}/detect-client")
@limiter.limit("60/minute")
async def detect_client_for_conversation(
    request: Request,
    conversation_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    conversation = (
        db.query(Conversation)
        .options(joinedload(Conversation.contact).joinedload(Contact.client))
        .filter(Conversation.id == conversation_id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")

    contact = conversation.contact
    if not contact:
        return create_response({"already_linked": False, "matches": []})

    client = contact.client
    if client and client.deleted_at is None:
        return create_response(
            {
                "already_linked": True,
                "matches": [
                    {
                        "id": str(client.id),
                        "name": client.name,
                        "company_name": client.company_name,
                        "country": client.country,
                        "client_type": client.client_type.value if hasattr(client.client_type, "value") else client.client_type,
                    }
                ],
            }
        )

    return create_response({"already_linked": False, "matches": []})
