"""add internal notes to messages

Revision ID: c7d8e9f0a1b2
Revises: a1b2c3d4e5f6, b5c6d7e8f9a
Create Date: 2026-05-25 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, Sequence[str], None] = ("a1b2c3d4e5f6", "b5c6d7e8f9a")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("is_internal", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("messages", "is_internal", server_default=None)


def downgrade() -> None:
    op.drop_column("messages", "is_internal")
