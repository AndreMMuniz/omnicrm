# Chat Multi-Channel — Codex Context

## Deploy (CRÍTICO — ler antes de qualquer mudança de infra)
Migrações Alembic rodam no **startup do container Docker** via `backend/docker-entrypoint.sh`, **nunca** no lifespan do FastAPI.
Toda chamada HTTP no lifespan deve ser **fire-and-forget** (`asyncio.create_task`) com timeout explícito.
Ver `DEPLOY.md` para o checklist completo e o ADR.

## Stack
- Backend: FastAPI + SQLAlchemy + Alembic → Coolify/Docker
- Frontend: Next.js 14+ + Tailwind + Shadcn/UI → Vercel
- Database: Supabase (PostgreSQL + Auth)
- WebSocket: `/api/v1/chat/ws`

## Padrões importantes
- Credenciais sensíveis usam `EncryptedString` (AES-256) — ver `backend/app/core/encryption.py`
- Rate limiting via `slowapi` — ver `backend/app/core/limiter.py`
- Tokens em HttpOnly cookies (não localStorage)

## Workflow do projeto
- O workflow oficial deste repositório é **BMad**.
- Use `docs/_bmad/` como fonte de templates, módulos e configuração do método.
- Use `docs/_bmad-output/` como fonte oficial do estado atual, artefatos e andamento do projeto.
- `docs/superpowers/` pode conter planos, rascunhos e documentação histórica/de apoio criada em outro fluxo.
- **Não** trate `docs/superpowers/` como autoridade sobre prioridade, status do sprint ou próximo passo, a menos que o usuário peça isso explicitamente.
- Só use `Superpowers` neste repositório quando o usuário solicitar de forma explícita.
- Ao existir conflito entre documentos de `BMad` e `Superpowers`, priorize `BMad` para workflow e acompanhamento do projeto, preservando os arquivos de `Superpowers` como referência.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
