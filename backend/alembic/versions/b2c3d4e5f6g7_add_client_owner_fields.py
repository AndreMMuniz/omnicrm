"""add client owner fields

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b2c3d4e5f6g7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "clients",
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index(op.f("ix_clients_owner_user_id"), "clients", ["owner_user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_clients_owner_user_id"), table_name="clients")
    op.drop_column("clients", "owner_user_id")
