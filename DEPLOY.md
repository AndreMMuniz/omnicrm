# Deployment Guide

## Stack
- **Backend:** FastAPI -> Coolify/Docker (`backend/`)
- **Frontend:** Next.js -> Vercel (auto-deploy from `main` branch, root dir: `frontend/`)
- **Database:** Supabase (PostgreSQL)

## Como funciona o deploy do backend

```
Push para main
    ->
Coolify build (Dockerfile)
    ->
Container start: docker-entrypoint.sh
    ->
alembic upgrade head              <- migrations rodam AQUI
    -> (so avanca se migration passar)
uvicorn main:app                  <- servidor sobe depois das migrations
    ->
Health check: GET /health
    ->
Trafego roteado para novo container
```

Se a migration falhar, o container novo nao deve entrar em servico.

## Regras de ouro

### 1. Migrations NUNCA no lifespan do FastAPI
```python
# ERRADO - bloqueia Uvicorn durante startup
@asynccontextmanager
async def lifespan(app):
    await run_migrations()
    yield

# CORRETO - migrations rodam via entrypoint/pre-deploy do container
```

### 2. Chamadas externas no lifespan devem ser fire-and-forget
```python
# ERRADO - bloqueia startup se Telegram API estiver lenta
await telegram_service.set_webhook(webhook_url)

# CORRETO - nao bloqueia startup
asyncio.create_task(telegram_service.set_webhook(webhook_url))
```

### 3. Toda chamada httpx precisa de timeout explicito
```python
# ERRADO
async with httpx.AsyncClient() as client:

# CORRETO
async with httpx.AsyncClient(timeout=15.0) as client:
```

## ADR-001: Migrations fora do lifespan

**Data:** 2026-05-02  
**Contexto:** Alembic rodando no lifespan do FastAPI ou chamadas HTTP sem timeout bloqueavam Uvicorn por 4+ minutos a cada deploy, causando drops de WebSocket em producao.  
**Decisao:** Migrations rodam antes do `uvicorn`, via `docker-entrypoint.sh` ou pre-deploy do host. Lifespan deve conter apenas inicializacao leve e non-blocking.  
**Enforcement:** `backend/docker-entrypoint.sh` garante a separacao. Nunca adicionar alembic no `backend/main.py`.

## Coolify

- Backend usa o `backend/Dockerfile`.
- O entrypoint padrao roda `alembic upgrade head` e depois inicia o `uvicorn`.
- Para jobs/containers que nao devem migrar schema, defina `RUN_DB_MIGRATIONS=0`.
- Se o Coolify oferecer pre-deploy command confiavel, ele pode substituir o entrypoint para esse passo, mas nunca mova migrations para o lifespan.

## Checklist para qualquer deploy que toque o schema

```
[ ] Nova migration e backward-compatible com o codigo em producao?
[ ] alembic upgrade head foi testado localmente?
[ ] Nenhuma chamada alembic foi adicionada ao lifespan de main.py?
[ ] O deploy no Coolify esta usando `backend/Dockerfile` com `docker-entrypoint.sh`?
[ ] Toda nova chamada HTTP no lifespan tem timeout explicito?
[ ] Toda nova chamada HTTP no lifespan e fire-and-forget (create_task)?
```
