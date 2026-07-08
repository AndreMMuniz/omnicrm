"""add outreach sequence steps

Revision ID: e4f5g6h7i8j9
Revises: d3e4f5g6h7i8
Create Date: 2026-07-08 14:45:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "e4f5g6h7i8j9"
down_revision = "d3e4f5g6h7i8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "outreach_sequence_steps",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("campaign_lead_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("step_type", sa.String(length=50), nullable=False),
        sa.Column("channel", sa.String(length=50), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=30), server_default="draft", nullable=False),
        sa.Column("generated_content", sa.Text(), server_default="", nullable=False),
        sa.Column("reviewed_content", sa.Text(), nullable=True),
        sa.Column("generation_metadata", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("skip_reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["outreach_campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["campaign_lead_id"], ["outreach_campaign_leads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"]),
    )
    op.create_index("ix_outreach_sequence_steps_campaign_id", "outreach_sequence_steps", ["campaign_id"])
    op.create_index("ix_outreach_sequence_steps_lead_id", "outreach_sequence_steps", ["lead_id"])
    op.create_index("ix_outreach_sequence_steps_campaign_lead_id", "outreach_sequence_steps", ["campaign_lead_id"])
    op.create_index("ix_outreach_sequence_steps_channel", "outreach_sequence_steps", ["channel"])
    op.create_index("ix_outreach_sequence_steps_status", "outreach_sequence_steps", ["status"])
    op.create_index("ix_outreach_sequence_steps_due_at", "outreach_sequence_steps", ["due_at"])
    op.create_index("ix_outreach_sequence_steps_message_id", "outreach_sequence_steps", ["message_id"])
    op.create_index("ix_outreach_sequence_steps_idempotency_key", "outreach_sequence_steps", ["idempotency_key"], unique=True)
    op.create_index(
        "ix_outreach_sequence_steps_campaign_lead_position",
        "outreach_sequence_steps",
        ["campaign_id", "lead_id", "position"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_outreach_sequence_steps_campaign_lead_position", table_name="outreach_sequence_steps")
    op.drop_index("ix_outreach_sequence_steps_idempotency_key", table_name="outreach_sequence_steps")
    op.drop_index("ix_outreach_sequence_steps_message_id", table_name="outreach_sequence_steps")
    op.drop_index("ix_outreach_sequence_steps_due_at", table_name="outreach_sequence_steps")
    op.drop_index("ix_outreach_sequence_steps_status", table_name="outreach_sequence_steps")
    op.drop_index("ix_outreach_sequence_steps_channel", table_name="outreach_sequence_steps")
    op.drop_index("ix_outreach_sequence_steps_campaign_lead_id", table_name="outreach_sequence_steps")
    op.drop_index("ix_outreach_sequence_steps_lead_id", table_name="outreach_sequence_steps")
    op.drop_index("ix_outreach_sequence_steps_campaign_id", table_name="outreach_sequence_steps")
    op.drop_table("outreach_sequence_steps")
