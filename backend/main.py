import asyncio
import os
from contextlib import asynccontextmanager
from urllib.parse import urlparse
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import uvicorn
from app.api.api import api_router
from app.core.config import settings
from app.core.limiter import limiter
from app.services.telegram_service import telegram_service


def _resolve_telegram_bot_token() -> str:
    """Prefer the encrypted DB-backed token, then fall back to the environment."""
    env_token = settings.TELEGRAM_BOT_TOKEN

    try:
        from app.core.database import SessionLocal
        from app.models.models import GeneralSettings

        if not SessionLocal:
            return env_token

        db = SessionLocal()
        try:
            cfg = db.query(GeneralSettings).first()
            return (cfg.telegram_bot_token if cfg and cfg.telegram_bot_token else env_token) or ""
        finally:
            db.close()
    except Exception as exc:
        print(f"Telegram token bootstrap fallback to env: {exc}")
        return env_token


def _validate_encryption_key() -> None:
    """Fail fast if DATABASE_ENCRYPTION_KEY is missing or malformed in production."""
    key_hex = os.getenv("DATABASE_ENCRYPTION_KEY", "")
    env = os.getenv("ENVIRONMENT", "development")
    if env == "production" and not key_hex:
        import sys
        print(
            "CRITICAL: DATABASE_ENCRYPTION_KEY is not set in production. "
            "Channel credentials would be stored unencrypted. "
            "Generate a key with: python3 -c \"import secrets; print(secrets.token_hex(32))\" "
            "and set it as DATABASE_ENCRYPTION_KEY. Exiting.",
            flush=True,
        )
        sys.exit(1)
    if key_hex:
        try:
            key = bytes.fromhex(key_hex)
            if len(key) != 32:
                raise ValueError(f"Expected 32 bytes (64 hex chars), got {len(key)} bytes")
        except Exception as exc:
            import sys
            print(f"CRITICAL: Invalid DATABASE_ENCRYPTION_KEY: {exc}. Exiting.", flush=True)
            sys.exit(1)


def _validate_ai_key() -> None:
    """Warn (dev) or exit (production) if no LLM API key is configured."""
    env = os.getenv("ENVIRONMENT", "development")
    if not settings.OPENAI_API_KEY:
        msg = (
            "AI API key is not set. AI suggestions will not work. "
            "Set OPENROUTER_API_KEY or OPENAI_API_KEY — see backend/.env.example."
        )
        if env == "production":
            import sys
            print(f"CRITICAL: {msg} Exiting.", flush=True)
            sys.exit(1)
        else:
            import logging
            logging.getLogger(__name__).warning(msg)


_validate_encryption_key()
_validate_ai_key()

_EMAIL_POLL_INTERVAL = int(os.getenv("EMAIL_POLL_INTERVAL_SECONDS", "60"))
_SLA_CHECK_INTERVAL = int(os.getenv("SLA_CHECK_INTERVAL_SECONDS", "120"))
_SLA_THRESHOLD_MINUTES = int(os.getenv("SLA_THRESHOLD_MINUTES", "60"))
_TASK_AUTOMATION_INTERVAL = int(os.getenv("TASK_AUTOMATION_INTERVAL_SECONDS", "30"))


async def _email_poll_loop() -> None:
    """Background task: poll IMAP every EMAIL_POLL_INTERVAL_SECONDS for new emails."""
    from app.core.database import SessionLocal
    from app.services.email_service import EmailService

    while True:
        try:
            db = SessionLocal()
            try:
                svc = EmailService.from_settings(db)
                if svc:
                    await svc.poll_and_process(db)
            finally:
                db.close()
        except Exception as e:
            print(f"[EmailPoller] Error: {e}")
        await asyncio.sleep(_EMAIL_POLL_INTERVAL)


