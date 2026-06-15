import asyncio
import unittest

from fastapi import HTTPException, status
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine
from starlette.requests import Request

import app.models  # noqa: F401
from app.api.common_shelf import delete_common_shelf_group, router as common_shelf_router
from app.core.auth import require_admin
from app.models.chemical_name_map import ChemicalCategory, ChemicalNameMap
from app.models.common_shelf import CommonShelfManualCreate
from app.models.user import User, UserRole
from app.services.common_shelf_creation import (
    create_common_shelf_items_for_group_record,
    create_manual_common_shelf_items,
)
from app.services.common_shelf_group_records import (
    get_active_common_shelf_group,
    mark_common_shelf_group_deleted,
    touch_common_shelf_group,
)
from app.services.common_shelf_queries import (
    CommonShelfGroupFields,
    CommonShelfGroupListOptions,
    get_group_items,
    list_grouped_common_shelf,
)
from app.services.search_matchers import TextMatchMode


class CommonShelfZeroGroupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.user = User(
            username="common_shelf_tester",
            full_name="Tester",
            role=UserRole.ADMIN,
            password_hash="hashed",
        )
        self.normal_user = User(
            username="common_shelf_regular",
            full_name="Regular Tester",
            role=UserRole.USER,
            password_hash="hashed",
        )
        self.session.add(self.user)
        self.session.add(self.normal_user)
        self.session.add(
            ChemicalNameMap(
                cas_number="64-17-5",
                name="乙醇",
                english_name="Ethanol",
                category=ChemicalCategory.SOLVENT,
            )
        )
        self.session.commit()
        self.session.refresh(self.user)
        self.session.refresh(self.normal_user)

    def tearDown(self) -> None:
        self.session.close()
        SQLModel.metadata.drop_all(self.engine)

    def _list_groups(self):
        return list_grouped_common_shelf(
            self.session,
            options=CommonShelfGroupListOptions(
                search=None,
                search_field=None,
                fuzzy=False,
                match_mode=TextMatchMode.CONTAINS,
                skip=0,
                limit=20,
                sort_by=None,
                sort_order=None,
            ),
        )

    def _request(self) -> Request:
        return Request(
            {
                "type": "http",
                "method": "DELETE",
                "path": "/api/common-shelf/groups/test",
                "headers": [],
            }
        )

    def test_delete_group_route_does_not_require_admin_dependency(self) -> None:
        route = next(
            route
            for route in common_shelf_router.routes
            if getattr(route, "path", None) == "/common-shelf/groups/{group_key}"
            and "DELETE" in getattr(route, "methods", set())
        )
        dependency_calls = [dependency.call for dependency in route.dependant.dependencies]
        self.assertNotIn(require_admin, dependency_calls)

    def test_regular_user_can_delete_only_zero_count_group(self) -> None:
        assert self.user.id is not None
        assert self.normal_user.id is not None
        create_manual_common_shelf_items(
            self.session,
            CommonShelfManualCreate(
                cas_number="64-17-5",
                name_snapshot="乙醇",
                brand="BrandA",
                purity="95%",
                specification="500mL",
                count=1,
                storage_location="A-1",
                notes=None,
            ),
            created_by_id=self.user.id,
        )
        self.session.commit()

        group_response = self._list_groups().data[0]
        group_key = group_response.group.group_key
        group_fields = CommonShelfGroupFields(
            cas_number=group_response.group.cas_number,
            brand_normalized=group_response.group.brand_normalized,
            specification_normalized=group_response.group.specification_normalized,
        )

        with self.assertRaises(HTTPException) as exc_info:
            asyncio.run(
                delete_common_shelf_group(
                    group_key,
                    self._request(),
                    self.normal_user,
                    self.session,
                )
            )
        self.assertEqual(status.HTTP_409_CONFLICT, exc_info.exception.status_code)
        self.assertEqual(1, self._list_groups().data[0].bottle_count)

        for item in get_group_items(self.session, group_fields=group_fields):
            self.session.delete(item)
        self.session.flush()
        touch_common_shelf_group(
            self.session,
            cas_number=group_fields.cas_number,
            brand_normalized=group_fields.brand_normalized,
            specification_normalized=group_fields.specification_normalized,
        )
        self.session.commit()

        response = asyncio.run(
            delete_common_shelf_group(
                group_key,
                self._request(),
                self.normal_user,
                self.session,
            )
        )
        self.assertEqual(0, response["deleted_count"])
        self.assertEqual([], response["deleted_ids"])
        self.assertEqual(0, self._list_groups().total)

    def test_group_survives_zero_count_and_item_fields_stay_per_bottle(self) -> None:
        assert self.user.id is not None
        create_manual_common_shelf_items(
            self.session,
            CommonShelfManualCreate(
                cas_number="64-17-5",
                name_snapshot="乙醇",
                brand="BrandA",
                purity="95%",
                specification="500mL",
                count=1,
                storage_location="A-1",
                notes="第一瓶备注",
            ),
            created_by_id=self.user.id,
        )
        create_manual_common_shelf_items(
            self.session,
            CommonShelfManualCreate(
                cas_number="64-17-5",
                name_snapshot="乙醇",
                brand="BrandA",
                purity="HPLC",
                specification="500mL",
                count=1,
                storage_location="A-2",
                notes="第二瓶备注",
            ),
            created_by_id=self.user.id,
        )
        self.session.commit()

        grouped = self._list_groups()
        self.assertEqual(1, grouped.total)
        group_response = grouped.data[0]
        self.assertEqual(2, group_response.bottle_count)
        self.assertNotIn("purity", group_response.display.model_dump())
        self.assertNotIn("notes", group_response.display.model_dump())

        group_fields = CommonShelfGroupFields(
            cas_number=group_response.group.cas_number,
            brand_normalized=group_response.group.brand_normalized,
            specification_normalized=group_response.group.specification_normalized,
        )
        item_rows = get_group_items(self.session, group_fields=group_fields)
        self.assertEqual(["95%", "HPLC"], sorted(item.purity or "" for item in item_rows))
        self.assertEqual(["第一瓶备注", "第二瓶备注"], sorted(item.notes or "" for item in item_rows))

        for item in item_rows:
            self.session.delete(item)
        self.session.flush()
        touch_common_shelf_group(
            self.session,
            cas_number=group_fields.cas_number,
            brand_normalized=group_fields.brand_normalized,
            specification_normalized=group_fields.specification_normalized,
        )
        self.session.commit()

        zero_grouped = self._list_groups()
        self.assertEqual(1, zero_grouped.total)
        self.assertEqual(0, zero_grouped.data[0].bottle_count)

        active_group = get_active_common_shelf_group(
            self.session,
            cas_number=group_fields.cas_number,
            brand_normalized=group_fields.brand_normalized,
            specification_normalized=group_fields.specification_normalized,
        )
        self.assertIsNotNone(active_group)
        assert active_group is not None
        new_items = create_common_shelf_items_for_group_record(
            self.session,
            active_group,
            count=1,
            storage_location="A-3",
            purity=None,
            notes=None,
            created_by_id=self.user.id,
        )
        self.session.commit()
        self.assertIsNone(new_items[0].purity)
        self.assertIsNone(new_items[0].notes)

        for item in get_group_items(self.session, group_fields=group_fields):
            self.session.delete(item)
        mark_common_shelf_group_deleted(self.session, active_group)
        self.session.commit()

        deleted_grouped = self._list_groups()
        self.assertEqual(0, deleted_grouped.total)


if __name__ == "__main__":
    unittest.main()
