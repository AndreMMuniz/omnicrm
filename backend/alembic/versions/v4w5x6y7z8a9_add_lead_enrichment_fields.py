"""add lead enrichment fields

Revision ID: v4w5x6y7z8a9
Revises: u3v4w5x6y7z8, a1b2c3d4e5f6
Create Date: 2026-07-08
"""

from alembic import op
import sqlalchemy as sa


revision = "v4w5x6y7z8a9"
down_revision = ("u3v4w5x6y7z8", "a1b2c3d4e5f6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("leads", sa.Column("role", sa.String(255), nullable=True))
    op.add_column("leads", sa.Column("pain_points", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("leads", sa.Column("qualification_notes", sa.Text(), nullable=True))
    op.add_column("leads", sa.Column("source_facts", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("leads", sa.Column("ai_inferences", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("leads", sa.Column("enrichment_status", sa.String(20), nullable=False, server_default="pending"))
    op.add_column("leads", sa.Column("enrichment_error", sa.Text(), nullable=True))
    op.add_column("leads", sa.Column("enriched_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("leads", "enriched_at")
    op.drop_column("leads", "enrichment_error")
    op.drop_column("leads", "enrichment_status")
    op.drop_column("leads", "ai_inferences")
    op.drop_column("leads", "source_facts")
    op.drop_column("leads", "qualification_notes")
    op.drop_column("leads", "pain_points")
    op.drop_column("leads", "role")