async def _sla_check_loop() -> None:
    """Periodically scan open conversations exceeding the SLA threshold and alert managers."""
    from datetime import datetime, timedelta, timezone
    from app.core.database import SessionLocal
    from app.models.models import Conversation, ConversationStatus
    from app.core.websocket import manager

    while True:
        await asyncio.sleep(_SLA_CHECK_INTERVAL)
        try:
            db = SessionLocal()
            try:
                cutoff = datetime.now(timezone.utc) - timedelta(minutes=_SLA_THRESHOLD_MINUTES)
                at_risk = db.query(Conversation).filter(
                    Conversation.status == ConversationStatus.OPEN,
                    Conversation.is_unread == True,
                    Conversation.last_message_date <= cutoff,
                ).all()
                if at_risk:
                    await manager.broadcast_global(
                        event_type="sla_risk_alert",
                        data={
                            "count": len(at_risk),
                            "threshold_minutes": _SLA_THRESHOLD_MINUTES,
                            "conversation_ids": [str(c.id) for c in at_risk],
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        },
                    )
            finally:
                db.close()
        except Exception as e:
            print(f"[SLACheck] Error: {e}")


async def _task_automation_loop() -> None:
    """Periodically execute due project task automations."""
    from app.core.database import SessionLocal
    from app.services.project_service import run_due_task_automations_once

    while True:
        await asyncio.sleep(_TASK_AUTOMATION_INTERVAL)
        try:
            db = SessionLocal()
            try:
                await run_due_task_automations_once(db)
            finally:
                db.close()
        except Exception as e:
            print(f"[TaskAutomation] Error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: register Telegram webhook + start Email IMAP polling + agent workers."""
    telegram_token = _resolve_telegram_bot_token()
    if telegram_token != telegram_service.bot_token:
        telegram_service.reload(telegram_token)

    base_url = settings.WEBHOOK_BASE_URL.rstrip("/")
    if base_url and telegram_token:
        webhook_url = f"{base_url}/api/v1/telegram/webhook"
        # Fire-and-forget: don't block startup waiting for Telegram API response.
        # A slow/unavailable Telegram API was causing 4+ minute startup delays.
        asyncio.create_task(telegram_service.set_webhook(webhook_url))

    email_task = asyncio.create_task(_email_poll_loop())
    sla_task = asyncio.create_task(_sla_check_loop())
    task_automation_task = asyncio.create_task(_task_automation_loop())

    # Start AI agent workers
    from src.worker.consumer import start_workers, stop_workers
    agent_worker_tasks = await start_workers()

    yield

    for task in (email_task, sla_task, task_automation_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    await stop_workers(agent_worker_tasks)


app = FastAPI(title="Multi-Channel Chat API", version="1.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — restrict to ALLOWED_ORIGINS in production, permissive in development
def _normalize_origin(value: str) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def _expand_origin_variants(origin: str) -> list[str]:
    parsed = urlparse(origin)
    host = parsed.hostname or ""
    current = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")

    if not host or host in {"localhost", "127.0.0.1"} or ":" in parsed.netloc:
        return [current]

    alternate_host = host[4:] if host.startswith("www.") else f"www.{host}"
    alternate = f"{parsed.scheme}://{alternate_host}".rstrip("/")
    return list(dict.fromkeys([current, alternate]))


def _build_allowed_origins() -> list[str]:
    configured = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
    configured.append(settings.FRONTEND_URL)

    normalized: list[str] = []
    for candidate in configured:
        origin = _normalize_origin(candidate)
        if not origin:
            continue
        normalized.extend(_expand_origin_variants(origin))

    if normalized:
        return list(dict.fromkeys(normalized))

    return ["http://localhost:3000", "http://localhost:3001"]


origins = _build_allowed_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/")
async def root():
    return {"message": "Multi-Channel Chat API is running"}


@app.get("/health")
async def health_check():
    """
    Liveness + readiness probe with operational metrics (Story 7.4).
    Used by Railway healthcheck and internal monitoring.
    """
    from app.core.database import engine
    from app.core.websocket import manager
    from src.shared.queue import agent_queue

    # DB pool stats (SQLAlchemy pool)
    pool_status: dict = {}
    db_ok = True
    if engine:
        try:
            pool = engine.pool
            pool_status = {
                "size": pool.size(),
                "checked_in": pool.checkedin(),
                "checked_out": pool.checkedout(),
                "overflow": pool.overflow(),
            }
        except Exception:
            db_ok = False

    # WebSocket connections
    ws_connections = len(manager._clients)

    # Agent queue depth
    try:
        queue_size = agent_queue().qsize()
    except Exception:
        queue_size = -1

    return {
        "status": "ok" if db_ok else "degraded",
        "environment": settings.ENVIRONMENT,
        "db": {"ok": db_ok, "pool": pool_status},
        "websocket_connections": ws_connections,
        "agent_queue_size": queue_size,
    }





if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
