from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.models import Project, User
from app.schemas.common import create_error_response, create_paginated_response, create_response
from app.schemas.project import (
    ProjectCreate,
    ProjectFromMessageCreate,
    ProjectResponse,
    ProjectStageResponse,
    ProjectStageUpdate,
    ProjectTaskCreate,
    ProjectTaskFromMessageCreate,
    ProjectTaskResponse,
    ProjectTaskUpdate,
    ProjectUpdate,
)
from app.services.project_service import ProjectService, serialize_project, serialize_project_task

router = APIRouter()


@router.get("/project-stages")
@limiter.limit("60/minute")
async def list_project_stages(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProjectService(db)
    stages = await service.stages.find_active_stages()
    return create_response([ProjectStageResponse.model_validate(stage) for stage in stages])


@router.get("/projects")
@limiter.limit("60/minute")
async def list_projects(
    request: Request,
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    stage: Optional[str] = None,
    owner_id: Optional[UUID] = None,
    priority: Optional[str] = None,
    channel: Optional[str] = None,
    source_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProjectService(db)
    projects = await service.projects.find_all_with_filters(
        skip=skip,
        limit=limit,
        search=search,
        stage=stage,
        owner_user_id=str(owner_id) if owner_id else None,
        priority=priority,
        channel=channel,
        source_type=source_type,
    )
    total = await service.projects.count_with_filters(
        search=search,
        stage=stage,
        owner_user_id=str(owner_id) if owner_id else None,
        priority=priority,
        channel=channel,
        source_type=source_type,
    )
    return create_paginated_response(
        data=[ProjectResponse.model_validate(serialize_project(project)) for project in projects],
        total=total,
        page=(skip // limit) + 1,
        page_size=limit,
    )


@router.post("/projects")
@limiter.limit("60/minute")
async def create_project(
    request: Request,
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await ProjectService(db).create_project(payload, current_user)
    return create_response(ProjectResponse.model_validate(serialize_project(project)))


@router.post("/projects/from-message/{message_id}")
@limiter.limit("60/minute")
async def create_project_from_message(
    request: Request,
    message_id: UUID,
    payload: ProjectFromMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await ProjectService(db).create_project_from_message(message_id, payload, current_user)
    return create_response(ProjectResponse.model_validate(serialize_project(project)))


@router.get("/projects/{project_id}")
@limiter.limit("60/minute")
async def get_project(
    request: Request,
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    project = await ProjectService(db).projects.find_project(project_id)
    if not project:
        error_response, status = create_error_response(
            code="PROJECT_NOT_FOUND",
            message="Project not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    return create_response(ProjectResponse.model_validate(serialize_project(project)))


@router.patch("/projects/{project_id}")
@limiter.limit("60/minute")
async def update_project(
    request: Request,
    project_id: UUID,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProjectService(db)
    project = await service.projects.find_project(project_id)
    if not project:
        error_response, status = create_error_response(
            code="PROJECT_NOT_FOUND",
            message="Project not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    updated = await service.update_project(project, payload)
    return create_response(ProjectResponse.model_validate(serialize_project(updated)))


@router.patch("/projects/{project_id}/stage")
@limiter.limit("60/minute")
async def move_project_stage(
    request: Request,
    project_id: UUID,
    payload: ProjectStageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProjectService(db)
    project = await service.projects.find_project(project_id)
    if not project:
        error_response, status = create_error_response(
            code="PROJECT_NOT_FOUND",
            message="Project not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    updated = await service.move_stage(project, payload.stage)
    return create_response(ProjectResponse.model_validate(serialize_project(updated)))


@router.delete("/projects/{project_id}")
@limiter.limit("60/minute")
async def delete_project(
    request: Request,
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    deleted = await ProjectService(db).delete_project(project_id)
    if not deleted:
        error_response, status = create_error_response(
            code="PROJECT_NOT_FOUND",
            message="Project not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    return create_response({"deleted": True, "id": str(project_id)})


@router.get("/projects/{project_id}/tasks")
@limiter.limit("60/minute")
async def list_project_tasks(
    request: Request,
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProjectService(db)
    project = await service.projects.find_project(project_id)
    if not project:
        error_response, status = create_error_response(
            code="PROJECT_NOT_FOUND",
            message="Project not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    tasks = await service.list_project_tasks(project)
    return create_response([ProjectTaskResponse.model_validate(serialize_project_task(task)) for task in tasks])


@router.get("/tasks")
@limiter.limit("60/minute")
async def list_tasks_workspace(
    request: Request,
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    project_id: Optional[UUID] = None,
    owner_id: Optional[UUID] = None,
    created_by_id: Optional[UUID] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    tasks, total = await ProjectService(db).list_tasks_workspace(
        skip=skip,
        limit=limit,
        search=search,
        project_id=project_id,
        owner_user_id=owner_id,
        created_by_user_id=created_by_id,
        status=status,
    )
    return create_paginated_response(
        data=[ProjectTaskResponse.model_validate(serialize_project_task(task)) for task in tasks],
        total=total,
        page=(skip // limit) + 1,
        page_size=limit,
    )


@router.post("/projects/{project_id}/tasks")
@limiter.limit("60/minute")
async def create_project_task(
    request: Request,
    project_id: UUID,
    payload: ProjectTaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProjectService(db)
    project = await service.projects.find_project(project_id)
    if not project:
        error_response, status = create_error_response(
            code="PROJECT_NOT_FOUND",
            message="Project not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    task = await service.create_project_task(project, payload, current_user)
    return create_response(ProjectTaskResponse.model_validate(serialize_project_task(task)))


@router.post("/projects/tasks/from-message/{message_id}")
@limiter.limit("60/minute")
async def create_project_task_from_message(
    request: Request,
    message_id: UUID,
    payload: ProjectTaskFromMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    task = await ProjectService(db).create_project_task_from_message(message_id, payload, current_user)
    return create_response(ProjectTaskResponse.model_validate(serialize_project_task(task)))


@router.patch("/projects/{project_id}/tasks/{task_id}")
@limiter.limit("60/minute")
async def update_project_task(
    request: Request,
    project_id: UUID,
    task_id: UUID,
    payload: ProjectTaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    service = ProjectService(db)
    project = await service.projects.find_project(project_id)
    if not project:
        error_response, status = create_error_response(
            code="PROJECT_NOT_FOUND",
            message="Project not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    task = await service.tasks.find_task(project_id, task_id)
    if not task:
        error_response, status = create_error_response(
            code="PROJECT_TASK_NOT_FOUND",
            message="Project task not found",
            status_code=404,
        )
        raise HTTPException(status_code=status, detail=error_response)
    updated = await service.update_project_task(project, task, payload)
    return create_response(ProjectTaskResponse.model_validate(serialize_project_task(updated)))
