from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from datetime import datetime, timezone

from app.models.models import (
    Client,
    Contact,
    Conversation,
    Message,
    Project,
    ProjectSourceType,
    ProjectTask,
    ProjectTaskAutomationStatus,
    ProjectTaskAutomationType,
    User,
)
from app.repositories.project_repo import ProjectRepository, ProjectStageRepository, ProjectTaskRepository
from app.schemas.common import create_error_response
from app.schemas.project import (
    ProjectCreate,
    ProjectFromMessageCreate,
    ProjectTaskCreate,
    ProjectTaskFromMessageCreate,
    ProjectTaskUpdate,
    ProjectUpdate,
)


class ProjectService:
    def __init__(self, db: Session):
        self.db = db
        self.projects = ProjectRepository(db)
        self.stages = ProjectStageRepository(db)
        self.tasks = ProjectTaskRepository(db)

    async def ensure_stage_exists(self, stage_key: str) -> None:
        stage = await self.stages.find_by_key(stage_key)
        if not stage or not stage.is_active:
            error_response, status = create_error_response(
                code="INVALID_STAGE",
                message=f"Stage '{stage_key}' is invalid",
                status_code=422,
            )
            raise HTTPException(status_code=status, detail=error_response)

    async def ensure_owner_exists(self, owner_user_id: Optional[UUID]) -> None:
        if not owner_user_id:
            return
        owner = self.db.query(User).filter(User.id == owner_user_id).first()
        if not owner:
            error_response, status = create_error_response(
                code="OWNER_NOT_FOUND",
                message="Owner user not found",
                status_code=404,
            )
            raise HTTPException(status_code=status, detail=error_response)

    async def ensure_project_context_exists(self, project_context_id: Optional[UUID]) -> None:
        if not project_context_id:
            return
        project = await self.projects.find_project(project_context_id)
        if not project:
            error_response, status = create_error_response(
                code="PROJECT_CONTEXT_NOT_FOUND",
                message="Project context not found",
                status_code=404,
            )
            raise HTTPException(status_code=status, detail=error_response)

    async def ensure_client_exists(self, client_id: Optional[UUID]) -> None:
        if not client_id:
            return
        client = self.db.query(Client).filter(Client.id == client_id, Client.deleted_at.is_(None)).first()
        if not client:
            error_response, status = create_error_response(
                code="CLIENT_NOT_FOUND",
                message="Client not found",
                status_code=404,
            )
            raise HTTPException(status_code=status, detail=error_response)

    async def ensure_contact_exists(self, contact_id: Optional[UUID]) -> Optional[Contact]:
        if not contact_id:
            return None
        contact = self.db.query(Contact).filter(Contact.id == contact_id).first()
        if not contact:
            error_response, status = create_error_response(
                code="CONTACT_NOT_FOUND",
                message="Contact not found",
                status_code=404,
            )
            raise HTTPException(status_code=status, detail=error_response)
        return contact

    async def resolve_contact_assignment(
        self,
        *,
        client_id: Optional[UUID],
        contact_id: Optional[UUID],
        contact_name: Optional[str],
    ) -> tuple[Optional[UUID], Optional[UUID], Optional[str]]:
        contact = await self.ensure_contact_exists(contact_id)
        resolved_client_id = client_id
        resolved_contact_name = contact_name.strip() if isinstance(contact_name, str) and contact_name.strip() else None

        if contact:
            if resolved_client_id and contact.client_id and contact.client_id != resolved_client_id:
                error_response, status = create_error_response(
                    code="CONTACT_CLIENT_MISMATCH",
                    message="Selected contact does not belong to the linked client",
                    status_code=422,
                )
                raise HTTPException(status_code=status, detail=error_response)
            if resolved_client_id is None:
                resolved_client_id = contact.client_id
            resolved_contact_name = (
                contact.name
                or contact.channel_identifier
                or contact.email
                or contact.phone
                or resolved_contact_name
            )

        if resolved_client_id:
            await self.ensure_client_exists(resolved_client_id)

        if not contact and resolved_contact_name is None:
            resolved_contact_name = None

        return resolved_client_id, contact_id, resolved_contact_name

    async def validate_payload(self, payload: ProjectCreate | ProjectUpdate) -> None:
        if payload.stage:
            await self.ensure_stage_exists(payload.stage)
        if payload.owner_user_id:
            await self.ensure_owner_exists(payload.owner_user_id)
        await self.resolve_contact_assignment(
            client_id=getattr(payload, "client_id", None),
            contact_id=getattr(payload, "contact_id", None),
            contact_name=getattr(payload, "contact_name", None),
        )
        project_context_id = getattr(payload, "project_context_id", None)
        if project_context_id:
            await self.ensure_project_context_exists(project_context_id)
        if payload.source_type == ProjectSourceType.MESSAGE and not payload.source_message_id:
            error_response, status = create_error_response(
                code="SOURCE_MESSAGE_REQUIRED",
                message="source_message_id is required when source_type is 'message'",
                status_code=422,
            )
            raise HTTPException(status_code=status, detail=error_response)

    async def create_project(self, payload: ProjectCreate, current_user: User) -> Project:
        await self.validate_payload(payload)
        client_id, contact_id, contact_name = await self.resolve_contact_assignment(
            client_id=payload.client_id,
            contact_id=payload.contact_id,
            contact_name=payload.contact_name,
        )
        project = await self.projects.create(
            {
                **payload.model_dump(),
                "client_id": client_id,
                "contact_id": contact_id,
                "contact_name": contact_name,
                "created_by_user_id": current_user.id,
            }
        )
        return await self.projects.find_project(project.id)

    async def update_project(self, project: Project, payload: ProjectUpdate) -> Project:
        await self.validate_payload(payload)
        updates = payload.model_dump(exclude_unset=True)
        client_id, contact_id, contact_name = await self.resolve_contact_assignment(
            client_id=updates.get("client_id", project.client_id),
            contact_id=updates.get("contact_id", project.contact_id),
            contact_name=updates.get("contact_name", project.contact_name),
        )
        if "client_id" in updates or "contact_id" in updates or "contact_name" in updates:
            updates["client_id"] = client_id
            updates["contact_id"] = contact_id
            updates["contact_name"] = contact_name
        updated = await self.projects.update(project.id, updates)
        return await self.projects.find_project(updated.id)

    async def move_stage(self, project: Project, stage_key: str) -> Project:
        await self.ensure_stage_exists(stage_key)
        updated = await self.projects.update(project.id, {"stage": stage_key})
        return await self.projects.find_project(updated.id)

    async def delete_project(self, project_id: UUID) -> bool:
        project = await self.projects.find_project(project_id)
        if not project:
            return False

        (
            self.db.query(Conversation)
            .filter(Conversation.project_context_id == project_id)
            .update({"project_context_id": None}, synchronize_session=False)
        )
        (
            self.db.query(Project)
            .filter(Project.project_context_id == project_id)
            .update({"project_context_id": None}, synchronize_session=False)
        )

        self.db.delete(project)
        self.db.commit()
        return True

    async def create_project_from_message(
        self,
        message_id: UUID,
        payload: ProjectFromMessageCreate,
        current_user: User,
    ) -> Project:
        await self.ensure_stage_exists(payload.stage)
        if payload.owner_user_id:
            await self.ensure_owner_exists(payload.owner_user_id)
        if payload.client_id:
            await self.ensure_client_exists(payload.client_id)
        if payload.project_context_id:
            await self.ensure_project_context_exists(payload.project_context_id)

        message = (
            self.db.query(Message)
            .options(
                joinedload(Message.conversation)
                .joinedload(Conversation.contact)
            )
            .filter(Message.id == message_id)
            .first()
        )
        if not message:
            error_response, status = create_error_response(
                code="MESSAGE_NOT_FOUND",
                message="Message not found",
                status_code=404,
            )
            raise HTTPException(status_code=status, detail=error_response)

        conversation = message.conversation
        if not conversation:
            error_response, status = create_error_response(
                code="CONVERSATION_REQUIRED",
                message="Message is not linked to a valid conversation",
                status_code=422,
            )
            raise HTTPException(status_code=status, detail=error_response)

        contact_name = None
        client_id = payload.client_id
        contact_id = payload.contact_id
        if conversation.contact:
            contact_name = (
                conversation.contact.name
                or conversation.contact.channel_identifier
                or "Linked contact"
            )
            client_id = client_id or conversation.contact.client_id
            contact_id = contact_id or conversation.contact.id

        client_id, contact_id, contact_name = await self.resolve_contact_assignment(
            client_id=client_id,
            contact_id=contact_id,
            contact_name=contact_name,
        )

        title = payload.title or (contact_name and f"{contact_name} demand") or "Message demand"
        description = payload.description or message.content
        project_context_id = payload.project_context_id or conversation.project_context_id

        project = await self.projects.create(
            {
                "title": title,
                "description": description,
                "stage": payload.stage,
                "status": "open",
                "priority": payload.priority,
                "source_type": ProjectSourceType.MESSAGE,
                "source_message_id": message.id,
                "source_conversation_id": conversation.id,
                "project_context_id": project_context_id,
                "client_id": client_id,
                "contact_id": contact_id,
                "contact_name": contact_name,
                "channel": conversation.channel,
                "tag": payload.tag,
                "owner_user_id": payload.owner_user_id,
                "created_by_user_id": current_user.id,
                "due_date": payload.due_date,
                "value": payload.value,
                "progress": payload.progress,
            }
        )
        if payload.attach_conversation_to_project:
            conversation.project_context_id = project_context_id or project.id
            self.db.commit()
        return await self.projects.find_project(project.id)

    async def list_project_tasks(self, project: Project) -> list[ProjectTask]:
        return await self.tasks.list_for_project(project.id)

    async def list_tasks_workspace(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        search: Optional[str] = None,
        project_id: Optional[UUID] = None,
        owner_user_id: Optional[UUID] = None,
        created_by_user_id: Optional[UUID] = None,
        status: Optional[str] = None,
    ) -> tuple[list[ProjectTask], int]:
        tasks = await self.tasks.list_with_filters(
            skip=skip,
            limit=limit,
            search=search,
            project_id=project_id,
            owner_user_id=owner_user_id,
            created_by_user_id=created_by_user_id,
            status=status,
        )
        total = await self.tasks.count_with_filters(
            search=search,
            project_id=project_id,
            owner_user_id=owner_user_id,
            created_by_user_id=created_by_user_id,
            status=status,
        )
        return tasks, total

    async def create_project_task(
        self,
        project: Project,
        payload: ProjectTaskCreate,
        current_user: User,
    ) -> ProjectTask:
        if payload.owner_user_id:
            await self.ensure_owner_exists(payload.owner_user_id)

        task = await self.tasks.create(
            {
                **payload.model_dump(),
                "project_id": project.id,
                "created_by_user_id": current_user.id,
            }
        )
        return await self.tasks.find_task(project.id, task.id)

    async def create_project_task_from_message(
        self,
        message_id: UUID,
        payload: ProjectTaskFromMessageCreate,
        current_user: User,
    ) -> ProjectTask:
        if payload.owner_user_id:
            await self.ensure_owner_exists(payload.owner_user_id)
        if payload.project_context_id:
            await self.ensure_project_context_exists(payload.project_context_id)

        message = (
            self.db.query(Message)
            .options(joinedload(Message.conversation).joinedload(Conversation.contact))
            .filter(Message.id == message_id)
            .first()
        )
        if not message:
            error_response, status = create_error_response(
                code="MESSAGE_NOT_FOUND",
                message="Message not found",
                status_code=404,
            )
            raise HTTPException(status_code=status, detail=error_response)

        conversation = message.conversation
        if not conversation:
            error_response, status = create_error_response(
                code="CONVERSATION_REQUIRED",
                message="Message is not linked to a valid conversation",
                status_code=422,
            )
            raise HTTPException(status_code=status, detail=error_response)

        contact_name = None
        client_id = None
        contact_id = None
        if conversation.contact:
            contact_name = (
                conversation.contact.name
                or conversation.contact.channel_identifier
                or "Linked contact"
            )
            client_id = client_id or conversation.contact.client_id
            contact_id = conversation.contact.id

        client_id, contact_id, contact_name = await self.resolve_contact_assignment(
            client_id=client_id,
            contact_id=contact_id,
            contact_name=contact_name,
        )

        project_context_id = payload.project_context_id or conversation.project_context_id
        project = None

        if project_context_id:
            project = await self.projects.find_project(project_context_id)
        elif payload.create_project_context:
            project_title = payload.new_project_title or payload.title or (contact_name and f"{contact_name} demand") or "Message demand"
            project = await self.projects.create(
                {
                    "title": project_title,
                    "description": payload.description or message.content,
                    "stage": "lead",
                    "status": "open",
                    "priority": payload.priority,
                    "source_type": ProjectSourceType.MESSAGE,
                    "source_message_id": message.id,
                    "source_conversation_id": conversation.id,
                    "client_id": client_id,
                    "contact_id": contact_id,
                    "contact_name": contact_name,
                    "channel": conversation.channel,
                    "tag": None,
                    "owner_user_id": payload.owner_user_id,
                    "created_by_user_id": current_user.id,
                    "due_date": payload.due_date,
                    "value": 0,
                    "progress": 0,
                }
            )
            project_context_id = project.id
        else:
            error_response, status = create_error_response(
                code="PROJECT_CONTEXT_REQUIRED",
                message="A project context is required to create a task from message",
                status_code=422,
            )
            raise HTTPException(status_code=status, detail=error_response)

        if not project:
            project = await self.projects.find_project(project_context_id)

        task = await self.tasks.create(
            {
                "project_id": project.id,
                "title": payload.title or "Message follow-up task",
                "description": payload.description or message.content,
                "status": payload.status,
                "priority": payload.priority,
                "owner_user_id": payload.owner_user_id or project.owner_user_id,
                "source_message_id": message.id,
                "source_conversation_id": conversation.id,
                "due_date": payload.due_date,
                "created_by_user_id": current_user.id,
            }
        )

        if payload.attach_conversation_to_project:
            conversation.project_context_id = project.id
            self.db.commit()

        return await self.tasks.find_task(project.id, task.id)

    async def update_project_task(
        self,
        project: Project,
        task: ProjectTask,
        payload: ProjectTaskUpdate,
    ) -> ProjectTask:
        if payload.owner_user_id:
            await self.ensure_owner_exists(payload.owner_user_id)

        updated = await self.tasks.update(task.id, payload.model_dump(exclude_unset=True))
        return await self.tasks.find_task(project.id, updated.id)


