from pathlib import Path


def test_lead_identity_migration_backfills_existing_leads_as_identity_anchors():
    repo_root = Path(__file__).resolve().parents[2]
    migration = (repo_root / "backend/alembic/versions/c2d3e4f5g6h7_add_lead_identity_resolution.py").read_text()

    assert "INSERT INTO lead_identities" in migration
    assert "UPDATE leads" in migration
    assert "lead_identity_id" in migration
    assert "identity_resolution_status = 'resolved'" in migration
