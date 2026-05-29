# Chat Multi-Channel

A multi-channel customer support platform that centralizes WhatsApp, Telegram, Email, and SMS conversations in a single interface, with AI support and granular role-based access control.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), Tailwind CSS, Shadcn UI |
| Backend | Python 3.11, FastAPI, Uvicorn |
| AI / Agents | LangGraph, LangChain, OpenAI |
| Database | PostgreSQL via SQLAlchemy + Alembic |
| Auth | Supabase Auth (JWT) |
| Channels | Telegram, WhatsApp (Meta Cloud API), Email (IMAP/SMTP), SMS (Twilio) |
| Real-time | Native WebSocket (FastAPI) |

## Project Structure

```
/backend          FastAPI service
  /app
    /api
      /endpoints  auth, chat, users, audit, dashboard, upload, telegram, settings
    /core         database, auth, config, websocket, checkpointer
    /models       SQLAlchemy models (User, Conversation, Message, etc.)
    /schemas      Pydantic schemas
    /services     telegram_service, storage_service, audit_service
  main.py
  requirements.txt

/frontend         Next.js application
  /src
    /app          login, dashboard, admin (users, user-types, settings)
    /components   SideNavBar, ClientLayout, AudioMessage
    /lib          api.ts (HTTP client)
```

## Implemented Features

### Backend
- JWT authentication integrated with Supabase Auth
- RBAC with customizable `UserType` — granular permissions per role (view all conversations, delete messages, manage users, change settings, view audit logs, etc.)
- Full model set: `User`, `UserType`, `Contact`, `Conversation`, `Message`, `AISuggestion`, `QuickReply`, `GeneralSettings`, `AuditLog`
- REST API at `/api/v1` with groups: `auth`, `chat`, `upload`, `telegram`, `admin` (users, audit, dashboard, settings)
- AI reply suggestions via LangGraph
- Telegram webhook
- File/media upload
- WebSocket for real-time message delivery
- Database migrations via Alembic

### Frontend
- Login screen
- Conversation dashboard
- Admin panel: user management, user types (RBAC), general platform settings
- API integration via `lib/api.ts`

### Platform Settings
- Branding: app name, logo, colors (primary, secondary, accent)
- AI: provider and model (e.g. OpenRouter + gpt-4o-mini)
- WhatsApp: Phone ID, Account ID, Access Token, Webhook Token
- Email: IMAP and SMTP (host, port, address, password)
- SMS: Twilio Account SID, Auth Token, phone number

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL (or a Supabase project)

### Backend

```bash
cd backend
python -m venv venv

# Linux/macOS
source venv/bin/activate

# Windows
.\venv\Scripts\Activate.ps1

pip install -r requirements.txt
cp .env.example .env   # fill in your keys
python main.py
```

The API runs at `http://localhost:8000` and the interactive docs at `http://localhost:8000/docs`.

### Backend Docker Dev

For a local-only backend that does not reuse the production-oriented `backend/.env`, use the dedicated Docker dev stack:

```bash
npm run backend:dev:up
```

This starts:

- `chat-multi-channel-postgres-dev` on `localhost:5433`
- `chat-multi-channel-backend-dev` on `localhost:8000`

The stack uses `backend/.env.docker.dev`, which is meant for local development only and keeps webhooks, AI keys, and real Supabase integration disabled by default. To stop it:

```bash
npm run backend:dev:down
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

## Environment Variables (backend)

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SECRET_KEY=
TELEGRAM_BOT_TOKEN=
```

## Channel Status

| Channel | Status |
|---|---|
| Telegram | Integrated (webhook) |
| WhatsApp | Configurable via Settings (Meta Cloud API) |
| Email | Configurable via Settings (IMAP/SMTP) |
| SMS | Configurable via Settings (Twilio) |