def serialize_project(project: Project) -> dict:
    return {
        "id": project.id,
        "reference": project.reference_code,
        "title": project.title,
        "description": project.description,
        "stage": project.stage,
        "priority": project.priority,
        "status": project.status,
        "source_type": project.source_type,
        "source_message_id": project.source_message_id,
        "conversation_id": project.source_conversation_id,
        "project_context_id": project.project_context_id,
        "client_id": project.client_id,
        "client": (
            {
                "id": project.client.id,
                "name": project.client.name,
                "company_name": project.client.company_name,
                "country": project.client.country,
                "client_type": project.client.client_type,
                "currency": project.client.currency,
                "website": project.client.website,
                "owner_user_id": project.client.owner_user_id,
                "owner_name": project.client.owner.full_name if project.client.owner else None,
                "created_at": project.client.created_at,
                "updated_at": project.client.updated_at,
                "deleted_at": project.client.deleted_at,
            }
            if project.client
            else None
        ),
        "contact_id": project.contact_id,
        "contact": (
            {
                "id": project.contact.id,
                "name": project.contact.name,
                "email": project.contact.email,
                "phone": project.contact.phone,
                "channel_identifier": project.contact.channel_identifier,
                "created_at": project.contact.created_at,
            }
            if project.contact
            else None
        ),
        "contact_name": project.contact_name,
        "channel": project.channel,
        "tag": project.tag,
        "owner_id": project.owner_user_id,
        "owner_name": project.owner.full_name if project.owner else None,
        "due_date": project.due_date,
        "value": project.value,
        "progress": project.progress,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def serialize_project_task(task: ProjectTask) -> dict:
    return {
        "id": task.id,
        "project_id": task.project_id,
        "project_reference": task.project.reference_code if task.project else None,
        "project_title": task.project.title if task.project else None,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "priority": task.priority,
        "owner_id": task.owner_user_id,
        "owner_name": task.owner.full_name if task.owner else None,
        "created_by_id": task.created_by_user_id,
        "created_by_name": task.created_by.full_name if task.created_by else None,
        "source_message_id": task.source_message_id,
        "source_conversation_id": task.source_conversation_id,
        "due_date": task.due_date,
        "automation_type": task.automation_type,
        "automation_status": task.automation_status,
        "automation_run_at": task.automation_run_at,
        "automation_message_content": task.automation_message_content,
        "automation_action_label": task.automation_action_label,
        "automation_last_error": task.automation_last_error,
        "automation_executed_at": task.automation_executed_at,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


async def run_due_task_automations_once(db: Session) -> None:
    due_tasks = (
        db.query(ProjectTask)
        .filter(
            ProjectTask.automation_type.is_not(None),
            ProjectTask.automation_status == ProjectTaskAutomationStatus.SCHEDULED,
            ProjectTask.automation_run_at.is_not(None),
            ProjectTask.automation_run_at <= datetime.now(timezone.utc),
        )
        .all()
    )

    if not due_tasks:
        return

    from app.services.message_service import MessageService

    for task in due_tasks:
        try:
            task.automation_status = ProjectTaskAutomationStatus.PROCESSING
            task.automation_last_error = None
            db.commit()

            if task.automation_type == ProjectTaskAutomationType.SEND_MESSAGE:
                if not task.source_conversation_id:
                    raise ValueError("Task automation requires a source conversation")
                conversation = db.query(Conversation).filter(Conversation.id == task.source_conversation_id).first()
                if not conversation:
                    raise ValueError("Source conversation not found")
                if not task.automation_message_content:
                    raise ValueError("Automation message content is empty")

                await MessageService(db).send_from_dashboard(
                    conversation=conversation,
                    content=task.automation_message_content,
                    owner_id=task.owner_user_id,
                    message_type="TEXT",
                )
            elif task.automation_type == ProjectTaskAutomationType.SCHEDULED_ACTION:
                if not task.automation_action_label:
                    raise ValueError("Automation action label is empty")
            else:
                raise ValueError("Unsupported automation type")

            task.automation_status = ProjectTaskAutomationStatus.COMPLETED
            task.automation_executed_at = datetime.now(timezone.utc)
            task.automation_last_error = None
            db.commit()
        except Exception as exc:
            task.automation_status = ProjectTaskAutomationStatus.FAILED
            task.automation_last_error = str(exc)
            db.commit()
