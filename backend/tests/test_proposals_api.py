from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.api import api_router
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.models import CatalogItem, CatalogItemStatus, CatalogItemType, DefaultRole, User, UserType


def _seed_user(db):
    user_type = UserType(name="Proposal Admin", base_role=DefaultRole.ADMIN, is_system=False)
    db.add(user_type)
    db.flush()

    user = User(
        auth_id="auth-proposal-api",
        email="proposal-api@example.com",
        full_name="Proposal API User",
        user_type_id=user_type.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_client(db, current_user):
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")

    def override_get_db():
        try:
            yield db
        finally:
            pass

    async def override_current_user():
        return current_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_current_user
    return TestClient(app, raise_server_exceptions=True)


def _seed_quotable_catalog_item(db, user):
    item = CatalogItem(
        name="WhatsApp Automation Setup",
        commercial_name="WhatsApp Automation Setup",
        type=CatalogItemType.SERVICE,
        status=CatalogItemStatus.ACTIVE,
        category="Implementation",
        sku="SRV-WA-001",
        commercial_description="Setup and configure the first automation workflow.",
        base_price=4200,
        unit="Fixed fee",
        sla_or_delivery_time="5 business days",
        active_for_support=True,
        can_be_quoted=True,
        allows_discount=True,
        tags=["onboarding", "whatsapp"],
        created_by_user_id=user.id,
        updated_by_user_id=user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_create_draft_proposal_from_catalog_item(db):
    user = _seed_user(db)
    catalog_item = _seed_quotable_catalog_item(db, user)
    client = _make_client(db, user)

    response = client.post(
        f"/api/v1/admin/proposals/from-catalog/{catalog_item.id}",
        json={"customer_name": "Acme Corp", "quantity": 2},
    )
    assert response.status_code == 200
    proposal = response.json()["data"]
    assert proposal["reference"].startswith("PRP-")
    assert proposal["status"] == "draft"
    assert proposal["customer_name"] == "Acme Corp"
    assert proposal["items_count"] == 1
    assert proposal["total_amount"] == 8400
    assert proposal["items"][0]["commercial_name_snapshot"] == "WhatsApp Automation Setup"
    assert proposal["items"][0]["quantity"] == 2


def test_add_second_catalog_item_to_existing_proposal(db):
    user = _seed_user(db)
    first_item = _seed_quotable_catalog_item(db, user)
    second_item = CatalogItem(
        name="Premium SLA Monitoring",
        commercial_name="Premium SLA Monitoring",
        type=CatalogItemType.PRODUCT,
        status=CatalogItemStatus.ACTIVE,
        category="Operations",
        sku="PRD-SLA-003",
        commercial_description="Real-time SLA tracking with alerts.",
        base_price=1490,
        unit="Monthly",
        active_for_support=True,
        can_be_quoted=True,
        allows_discount=False,
        tags=["sla"],
        created_by_user_id=user.id,
        updated_by_user_id=user.id,
    )
    db.add(second_item)
    db.commit()
    db.refresh(second_item)

    client = _make_client(db, user)
    proposal_response = client.post(f"/api/v1/admin/proposals/from-catalog/{first_item.id}", json={})
    proposal_id = proposal_response.json()["data"]["id"]

    add_response = client.post(
        f"/api/v1/admin/proposals/{proposal_id}/items/from-catalog/{second_item.id}",
        json={"quantity": 3},
    )
    assert add_response.status_code == 200
    proposal = add_response.json()["data"]
    assert proposal["items_count"] == 2
    assert proposal["subtotal_amount"] == 8670
    assert proposal["total_amount"] == 8670
    assert proposal["items"][1]["position"] == 2


def test_list_and_get_proposals(db):
    user = _seed_user(db)
    catalog_item = _seed_quotable_catalog_item(db, user)
    client = _make_client(db, user)
    create_response = client.post(
        f"/api/v1/admin/proposals/from-catalog/{catalog_item.id}",
        json={"title": "Renewal Proposal"},
    )
    proposal_id = create_response.json()["data"]["id"]

    list_response = client.get("/api/v1/admin/proposals", params={"search": "Renewal"})
    assert list_response.status_code == 200
    assert len(list_response.json()["data"]) == 1
    assert list_response.json()["data"][0]["title"] == "Renewal Proposal"

    get_response = client.get(f"/api/v1/admin/proposals/{proposal_id}")
    assert get_response.status_code == 200
    assert get_response.json()["data"]["reference"].startswith("PRP-")
    assert len(get_response.json()["data"]["items"]) == 1


def test_update_proposal_item_recalculates_totals(db):
    user = _seed_user(db)
    catalog_item = _seed_quotable_catalog_item(db, user)
    client = _make_client(db, user)
    create_response = client.post(
        f"/api/v1/admin/proposals/from-catalog/{catalog_item.id}",
        json={"quantity": 1},
    )
    proposal = create_response.json()["data"]
    item_id = proposal["items"][0]["id"]

    update_response = client.patch(
        f"/api/v1/admin/proposals/{proposal['id']}/items/{item_id}",
        json={"quantity": 3, "discount_amount": 200},
    )
    assert update_response.status_code == 200
    updated = update_response.json()["data"]
    assert updated["subtotal_amount"] == 12600
    assert updated["discount_amount"] == 200
    assert updated["total_amount"] == 12400
    assert updated["items"][0]["quantity"] == 3
    assert updated["items"][0]["discount_amount"] == 200
    assert updated["items"][0]["total_amount"] == 12400


def test_delete_proposal_item_recalculates_totals(db):
    user = _seed_user(db)
    first_item = _seed_quotable_catalog_item(db, user)
    second_item = CatalogItem(
        name="Premium SLA Monitoring",
        commercial_name="Premium SLA Monitoring",
        type=CatalogItemType.PRODUCT,
        status=CatalogItemStatus.ACTIVE,
        category="Operations",
        sku="PRD-SLA-003",
        commercial_description="Real-time SLA tracking with alerts.",
        base_price=1490,
        unit="Monthly",
        active_for_support=True,
        can_be_quoted=True,
        allows_discount=False,
        tags=["sla"],
        created_by_user_id=user.id,
        updated_by_user_id=user.id,
    )
    db.add(second_item)
    db.commit()
    db.refresh(second_item)

    client = _make_client(db, user)
    proposal_response = client.post(f"/api/v1/admin/proposals/from-catalog/{first_item.id}", json={})
    proposal_id = proposal_response.json()["data"]["id"]
    item_one_id = proposal_response.json()["data"]["items"][0]["id"]
    add_response = client.post(
        f"/api/v1/admin/proposals/{proposal_id}/items/from-catalog/{second_item.id}",
        json={"quantity": 2},
    )
    assert add_response.status_code == 200

    delete_response = client.delete(f"/api/v1/admin/proposals/{proposal_id}/items/{item_one_id}")
    assert delete_response.status_code == 200
    updated = delete_response.json()["data"]
    assert updated["items_count"] == 1
    assert updated["subtotal_amount"] == 2980
    assert updated["total_amount"] == 2980
    assert updated["items"][0]["commercial_name_snapshot"] == "Premium SLA Monitoring"


def test_delete_proposal_returns_deleted_flag(db):
    user = _seed_user(db)
    catalog_item = _seed_quotable_catalog_item(db, user)
    client = _make_client(db, user)

    proposal_response = client.post(f"/api/v1/admin/proposals/from-catalog/{catalog_item.id}", json={})
    proposal_id = proposal_response.json()["data"]["id"]

    delete_response = client.delete(f"/api/v1/admin/proposals/{proposal_id}")
    assert delete_response.status_code == 200
    payload = delete_response.json()["data"]
    assert payload["deleted"] is True
    assert payload["proposal_id"] == proposal_id
