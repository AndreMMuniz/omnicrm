from fastapi import APIRouter
from app.api.endpoints import chat, telegram, whatsapp, auth, users, audit, dashboard, upload, channels, quick_replies, projects, catalog, proposals, clients, leads
from app.api.endpoints.config_routes import router as config_router

api_router = APIRouter()
api_router.include_router(auth.router,      prefix="/auth",      tags=["auth"])
api_router.include_router(users.router,     prefix="/admin",     tags=["admin"])
api_router.include_router(audit.router,     prefix="/admin",     tags=["audit"])
api_router.include_router(dashboard.router, prefix="/admin",     tags=["dashboard"])
api_router.include_router(config_router,    prefix="/admin",     tags=["settings"])
api_router.include_router(chat.router,      prefix="/chat",      tags=["chat"])
api_router.include_router(upload.router,    prefix="/upload",    tags=["upload"])
api_router.include_router(telegram.router,  prefix="/telegram",  tags=["telegram"])
api_router.include_router(whatsapp.router,  prefix="/whatsapp",  tags=["whatsapp"])
api_router.include_router(channels.router,  prefix="/channels",  tags=["channels"])
api_router.include_router(quick_replies.router, prefix="/admin", tags=["quick-replies"])
api_router.include_router(projects.router,  prefix="/admin",     tags=["projects"])
api_router.include_router(catalog.router,   prefix="/admin",     tags=["catalog"])
api_router.include_router(proposals.router, prefix="/admin",     tags=["proposals"])
api_router.include_router(clients.router,   prefix="/admin",     tags=["clients"])
api_router.include_router(leads.router,     prefix="/leads",     tags=["leads"])
