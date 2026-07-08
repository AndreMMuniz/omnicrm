"""add conversation follow-up fields

Revision ID: u3v4w5x6y7z8
Revises: t2u3v4w5x6y7
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa


revision = "u3v4w5x6y7z8"
down_revision = "t2u3v4w5x6y7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("needs_follow_up", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("conversations", sa.Column("follow_up_note", sa.Text(), nullable=True))
    op.add_column("conversations", sa.Column("follow_up_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_conversations_needs_follow_up"), "conversations", ["needs_follow_up"], unique=False)
    op.alter_column("conversations", "needs_follow_up", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_conversations_needs_follow_up"), table_name="conversations")
    op.drop_column("conversations", "follow_up_at")
    op.drop_column("conversations", "follow_up_note")
    op.drop_column("conversations", "needs_follow_up")
