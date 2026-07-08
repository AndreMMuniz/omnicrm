from pathlib import Path


def test_lead_identity_migration_groups_legacy_leads_by_identifier_anchors():
    repo_root = Path(__file__).resolve().parents[2]
    migration = (repo_root / "backend/alembic/versions/c2d3e4f5g6h7_add_lead_identity_resolution.py").read_text()

    assert "SELECT e.id" in migration
    assert "e.email_hash = l.email_hash" in migration
    assert "SELECT p.id" in migration
    assert "p.phone_hash = l.phone_hash" in migration
    assert "SELECT DISTINCT ON (b.lead_identity_id)" in migration


def test_lead_identity_migration_marks_identifierless_legacy_leads_for_review():
    repo_root = Path(__file__).resolve().parents[2]
    migration = (repo_root / "backend/alembic/versions/c2d3e4f5g6h7_add_lead_identity_resolution.py").read_text()

    assert "ELSE 'needs_review'" in migration
    assert '"missing_identifier"' in migration
    assert "ELSE true" in migration
