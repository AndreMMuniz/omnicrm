from fastapi import FastAPI
from fastapi.testclient import TestClient
from datetime import datetime, timedelta, timezone

from app.api.api import api_router
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.models import (
    ChannelType,
    Client,
    Contact,
    Conversation,
    ConversationStatus,
    DefaultRole,
    Message,
    MessageType,
    OFFICIAL_PROJECT_STAGES,
    Project,
    ProjectPriority,
    ProjectSourceType,
    ProjectStage,
    ProjectStatus,
    ProjectTask,
    ProjectTaskAutomationStatus,
    ProjectTaskAutomationType,
    ProjectTaskStatus,
    User,
    UserType,
)
from app.services.project_service import run_due_task_automations_once


def _seed_user_and_stages(db):
    user_type = UserType(name="Project Admin", base_role=DefaultRole.ADMIN, is_system=False)
    db.add(user_type)
    db.flush()

    user = User(
        auth_id="auth-project-api",
        email="project-api@example.com",
        full_name="Project API User",
        user_type_id=user_type.id,
    )
    db.add(user)

    stages = [
        ProjectStage(key=key, label=label, position=position)
        for key, label, position in OFFICIAL_PROJECT_STAGES
    ]
    db.add_all(stages)
    db.commit()
    db.refresh(user)
    return user


def _make_client(db, current_user):
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")

    def override_get_db():
        try:
            yield db
        finally:
            pass

    async def override_current_user():
        return current_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_current_user
    return TestClient(app, raise_server_exceptions=True)


def test_list_project_stages_returns_official_commercial_stages(db):
    user = _seed_user_and_stages(db)
    client = _make_client(db, user)

    response = client.get("/api/v1/admin/project-stages")
    assert response.status_code == 200
    payload = response.json()
    labels = [item["label"] for item in payload["data"]]
    assert labels == ["Lead", "Qualification", "Proposal", "Negotiation", "Closed"]


