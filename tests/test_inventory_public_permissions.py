from __future__ import annotations

import unittest

from app.api import inventory
from app.core.auth import get_current_user, require_non_public


def _route_dependency_calls(path: str, method: str) -> set[object]:
    method = method.upper()
    for route in inventory.router.routes:
        route_methods = getattr(route, "methods", set())
        if getattr(route, "path", "") == path and method in route_methods:
            return {dependency.call for dependency in route.dependant.dependencies}
    raise AssertionError(f"Route not found: {method} {path}")


class InventoryPublicPermissionTests(unittest.TestCase):
    def test_public_cannot_add_or_import_inventory(self) -> None:
        protected_routes = [
            ("POST", "/inventory/manual-add"),
            ("GET", "/inventory/import/template"),
            ("POST", "/inventory/import/preview"),
            ("POST", "/inventory/import/confirm"),
        ]

        for method, path in protected_routes:
            with self.subTest(method=method, path=path):
                self.assertIn(require_non_public, _route_dependency_calls(path, method))

    def test_public_cannot_delete_inventory_but_can_reach_edit_route(self) -> None:
        self.assertIn(
            require_non_public,
            _route_dependency_calls("/inventory/{inventory_id}", "DELETE"),
        )

        edit_dependencies = _route_dependency_calls("/inventory/{inventory_id}", "PUT")
        self.assertIn(get_current_user, edit_dependencies)
        self.assertNotIn(require_non_public, edit_dependencies)


if __name__ == "__main__":
    unittest.main()
