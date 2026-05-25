"""add multi tags to conversations

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-05-25 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d8e9f0a1b2c3"
down_revision: Union[str, Sequence[str], None] = "c7d8e9f0a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE conversations
            SET tags = CASE
                WHEN tag IS NULL THEN '[]'::json
                ELSE to_json(ARRAY[tag::text])
            END
            """
        )
    else:
        op.execute(
            """
            UPDATE conversations
            SET tags = CASE
                WHEN tag IS NULL THEN '[]'
                ELSE '["' || lower(tag) || '"]'
            END
            """
        )

    op.alter_column("conversations", "tags", server_default=None)


def downgrade() -> None:
    op.drop_column("conversations", "tags")
