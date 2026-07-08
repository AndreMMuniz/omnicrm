"""add outreach campaigns

Revision ID: d3e4f5g6h7i8
Revises: c2d3e4f5g6h7
Create Date: 2026-07-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "d3e4f5g6h7i8"
down_revision = "c2d3e4f5g6h7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "outreach_campaigns",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column("channel", sa.String(50), nullable=False),
        sa.Column("cadence", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(30), nullable=False, server_default="active"),
        sa.Column("owner_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source_type", sa.String(30), nullable=False, server_default="lead_selection"),
        sa.Column("source_filter", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_outreach_campaigns_channel", "outreach_campaigns", ["channel"])
    op.create_index("ix_outreach_campaigns_status", "outreach_campaigns", ["status"])
    op.create_index("ix_outreach_campaigns_owner_user_id", "outreach_campaigns", ["owner_user_id"])
    op.create_index("ix_outreach_campaigns_created_by_user_id", "outreach_campaigns", ["created_by_user_id"])

    op.create_table(
        "outreach_campaign_leads",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("campaign_id", UUID(as_uuid=True), sa.ForeignKey("outreach_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lead_id", UUID(as_uuid=True), sa.ForeignKey("leads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lead_identity_id", UUID(as_uuid=True), sa.ForeignKey("lead_identities.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="active"),
        sa.Column("skip_reason", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_outreach_campaign_leads_campaign_id", "outreach_campaign_leads", ["campaign_id"])
    op.create_index("ix_outreach_campaign_leads_lead_id", "outreach_campaign_leads", ["lead_id"])
    op.create_index("ix_outreach_campaign_leads_lead_identity_id", "outreach_campaign_leads", ["lead_identity_id"])
    op.create_index("ix_outreach_campaign_leads_status", "outreach_campaign_leads", ["status"])
    op.create_index(
        "ix_outreach_campaign_leads_active_lookup",
        "outreach_campaign_leads",
        ["lead_id", "status"],
    )
    op.create_index(
        "uq_outreach_campaign_leads_active_lead",
        "outreach_campaign_leads",
        ["lead_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_index("uq_outreach_campaign_leads_active_lead", table_name="outreach_campaign_leads")
    op.drop_index("ix_outreach_campaign_leads_active_lookup", table_name="outreach_campaign_leads")
    op.drop_index("ix_outreach_campaign_leads_status", table_name="outreach_campaign_leads")
    op.drop_index("ix_outreach_campaign_leads_lead_identity_id", table_name="outreach_campaign_leads")
    op.drop_index("ix_outreach_campaign_leads_lead_id", table_name="outreach_campaign_leads")
    op.drop_index("ix_outreach_campaign_leads_campaign_id", table_name="outreach_campaign_leads")
    op.drop_table("outreach_campaign_leads")

    op.drop_index("ix_outreach_campaigns_created_by_user_id", table_name="outreach_campaigns")
    op.drop_index("ix_outreach_campaigns_owner_user_id", table_name="outreach_campaigns")
    op.drop_index("ix_outreach_campaigns_status", table_name="outreach_campaigns")
    op.drop_index("ix_outreach_campaigns_channel", table_name="outreach_campaigns")
    op.drop_table("outreach_campaigns")
