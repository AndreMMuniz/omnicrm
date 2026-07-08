"""add lead scoring

Revision ID: b1c2d3e4f5g6
Revises: v4w5x6y7z8a9
Create Date: 2026-07-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "b1c2d3e4f5g6"
down_revision = "v4w5x6y7z8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("leads", sa.Column("score", sa.Integer(), nullable=True))
    op.add_column("leads", sa.Column("qualification_label", sa.String(50), nullable=True))
    op.add_column("leads", sa.Column("score_confidence", sa.Float(), nullable=True))
    op.add_column("leads", sa.Column("score_breakdown", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("leads", sa.Column("score_rationale", sa.Text(), nullable=True))
    op.add_column("leads", sa.Column("scoring_version", sa.String(100), nullable=True))
    op.add_column("leads", sa.Column("scored_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_leads_score", "leads", ["score"])
    op.create_index("ix_leads_qualification_label", "leads", ["qualification_label"])

    op.create_table(
        "lead_scoring_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("version", sa.String(100), nullable=False, unique=True),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_lead_scoring_configs_is_active", "lead_scoring_configs", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_lead_scoring_configs_is_active", table_name="lead_scoring_configs")
    op.drop_table("lead_scoring_configs")
    op.drop_index("ix_leads_qualification_label", table_name="leads")
    op.drop_index("ix_leads_score", table_name="leads")
    op.drop_column("leads", "scored_at")
    op.drop_column("leads", "scoring_version")
    op.drop_column("leads", "score_rationale")
    op.drop_column("leads", "score_breakdown")
    op.drop_column("leads", "score_confidence")
    op.drop_column("leads", "qualification_label")
    op.drop_column("leads", "score")
