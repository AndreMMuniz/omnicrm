import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Any
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, text

from app.core.database import get_db
from app.core.auth import get_current_user
from app.core.limiter import limiter
from app.models.models import (
    AISuggestion,
    ChannelType,
    Conversation,
    ConversationStatus,
    Message,
    Project,
    ProjectStatus,
    ProjectTask,
    ProjectTaskStatus,
    Proposal,
    ProposalStatus,
    User,
)
from app.schemas.common import create_response

router = APIRouter()


@router.get("/dashboard-summary")
@limiter.limit("60/minute")
async def get_dashboard_summary(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> Dict[str, Any]:
    open_conversations = db.query(func.count(Conversation.id)).filter(
        Conversation.status == ConversationStatus.OPEN
    ).scalar() or 0

    proposals = db.query(func.count(Proposal.id)).filter(
        Proposal.status.in_([
            ProposalStatus.DRAFT,
            ProposalStatus.SENT,
            ProposalStatus.APPROVED,
        ])
    ).scalar() or 0

    your_tasks = db.query(func.count(ProjectTask.id)).filter(
        ProjectTask.owner_user_id == current_user.id,
        ProjectTask.status.in_([
            ProjectTaskStatus.OPEN,
            ProjectTaskStatus.IN_PROGRESS,
        ])
    ).scalar() or 0

    your_projects = db.query(func.count(Project.id)).filter(
        Project.status == ProjectStatus.OPEN
    ).scalar() or 0

    return create_response({
        "open_conversations": open_conversations,
        "proposals": proposals,
        "your_tasks": your_tasks,
        "your_projects": your_projects,
    })


@router.get("/stats")
@limiter.limit("60/minute")
async def get_dashboard_stats(
    request: Request,
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    period_start = now - timedelta(days=days)
    prev_period_start = period_start - timedelta(days=days)

    # ── Conversations overview ─────────────────────────────────────────────
    total = db.query(func.count(Conversation.id)).scalar() or 0

    by_status = {
        row[0].name if hasattr(row[0], "name") else str(row[0]): row[1]
        for row in db.query(
            Conversation.status, func.count(Conversation.id)
        ).group_by(Conversation.status).all()
    }
    open_count    = by_status.get("OPEN", 0)
    closed_count  = by_status.get("CLOSED", 0)
    pending_count = by_status.get("PENDING", 0)
    unread_count  = db.query(func.count(Conversation.id)).filter(
        Conversation.is_unread == True
    ).scalar() or 0

    # ── Messages today ─────────────────────────────────────────────────────
    messages_today = db.query(func.count(Message.id)).filter(
        Message.created_at >= today_start
    ).scalar() or 0

    # ── Resolution rate ────────────────────────────────────────────────────
    resolution_rate = round((closed_count / total * 100) if total > 0 else 0, 1)

    # ── Avg resolution time (hours) — closed conversations in selected period
    closed_in_period = db.query(Conversation).filter(
        Conversation.status == ConversationStatus.CLOSED,
        Conversation.updated_at >= period_start,
    ).all()
    if closed_in_period:
        total_hours = sum(
            (c.updated_at - c.created_at).total_seconds() / 3600
            for c in closed_in_period
            if c.updated_at and c.created_at and c.updated_at > c.created_at
        )
        avg_resolution_hours = round(total_hours / len(closed_in_period), 1)
    else:
        avg_resolution_hours = None

    # ── Channel breakdown ──────────────────────────────────────────────────
    channels = {
        (row[0].name if hasattr(row[0], "name") else str(row[0])).upper(): row[1]
        for row in db.query(
            Conversation.channel, func.count(Conversation.id)
        ).group_by(Conversation.channel).all()
    }

    # ── Current period totals (for comparison) ────────────────────────────
    current_period_convs = db.query(func.count(Conversation.id)).filter(
        Conversation.created_at >= period_start
    ).scalar() or 0
    prev_period_convs = db.query(func.count(Conversation.id)).filter(
        Conversation.created_at >= prev_period_start,
        Conversation.created_at < period_start,
    ).scalar() or 0

    current_period_msgs = db.query(func.count(Message.id)).filter(
        Message.created_at >= period_start
    ).scalar() or 0
    prev_period_msgs = db.query(func.count(Message.id)).filter(
        Message.created_at >= prev_period_start,
        Message.created_at < period_start,
    ).scalar() or 0

    # ── Daily trend builder ────────────────────────────────────────────────
    def build_daily(model, date_field, offset_days: int):
        rows = []
        for i in range(days - 1, -1, -1):
            day_start = (now - timedelta(days=i + offset_days)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            day_end = day_start + timedelta(days=1)
            count = db.query(func.count(model.id)).filter(
                date_field >= day_start,
                date_field < day_end,
            ).scalar() or 0
            label = day_start.strftime("%d/%m") if days > 7 else day_start.strftime("%a")
            rows.append({"date": label, "full_date": day_start.strftime("%b %d"), "count": count})
        return rows

    daily_conversations      = build_daily(Conversation, Conversation.created_at, 0)
    prev_daily_conversations = build_daily(Conversation, Conversation.created_at, days)
    daily_messages           = build_daily(Message,       Message.created_at,       0)
    prev_daily_messages      = build_daily(Message,       Message.created_at,       days)

    # ── SLA & Queue Health (Epic 3) ────────────────────────────────────────────
    sla_threshold_min = int(os.getenv("SLA_THRESHOLD_MINUTES", "60"))
    sla_cutoff = now - timedelta(minutes=sla_threshold_min)

    # Conversations at SLA risk: OPEN + unread + last_message_date before cutoff
    sla_at_risk = db.query(func.count(Conversation.id)).filter(
        Conversation.status == ConversationStatus.OPEN,
        Conversation.is_unread == True,
        Conversation.last_message_date <= sla_cutoff,
    ).scalar() or 0

    # First-response SLA compliance: % of CLOSED conversations in period that had first_response_at
    closed_with_response = db.query(func.count(Conversation.id)).filter(
        Conversation.status == ConversationStatus.CLOSED,
        Conversation.created_at >= period_start,
        Conversation.first_response_at.isnot(None),
    ).scalar() or 0
    total_closed_period = db.query(func.count(Conversation.id)).filter(
        Conversation.status == ConversationStatus.CLOSED,
        Conversation.created_at >= period_start,
    ).scalar() or 0
    sla_compliance_pct = round(
        (closed_with_response / total_closed_period * 100) if total_closed_period > 0 else 0, 1
    )

    # Avg first-response time (minutes) for conversations in the period
    resp_rows = db.query(Conversation).filter(
        Conversation.first_response_at.isnot(None),
        Conversation.created_at >= period_start,
    ).all()
    if resp_rows:
        avg_first_response_min = round(
            sum(
                (c.first_response_at - c.created_at).total_seconds() / 60
                for c in resp_rows
                if c.first_response_at and c.created_at and c.first_response_at > c.created_at
            ) / len(resp_rows), 1
        )
    else:
        avg_first_response_min = None

    # Queue health: open conversations by channel
    queue_by_channel = {
        (row[0].name if hasattr(row[0], "name") else str(row[0])).upper(): row[1]
        for row in db.query(Conversation.channel, func.count(Conversation.id))
        .filter(Conversation.status == ConversationStatus.OPEN)
        .group_by(Conversation.channel)
        .all()
    }

    # Unassigned open conversations
    unassigned_open = db.query(func.count(Conversation.id)).filter(
        Conversation.status == ConversationStatus.OPEN,
        Conversation.assigned_user_id.is_(None),
    ).scalar() or 0

    # ── Story 6.4: P50 / P90 resolution times ────────────────────────────────
    # percentile_cont is a PostgreSQL ordered-set aggregate — use raw SQL
    percentile_rows = db.execute(text("""
        SELECT
            percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600
            ) AS p50_hours,
            percentile_cont(0.9) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600
            ) AS p90_hours
        FROM conversations
        WHERE status = 'CLOSED'
          AND updated_at >= :since
          AND created_at IS NOT NULL
          AND updated_at > created_at
    """), {"since": period_start}).fetchone()

    p50_hours = round(float(percentile_rows[0]), 2) if percentile_rows and percentile_rows[0] else None
    p90_hours = round(float(percentile_rows[1]), 2) if percentile_rows and percentile_rows[1] else None

    # ── Story 6.5: Per-agent performance ─────────────────────────────────────
    agent_rows = db.execute(text("""
        SELECT
            u.id,
            u.full_name,
            COUNT(c.id) AS conversations_handled,
            AVG(EXTRACT(EPOCH FROM (c.first_response_at - c.created_at)) / 60) AS avg_first_response_min,
            SUM(CASE WHEN c.status = 'CLOSED' THEN 1 ELSE 0 END) AS resolved
        FROM users u
        LEFT JOIN conversations c ON c.assigned_user_id = u.id
            AND c.created_at >= :since
        WHERE u.is_active = true AND u.is_approved = true
        GROUP BY u.id, u.full_name
        HAVING COUNT(c.id) > 0
        ORDER BY conversations_handled DESC
        LIMIT 10
    """), {"since": period_start}).fetchall()

    agent_stats = [
        {
            "id": str(row[0]),
            "full_name": row[1],
            "conversations_handled": int(row[2]),
            "avg_first_response_min": round(float(row[3]), 1) if row[3] else None,
            "resolved": int(row[4]),
            "resolution_rate": round(int(row[4]) / int(row[2]) * 100, 1) if int(row[2]) > 0 else 0,
        }
        for row in agent_rows
    ]

    # ── Story 6.5: AI suggestion usage ───────────────────────────────────────
    ai_suggestions_generated = db.query(func.count(AISuggestion.id)).scalar() or 0

    convs_with_ai = db.query(
        func.count(func.distinct(AISuggestion.conversation_id))
    ).scalar() or 0

    ai_adoption_pct = round(
        (convs_with_ai / total * 100) if total > 0 else 0, 1
    )

    # ── Top tags ──────────────────────────────────────────────────────────────
    from app.models.models import Contact
    tag_counts: dict[str, int] = {}
    tag_sources = db.query(Conversation.tags, Conversation.tag).all()
    for tags_value, legacy_tag in tag_sources:
        if tags_value:
            for item in tags_value:
                normalized = str(item).lower()
                tag_counts[normalized] = tag_counts.get(normalized, 0) + 1
        elif legacy_tag:
            normalized = legacy_tag.value if hasattr(legacy_tag, "value") else str(legacy_tag).lower()
            tag_counts[normalized] = tag_counts.get(normalized, 0) + 1

    top_tags = [
        {"tag": tag, "count": count}
        for tag, count in sorted(tag_counts.items(), key=lambda item: item[1], reverse=True)
    ]

    # ── Peak hours (messages grouped by day-of-week + hour) ───────────────────
    peak_rows = db.execute(text("""
        SELECT
            -- PostgreSQL DOW: 0=Sun … 6=Sat → convert to 0=Mon … 6=Sun
            ((EXTRACT(DOW FROM created_at AT TIME ZONE 'UTC')::int + 6) % 7) AS dow,
            EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int           AS hour,
            COUNT(*)                                                          AS cnt
        FROM messages
        WHERE created_at >= :since
        GROUP BY dow, hour
        ORDER BY dow, hour
    """), {"since": period_start}).fetchall()
    peak_hours = [
        {"dow": int(r[0]), "hour": int(r[1]), "count": int(r[2])}
        for r in peak_rows
    ]

    # ── Recent activity (last 15 conversations by updated_at) ─────────────────
    recent_rows = db.execute(text("""
        SELECT
            c.id,
            co.name          AS contact_name,
            u.full_name      AS agent_name,
            c.channel::text  AS channel,
            c.status::text   AS status,
            c.tag::text      AS tag,
            c.last_message,
            c.last_message_date,
            c.updated_at
        FROM conversations c
        JOIN contacts co ON co.id = c.contact_id
        LEFT JOIN users u ON u.id = c.assigned_user_id
        ORDER BY c.updated_at DESC
        LIMIT 15
    """)).fetchall()
    recent_activity = [
        {
            "id": str(r[0]),
            "contact_name": r[1] or "Unknown",
            "agent_name": r[2],
            "channel": (r[3] or "").upper(),
            "status": (r[4] or "").upper(),
            "tag": r[5],
            "last_message": r[6],
            "last_message_date": r[7].isoformat() if r[7] else None,
            "updated_at": r[8].isoformat() if r[8] else None,
        }
        for r in recent_rows
    ]

    return create_response({
        "total_conversations": total,
        "open_conversations": open_count,
        "closed_conversations": closed_count,
        "pending_conversations": pending_count,
        "unread_conversations": unread_count,
        "messages_today": messages_today,
        "resolution_rate": resolution_rate,
        "avg_resolution_hours": avg_resolution_hours,
        "channels": channels,
        "daily_conversations": daily_conversations,
        "prev_daily_conversations": prev_daily_conversations,
        "daily_messages": daily_messages,
        "prev_daily_messages": prev_daily_messages,
        "period_days": days,
        "current_period_conversations": current_period_convs,
        "prev_period_conversations": prev_period_convs,
        "current_period_messages": current_period_msgs,
        "prev_period_messages": prev_period_msgs,
        # SLA & Queue (Epic 3)
        "sla_at_risk": sla_at_risk,
        "sla_threshold_minutes": sla_threshold_min,
        "sla_compliance_pct": sla_compliance_pct,
        "avg_first_response_minutes": avg_first_response_min,
        "queue_by_channel": queue_by_channel,
        "unassigned_open": unassigned_open,
        # Analytics (Epic 6)
        "p50_resolution_hours": p50_hours,
        "p90_resolution_hours": p90_hours,
        "agent_stats": agent_stats,
        "ai_suggestions_generated": ai_suggestions_generated,
        "convs_with_ai": convs_with_ai,
        "ai_adoption_pct": ai_adoption_pct,
        "top_tags": top_tags,
        "peak_hours": peak_hours,
        "recent_activity": recent_activity,
    })
