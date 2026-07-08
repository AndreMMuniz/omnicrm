from typing import Optional
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.models import AuditLog


def log_action(
    db: Session,
    user_id: UUID,
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    details: Optional[dict] = None,
    ip_address: Optional[str] = None,
    commit: bool = True,
) -> AuditLog:
    # Ensure details is JSON serializable (convert UUIDs, datetimes, etc. to strings)
    if details:
        import json
        details = json.loads(json.dumps(details, default=str))

    entry = AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details,
        ip_address=ip_address,
    )
    db.add(entry)
    if commit:
        db.commit()
        db.refresh(entry)
    return entry
