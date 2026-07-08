"""add lead identity resolution

Revision ID: c2d3e4f5g6h7
Revises: b1c2d3e4f5g6, v4w5x6y7z8a9
Create Date: 2026-07-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "c2d3e4f5g6h7"
down_revision = ("b1c2d3e4f5g6", "v4w5x6y7z8a9")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lead_identities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("display_name", sa.String(512), nullable=True),
        sa.Column("company", sa.String(512), nullable=True),
        sa.Column("email_hash", sa.String(64), nullable=True),
        sa.Column("phone_hash", sa.String(64), nullable=True),
        sa.Column("normalized_name", sa.String(512), nullable=True),
        sa.Column("normalized_company", sa.String(512), nullable=True),
        sa.Column("resolution_status", sa.String(30), nullable=False, server_default="resolved"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("match_reasons", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_lead_identities_email_hash", "lead_identities", ["email_hash"])
    op.create_index("ix_lead_identities_phone_hash", "lead_identities", ["phone_hash"])
    op.create_index("ix_lead_identities_normalized_name", "lead_identities", ["normalized_name"])
    op.create_index("ix_lead_identities_normalized_company", "lead_identities", ["normalized_company"])

    op.add_column("leads", sa.Column("lead_identity_id", UUID(as_uuid=True), nullable=True))
    op.add_column("leads", sa.Column("identity_resolution_status", sa.String(30), nullable=False, server_default="unresolved"))
    op.add_column("leads", sa.Column("identity_confidence", sa.Float(), nullable=True))
    op.add_column("leads", sa.Column("identity_match_reasons", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("leads", sa.Column("identity_review_required", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("leads", sa.Column("identity_candidates", sa.JSON(), nullable=False, server_default="[]"))
    op.create_foreign_key(
        "fk_leads_lead_identity_id",
        "leads",
        "lead_identities",
        ["lead_identity_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_leads_lead_identity_id", "leads", ["lead_identity_id"])
    op.create_index("ix_leads_identity_resolution_status", "leads", ["identity_resolution_status"])

    op.drop_index("ix_leads_email_hash", table_name="leads")
    op.drop_index("ix_leads_phone_hash", table_name="leads")
    op.create_index("ix_leads_email_hash", "leads", ["email_hash"])
    op.create_index("ix_leads_phone_hash", "leads", ["phone_hash"])


def downgrade() -> None:
    op.drop_index("ix_leads_phone_hash", table_name="leads")
    op.drop_index("ix_leads_email_hash", table_name="leads")
    op.create_index(
        "ix_leads_email_hash",
        "leads",
        ["email_hash"],
        unique=True,
        postgresql_where=sa.text("email_hash IS NOT NULL"),
    )
    op.create_index(
        "ix_leads_phone_hash",
        "leads",
        ["phone_hash"],
        unique=True,
        postgresql_where=sa.text("phone_hash IS NOT NULL"),
    )
    op.drop_index("ix_leads_identity_resolution_status", table_name="leads")
    op.drop_index("ix_leads_lead_identity_id", table_name="leads")
    op.drop_constraint("fk_leads_lead_identity_id", "leads", type_="foreignkey")
    op.drop_column("leads", "identity_candidates")
    op.drop_column("leads", "identity_review_required")
    op.drop_column("leads", "identity_match_reasons")
    op.drop_column("leads", "identity_confidence")
    op.drop_column("leads", "identity_resolution_status")
    op.drop_column("leads", "lead_identity_id")

    op.drop_index("ix_lead_identities_normalized_company", table_name="lead_identities")
    op.drop_index("ix_lead_identities_normalized_name", table_name="lead_identities")
    op.drop_index("ix_lead_identities_phone_hash", table_name="lead_identities")
    op.drop_index("ix_lead_identities_email_hash", table_name="lead_identities")
    op.drop_table("lead_identities")
