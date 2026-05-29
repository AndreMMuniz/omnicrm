"""add local password hash to users

Revision ID: s1t2u3v4w5x6
Revises: z3a4b5c6d7e8
Create Date: 2026-05-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "s1t2u3v4w5x6"
down_revision: Union[str, Sequence[str], None] = "d8e9f0a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("local_password_hash", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "local_password_hash")
