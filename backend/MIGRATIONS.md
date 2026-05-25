# Migration Runbook

This document describes how to validate and apply Alembic migrations on Supabase staging and production.

## Migration Chain

| # | Revision | Description |
|---|----------|-------------|
| 1  | `de45c95bc364` | Initial schema |
| 2  | `bf57d943ecd0` | RBAC + missing columns |
| 3  | `c9f2e1d3a8b5` | API credentials to settings |
| 4  | `d7e3f9a1b2c4` | is_approved to users |
| 5  | `e8f4a2c6d9b1` | Message sequencing |
| 6  | `f1a2b3c4d5e6` | Extend conversation_tag enum |
| 7  | `g2b3c4d5e6f7` | delivery_status on messages |
| 8  | `h3c4d5e6f7a8` | first_response_at on conversations |
| 9  | `i4d5e6f7a8b9` | Encrypt existing credentials (data migration) |
| 10 | `j5e6f7a8b9c0` | Telegram bot token |
| 11 | `k6f7g8h9i0j1` | Projects foundation |
| 12 | `l7h8i9j0k1l2` | Project context links |
| 13 | `m8i9j0k1l2m3` | Project tasks |
| 14 | `n9j0k1l2m3n4` | Project task automation |
| 15 | `o1p2q3r4s5t6` | Catalog items |
| 16 | `p2q3r4s5t6u7` | Proposals |
| 17 | `q3r4s5t6u7v8` | Catalog categories + audit fields |
| 18 | `r4s5t6u7v8w9` | Clients + proposal commercial fields |
| 19 | `x1y2z3a4b5c6` | client_id to contacts |
| 20 | `y2z3a4b5c6d7` | Make client email optional |
| 21 | `z3a4b5c6d7e8` | Remove email/phone from clients |
| 22 | `a1b2c3d4e5f6` | **AI Engine Sprint 1 — leads table** (email_hash, phone_hash, HMAC lookup indexes) |

## Prerequisites

- Python venv activated (`source venv/bin/activate` or `venv\Scripts\activate`)
- `DATABASE_URL` set to the target Supabase connection string (use the pooler URL)
- `DATABASE_ENCRYPTION_KEY` set if migration 9 should encrypt existing values

## Step-by-Step: Apply to Staging

### 1. Run the chain integrity check (no DB needed)

```bash
python scripts/validate_migrations.py
```

Expected output: `PASS Chain is valid - 22 migrations, linear, no gaps`

### 2. Check current migration state on staging

```bash
export DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
alembic current
```

- If output shows `(head)` — DB is already up to date, skip to Verify Schema.
- If output is empty or shows an older revision — proceed to step 3.
- If `alembic current` fails with connection error — check `DATABASE_URL` and Supabase network settings.

### 3. Run upgrade

```bash
alembic upgrade head
```

Expected output ends with the revision ID of migration 9 (`i4d5e6f7a8b9`).

For migration 9 to encrypt existing credentials, ensure `DATABASE_ENCRYPTION_KEY` is set:
```bash
export DATABASE_ENCRYPTION_KEY="<64-char hex key>"
alembic upgrade head
```

### 4. Verify the schema

After `upgrade head` completes, run these SQL queries in the Supabase SQL editor to confirm the schema:

```sql
-- Tables that must exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- Expected: ai_suggestions, audit_logs, contacts, conversations,
--           general_settings, messages, quick_replies, user_types, users

-- Columns added by migrations 2-9 (spot check)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'users' AND column_name IN ('is_active', 'is_approved');

SELECT column_name FROM information_schema.columns
WHERE table_name = 'messages'
AND column_name IN ('conversation_sequence', 'idempotency_key', 'delivery_status',
                    'delivery_error', 'retry_count', 'last_retry_at');

SELECT column_name FROM information_schema.columns
WHERE table_name = 'conversations'
AND column_name IN ('assigned_user_id', 'first_response_at');

-- Enum types
SELECT typname FROM pg_type
WHERE typname IN ('channeltype', 'conversationstatus', 'conversationtag',
                  'messagetype', 'defaultrole', 'deliverystatus');

-- Migration 6: conversation_tag enum values
SELECT enumlabel FROM pg_enum
JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
WHERE pg_type.typname = 'conversationtag'
ORDER BY enumlabel;
-- Expected values: BILLING, FEEDBACK, GENERAL, SALES, SPAM, SUPPORT
```

