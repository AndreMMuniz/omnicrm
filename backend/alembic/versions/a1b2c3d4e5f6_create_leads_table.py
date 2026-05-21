"""create leads table

Revision ID: a1b2c3d4e5f6
Revises: z3a4b5c6d7e8
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "a1b2c3d4e5f6"
down_revision = "z3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "leads",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("conversation_id", UUID(as_uuid=True),
                  sa.ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name",    sa.String(512), nullable=True),
        # email / phone stored as Text — EncryptedString output is base64 of variable length
        sa.Column("email",   sa.Text, nullable=True),
        sa.Column("phone",   sa.Text, nullable=True),
        sa.Column("company", sa.String(512), nullable=True),
        # HMAC-SHA256 lookup hashes (deterministic, see app/core/hashing.py)
        sa.Column("email_hash", sa.String(64), nullable=True),
        sa.Column("phone_hash", sa.String(64), nullable=True),
        sa.Column("source_channel", sa.String(50), nullable=False),
        sa.Column("extraction_confidence", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("extraction_error", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("duplicate_risk",   sa.Boolean, nullable=False, server_default="false"),
        sa.Column("status", sa.String(20), nullable=False, server_default="new"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )

    op.create_index("ix_leads_conversation_id", "leads", ["conversation_id"])
    op.create_index("ix_leads_created_at",      "leads", ["created_at"])
    op.create_index("ix_leads_status",           "leads", ["status"])
    op.create_index("ix_leads_source_channel",   "leads", ["source_channel"])

    # Partial unique indexes on hash columns — NULL rows don't conflict
    op.create_index(
        "ix_leads_email_hash", "leads", ["email_hash"],
        unique=True,
        postgresql_where=sa.text("email_hash IS NOT NULL"),
    )
    op.create_index(
        "ix_leads_phone_hash", "leads", ["phone_hash"],
        unique=True,
        postgresql_where=sa.text("phone_hash IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_leads_phone_hash",      table_name="leads")
    op.drop_index("ix_leads_email_hash",      table_name="leads")
    op.drop_index("ix_leads_source_channel",  table_name="leads")
    op.drop_index("ix_leads_status",          table_name="leads")
    op.drop_index("ix_leads_created_at",      table_name="leads")
    op.drop_index("ix_leads_conversation_id", table_name="leads")
    op.drop_table("leads")