def test_create_and_get_project(db):
    user = _seed_user_and_stages(db)
    client = _make_client(db, user)

    response = client.post(
        "/api/v1/admin/projects",
        json={
            "title": "Client onboarding demand",
            "description": "Customer asked for onboarding support",
            "stage": "lead",
            "priority": "medium",
            "status": "open",
            "source_type": "manual",
            "progress": 10,
        },
    )
    assert response.status_code == 200
    created = response.json()["data"]
    assert created["reference"].startswith("PRJ-")
    assert created["stage"] == "lead"

    get_response = client.get(f"/api/v1/admin/projects/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["data"]["title"] == "Client onboarding demand"


def test_list_projects_supports_stage_and_channel_filters(db):
    user = _seed_user_and_stages(db)
    contact = Contact(name="TechCorp")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.flush()

    db.add_all(
        [
            Project(
                title="Lead project",
                description="Alpha",
                stage="lead",
                priority=ProjectPriority.MEDIUM,
                status=ProjectStatus.OPEN,
                source_type=ProjectSourceType.MANUAL,
                created_by_user_id=user.id,
                channel=ChannelType.WHATSAPP,
            ),
            Project(
                title="Closed email project",
                description="Beta",
                stage="closed",
                priority=ProjectPriority.HIGH,
                status=ProjectStatus.DONE,
                source_type=ProjectSourceType.MANUAL,
                created_by_user_id=user.id,
                channel=ChannelType.EMAIL,
            ),
        ]
    )
    db.commit()

    client = _make_client(db, user)

    stage_response = client.get("/api/v1/admin/projects", params={"stage": "lead"})
    assert stage_response.status_code == 200
    assert len(stage_response.json()["data"]) == 1
    assert stage_response.json()["data"][0]["title"] == "Lead project"

    channel_response = client.get("/api/v1/admin/projects", params={"channel": "email"})
    assert channel_response.status_code == 200
    assert len(channel_response.json()["data"]) == 1
    assert channel_response.json()["data"][0]["title"] == "Closed email project"


def test_list_projects_includes_client_payload_without_validation_error(db):
    user = _seed_user_and_stages(db)
    linked_client = Client(
        name="Acme Holding",
        company_name="Acme Holding SA",
        created_by_user_id=user.id,
        owner_user_id=user.id,
    )
    db.add(linked_client)
    db.flush()

    db.add(
        Project(
            title="Client-linked project",
            description="Gamma",
            stage="lead",
            priority=ProjectPriority.MEDIUM,
            status=ProjectStatus.OPEN,
            source_type=ProjectSourceType.MANUAL,
            created_by_user_id=user.id,
            client_id=linked_client.id,
        )
    )
    db.commit()

    client = _make_client(db, user)

    response = client.get("/api/v1/admin/projects")
    assert response.status_code == 200

    payload = response.json()["data"][0]
    assert payload["client"]["id"] == str(linked_client.id)
    assert payload["client"]["updated_at"] is not None


def test_update_move_stage_and_delete_project(db):
    user = _seed_user_and_stages(db)
    project = Project(
        title="Mutable project",
        description="Initial description",
        stage="lead",
        priority=ProjectPriority.MEDIUM,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=user.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    client = _make_client(db, user)

    update_response = client.patch(
        f"/api/v1/admin/projects/{project.id}",
        json={"title": "Updated project", "progress": 55, "priority": "high"},
    )
    assert update_response.status_code == 200
    updated = update_response.json()["data"]
    assert updated["title"] == "Updated project"
    assert updated["progress"] == 55
    assert updated["priority"] == "high"

    stage_response = client.patch(
        f"/api/v1/admin/projects/{project.id}/stage",
        json={"stage": "negotiation"},
    )
    assert stage_response.status_code == 200
    assert stage_response.json()["data"]["stage"] == "negotiation"

    delete_response = client.delete(f"/api/v1/admin/projects/{project.id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["data"]["deleted"] is True


def test_delete_project_clears_conversation_and_child_project_references(db):
    user = _seed_user_and_stages(db)
    contact = Contact(name="Delete Context Contact")
    db.add(contact)
    db.flush()

    parent_project = Project(
        title="Parent project",
        description="Context root",
        stage="lead",
        priority=ProjectPriority.MEDIUM,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=user.id,
    )
    db.add(parent_project)
    db.flush()

    child_project = Project(
        title="Child project",
        description="Nested context",
        stage="qualification",
        priority=ProjectPriority.MEDIUM,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=user.id,
        project_context_id=parent_project.id,
    )
    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
        project_context_id=parent_project.id,
    )
    db.add_all([child_project, conversation])
    db.commit()

    client = _make_client(db, user)

    delete_response = client.delete(f"/api/v1/admin/projects/{parent_project.id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["data"]["deleted"] is True

    db.refresh(child_project)
    db.refresh(conversation)
    assert child_project.project_context_id is None
    assert conversation.project_context_id is None
    assert db.query(Project).filter(Project.id == parent_project.id).first() is None


def test_create_list_and_update_project_tasks(db):
    user = _seed_user_and_stages(db)
    project = Project(
        title="Task container project",
        description="Project with execution items",
        stage="lead",
        priority=ProjectPriority.MEDIUM,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=user.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    client = _make_client(db, user)

    create_response = client.post(
        f"/api/v1/admin/projects/{project.id}/tasks",
        json={
            "title": "Send contract",
            "description": "Follow up with the latest contract version",
            "priority": "high",
            "status": "open",
        },
    )
    assert create_response.status_code == 200
    created = create_response.json()["data"]
    assert created["project_id"] == str(project.id)
    assert created["title"] == "Send contract"
    assert created["status"] == "open"

    list_response = client.get(f"/api/v1/admin/projects/{project.id}/tasks")
    assert list_response.status_code == 200
    assert len(list_response.json()["data"]) == 1

    update_response = client.patch(
        f"/api/v1/admin/projects/{project.id}/tasks/{created['id']}",
        json={"status": "done", "title": "Send signed contract"},
    )
    assert update_response.status_code == 200
    updated = update_response.json()["data"]
    assert updated["status"] == "done"
    assert updated["title"] == "Send signed contract"

    db.refresh(project)
    task = project.tasks[0]
    assert task.status == ProjectTaskStatus.DONE


def test_list_tasks_workspace_supports_project_owner_creator_and_status_filters(db):
    user = _seed_user_and_stages(db)
    other_user = User(
        auth_id="auth-project-api-2",
        email="project-api-2@example.com",
        full_name="Second Project User",
        user_type_id=user.user_type_id,
    )
    db.add(other_user)
    db.flush()

    project_one = Project(
        title="Customer rollout",
        description="Parent project one",
        stage="lead",
        priority=ProjectPriority.MEDIUM,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=user.id,
        owner_user_id=user.id,
    )
    project_two = Project(
        title="Renewal plan",
        description="Parent project two",
        stage="proposal",
        priority=ProjectPriority.HIGH,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=other_user.id,
        owner_user_id=other_user.id,
    )
    db.add_all([project_one, project_two])
    db.flush()

    db.add_all(
        [
            ProjectTask(
                project_id=project_one.id,
                title="Send rollout checklist",
                description="Assigned to primary user",
                status=ProjectTaskStatus.OPEN,
                priority=ProjectPriority.MEDIUM,
                owner_user_id=user.id,
                created_by_user_id=other_user.id,
            ),
            ProjectTask(
                project_id=project_two.id,
                title="Review renewal proposal",
                description="Assigned to second user",
                status=ProjectTaskStatus.DONE,
                priority=ProjectPriority.HIGH,
                owner_user_id=other_user.id,
                created_by_user_id=user.id,
            ),
        ]
    )
    db.commit()

    client = _make_client(db, user)

    all_response = client.get("/api/v1/admin/tasks")
    assert all_response.status_code == 200
    assert all_response.json()["meta"]["total"] == 2
    first_row = all_response.json()["data"][0]
    assert "project_reference" in first_row
    assert "project_title" in first_row
    assert "created_by_id" in first_row
    assert "created_by_name" in first_row

    project_response = client.get("/api/v1/admin/tasks", params={"project_id": str(project_one.id)})
    assert project_response.status_code == 200
    assert len(project_response.json()["data"]) == 1
    assert project_response.json()["data"][0]["project_id"] == str(project_one.id)

    owner_response = client.get("/api/v1/admin/tasks", params={"owner_id": str(user.id)})
    assert owner_response.status_code == 200
    assert len(owner_response.json()["data"]) == 1
    assert owner_response.json()["data"][0]["owner_id"] == str(user.id)

    creator_response = client.get("/api/v1/admin/tasks", params={"created_by_id": str(user.id)})
    assert creator_response.status_code == 200
    assert len(creator_response.json()["data"]) == 1
    assert creator_response.json()["data"][0]["created_by_id"] == str(user.id)

    status_response = client.get("/api/v1/admin/tasks", params={"status": "done"})
    assert status_response.status_code == 200
    assert len(status_response.json()["data"]) == 1
    assert status_response.json()["data"][0]["status"] == "done"


def test_create_project_task_from_message_can_attach_to_existing_project_context(db):
    user = _seed_user_and_stages(db)
    contact = Contact(name="Task Contact")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.flush()

    project = Project(
        title="Execution Project",
        description="Parent project",
        stage="lead",
        priority=ProjectPriority.MEDIUM,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=user.id,
    )
    db.add(project)
    db.flush()

    message = Message(
        conversation_id=conversation.id,
        owner_id=user.id,
        content="Please send the contract tomorrow",
        inbound=True,
        message_type=MessageType.TEXT,
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    client = _make_client(db, user)
    response = client.post(
        f"/api/v1/admin/projects/tasks/from-message/{message.id}",
        json={
            "title": "Send contract",
            "description": "Customer requested contract follow-up",
            "priority": "high",
            "project_context_id": str(project.id),
            "attach_conversation_to_project": True,
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["project_id"] == str(project.id)
    assert data["source_message_id"] == str(message.id)
    assert data["source_conversation_id"] == str(conversation.id)

    db.refresh(conversation)
    assert str(conversation.project_context_id) == str(project.id)


def test_create_project_task_from_message_can_create_new_project_context(db):
    user = _seed_user_and_stages(db)
    contact = Contact(name="Fresh Task")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=user.id,
        channel=ChannelType.TELEGRAM,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.flush()

    message = Message(
        conversation_id=conversation.id,
        owner_id=user.id,
        content="Need a checklist item from this demand",
        inbound=True,
        message_type=MessageType.TEXT,
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    client = _make_client(db, user)
    response = client.post(
        f"/api/v1/admin/projects/tasks/from-message/{message.id}",
        json={
          "title": "Prepare onboarding checklist",
          "priority": "medium",
          "create_project_context": True,
          "attach_conversation_to_project": True,
          "new_project_title": "Onboarding rollout",
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["project_reference"] is not None
    assert data["source_message_id"] == str(message.id)

    db.refresh(conversation)
    assert conversation.project_context_id is not None


def test_create_project_task_supports_scheduled_automation_fields(db):
    user = _seed_user_and_stages(db)
    project = Project(
        title="Automation Project",
        description="Project with scheduled task",
        stage="lead",
        priority=ProjectPriority.MEDIUM,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=user.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    client = _make_client(db, user)
    run_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    response = client.post(
        f"/api/v1/admin/projects/{project.id}/tasks",
        json={
            "title": "Send follow-up",
            "status": "open",
            "priority": "medium",
            "automation_type": "send_message",
            "automation_status": "scheduled",
            "automation_run_at": run_at.isoformat(),
            "automation_message_content": "Checking in with the customer",
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["automation_type"] == "send_message"
    assert data["automation_status"] == "scheduled"
    assert data["automation_message_content"] == "Checking in with the customer"


def test_due_scheduled_action_task_is_executed(db):
    user = _seed_user_and_stages(db)
    project = Project(
        title="Scheduled Action Project",
        description="Project with scheduled action",
        stage="lead",
        priority=ProjectPriority.MEDIUM,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=user.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    db.add(
        ProjectTask(
            project_id=project.id,
            title="Run internal reminder",
            description="Scheduled internal action",
            status=ProjectTaskStatus.OPEN,
            priority=ProjectPriority.MEDIUM,
            automation_type=ProjectTaskAutomationType.SCHEDULED_ACTION,
            automation_status=ProjectTaskAutomationStatus.SCHEDULED,
            automation_run_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            automation_action_label="notify-ops",
            created_by_user_id=user.id,
        )
    )
    db.commit()

    import asyncio
    asyncio.run(run_due_task_automations_once(db))

    executed_task = db.query(ProjectTask).first()
    assert executed_task.automation_status == ProjectTaskAutomationStatus.COMPLETED
    assert executed_task.automation_executed_at is not None


def test_reject_invalid_progress_and_missing_message_source(db):
    user = _seed_user_and_stages(db)
    client = _make_client(db, user)

    progress_response = client.post(
        "/api/v1/admin/projects",
        json={
            "title": "Broken project",
            "description": "Invalid progress",
            "stage": "lead",
            "priority": "medium",
            "status": "open",
            "source_type": "manual",
            "progress": 101,
        },
    )
    assert progress_response.status_code == 422

    source_response = client.post(
        "/api/v1/admin/projects",
        json={
            "title": "Message project",
            "description": "Missing source message",
            "stage": "lead",
            "priority": "medium",
            "status": "open",
            "source_type": "message",
            "progress": 10,
        },
    )
    assert source_response.status_code == 422
    assert source_response.json()["detail"]["error"]["code"] == "SOURCE_MESSAGE_REQUIRED"


def test_create_project_from_message_hydrates_real_context(db):
    user = _seed_user_and_stages(db)
    contact = Contact(name="TechCorp")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.flush()

    message = Message(
        conversation_id=conversation.id,
        owner_id=user.id,
        content="Customer needs onboarding help this week",
        inbound=True,
        message_type=MessageType.TEXT,
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    client = _make_client(db, user)
    response = client.post(
        f"/api/v1/admin/projects/from-message/{message.id}",
        json={
            "stage": "lead",
            "priority": "high",
            "progress": 15,
            "tag": "onboarding",
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["source_type"] == "message"
    assert data["source_message_id"] == str(message.id)
    assert data["conversation_id"] == str(conversation.id)
    assert data["contact_name"] == "TechCorp"
    assert data["channel"] == "whatsapp"
    assert data["description"] == "Customer needs onboarding help this week"


def test_create_project_from_message_rejects_unknown_message(db):
    user = _seed_user_and_stages(db)
    client = _make_client(db, user)

    response = client.post(
        "/api/v1/admin/projects/from-message/6c4bcdd5-9b92-4470-931c-c1d9d0d4c8a0",
        json={"stage": "lead", "priority": "medium", "progress": 10},
    )
    assert response.status_code == 404
    assert response.json()["detail"]["error"]["code"] == "MESSAGE_NOT_FOUND"


def test_create_project_from_message_can_adopt_created_project_as_conversation_context(db):
    user = _seed_user_and_stages(db)
    contact = Contact(name="Nova Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.flush()

    message = Message(
        conversation_id=conversation.id,
        owner_id=user.id,
        content="Need a brand new project",
        inbound=True,
        message_type=MessageType.TEXT,
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    client = _make_client(db, user)
    response = client.post(
        f"/api/v1/admin/projects/from-message/{message.id}",
        json={
            "stage": "lead",
            "priority": "medium",
            "progress": 0,
            "attach_conversation_to_project": True,
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["project_context_id"] is None

    db.refresh(conversation)
    assert str(conversation.project_context_id) == data["id"]


def test_create_project_from_message_can_route_to_existing_project_context(db):
    user = _seed_user_and_stages(db)
    contact = Contact(name="Existing Context")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.flush()

    project_context = Project(
        title="Main Project Context",
        description="Top level project",
        stage="lead",
        priority=ProjectPriority.MEDIUM,
        status=ProjectStatus.OPEN,
        source_type=ProjectSourceType.MANUAL,
        created_by_user_id=user.id,
    )
    db.add(project_context)
    db.flush()

    message = Message(
        conversation_id=conversation.id,
        owner_id=user.id,
        content="Route this demand into existing context",
        inbound=True,
        message_type=MessageType.TEXT,
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    client = _make_client(db, user)
    response = client.post(
        f"/api/v1/admin/projects/from-message/{message.id}",
        json={
            "stage": "lead",
            "priority": "high",
            "progress": 10,
            "project_context_id": str(project_context.id),
            "attach_conversation_to_project": True,
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["project_context_id"] == str(project_context.id)

    db.refresh(conversation)
    assert conversation.project_context_id == project_context.id