### 5. Verify alembic_version table

```sql
SELECT version_num FROM alembic_version;
-- Must return: a1b2c3d4e5f6
```

### Verify leads table (migration 22)

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'leads'
ORDER BY ordinal_position;
-- Expected: id, conversation_id, name, email, phone, company,
--           email_hash, phone_hash, source_channel,
--           extraction_confidence, extraction_error, duplicate_risk,
--           status, created_at, updated_at

SELECT indexname FROM pg_indexes WHERE tablename = 'leads';
-- Expected indexes: ix_leads_conversation_id, ix_leads_created_at,
--                   ix_leads_status, ix_leads_source_channel,
--                   ix_leads_email_hash (unique partial), ix_leads_phone_hash (unique partial)
```

### 6. Validate with the script (full mode)

```bash
python scripts/validate_migrations.py --run-upgrade
```

This re-runs upgrade against the same DB (idempotent — Alembic skips already-applied migrations) and confirms the revision matches head.

---

## Rollback Procedure

**Before rolling back:** Identify which migration introduced the problem.

### Roll back the last migration

```bash
alembic downgrade -1
```

### Roll back to a specific revision

```bash
alembic downgrade bf57d943ecd0
```

### Known downgrade limitations

| Migration | Downgrade behaviour |
|-----------|-------------------|
| `f1a2b3c4d5e6` | No-op — PostgreSQL cannot remove enum values. The extra enum values (`billing`, `feedback`, `spam`) remain but are unused. |
| `g2b3c4d5e6f7` | Drops delivery_status column and index. The `deliverystatus` enum type is NOT dropped (safe). |
| `i4d5e6f7a8b9` | No-op — credentials remain encrypted for security. Plaintext is not restored on downgrade. |

---

## Notes on Migration 9 (Credential Encryption)

Migration 9 is a **data migration** — it does not change column types (they remain `TEXT`). It encrypts any existing plaintext values in `general_settings` for the fields: `whatsapp_access_token`, `whatsapp_webhook_token`, `email_password`, `twilio_auth_token`.

- If `DATABASE_ENCRYPTION_KEY` is **not set** when the migration runs, it skips with a warning. The migration can be re-run safely (it is idempotent — already-encrypted values are skipped).
- To re-encrypt after setting the key: `alembic downgrade -1 && alembic upgrade head` (downgrade is a no-op, upgrade will re-run the data migration).
- Or: set the key and run `alembic upgrade head` — Alembic will skip already-applied DDL migrations but the data migration logic runs on upgrade only.

> Note: If the migration was already applied (shows in `alembic_version`) and you later set `DATABASE_ENCRYPTION_KEY`, you cannot re-trigger it via `upgrade head`. In that case, run a manual UPDATE query or re-apply via `downgrade -1 && upgrade head`.

---

## Generating a DATABASE_ENCRYPTION_KEY

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Output is a 64-character hex string (32 bytes = AES-256).

---

## Quick Reference

```bash
# Check current DB state
alembic current

# Apply all pending migrations
alembic upgrade head

# Show pending migrations (not yet applied)
alembic upgrade head --sql | head -50

# Rollback 1 migration
alembic downgrade -1

# Show migration history
alembic history --verbose

# Chain integrity check (no DB)
python scripts/validate_migrations.py

# Full validation with DB
DATABASE_URL=... python scripts/validate_migrations.py --run-upgrade --test-downgrade
```
