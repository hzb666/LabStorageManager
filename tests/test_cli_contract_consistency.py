import ast
import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CLI_MAIN_PATH = REPO_ROOT / "lsm_cli" / "main.py"
APP_MAIN_PATH = REPO_ROOT / "app" / "main.py"

CLI_METHOD_BY_HELPER = {
    "_handle_list_command": "GET",
    "_handle_get_command": "GET",
    "_handle_post_command": "POST",
    "_handle_put_command": "PUT",
}


def _parse_module(path: Path) -> ast.AST:
    return ast.parse(path.read_text(encoding="utf-8"))


def _extract_formatted_value(node: ast.FormattedValue) -> str:
    expr = node.value
    if isinstance(expr, ast.Attribute):
        return f"{{{expr.attr}}}"
    if isinstance(expr, ast.Name):
        return f"{{{expr.id}}}"
    return "{value}"


def _extract_route_string(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if not isinstance(node, ast.JoinedStr):
        return None

    parts: list[str] = []
    for value in node.values:
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            parts.append(value.value)
        elif isinstance(value, ast.FormattedValue):
            parts.append(_extract_formatted_value(value))
        else:
            return None
    return "".join(parts)


def _route_from_client_request(node: ast.Call) -> tuple[str, str] | None:
    if not (isinstance(node.func, ast.Attribute) and node.func.attr == "request"):
        return None
    if len(node.args) < 2:
        return None
    if not all(isinstance(arg, ast.Constant) and isinstance(arg.value, str) for arg in node.args[:2]):
        return None
    return node.args[0].value, node.args[1].value


def _route_from_helper_call(node: ast.Call) -> tuple[str, str] | None:
    if not (isinstance(node.func, ast.Name) and node.func.id in CLI_METHOD_BY_HELPER):
        return None
    if len(node.args) < 2:
        return None
    path_arg = node.args[1]
    if not (isinstance(path_arg, ast.Constant) and isinstance(path_arg.value, str)):
        return None
    return CLI_METHOD_BY_HELPER[node.func.id], path_arg.value


def _route_from_payload_call(node: ast.Call) -> tuple[str, str] | None:
    if not (isinstance(node.func, ast.Name) and node.func.id == "_request_with_payload"):
        return None

    keyword_values = {keyword.arg: keyword.value for keyword in node.keywords}
    method_node = keyword_values.get("method")
    path_node = keyword_values.get("path")
    if method_node is None or path_node is None:
        return None

    method = _extract_route_string(method_node)
    path = _extract_route_string(path_node)
    if method is None or path is None:
        return None
    return method, path


def _route_from_call(node: ast.Call) -> tuple[str, str] | None:
    return (
        _route_from_client_request(node)
        or _route_from_helper_call(node)
        or _route_from_payload_call(node)
    )


def _extract_cli_routes() -> set[tuple[str, str]]:
    routes: set[tuple[str, str]] = set()
    tree = _parse_module(CLI_MAIN_PATH)

    class RouteVisitor(ast.NodeVisitor):
        def visit_Call(self, node: ast.Call) -> None:
            route = _route_from_call(node)
            if route is not None:
                routes.add(route)
            self.generic_visit(node)

    RouteVisitor().visit(tree)
    return routes


def _extract_allowed_route_patterns() -> set[tuple[str, str]]:
    tree = _parse_module(APP_MAIN_PATH)
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id == "CLI_ALLOWED_ROUTE_PATTERNS":
                return set(ast.literal_eval(node.value))
    raise AssertionError("CLI_ALLOWED_ROUTE_PATTERNS not found in app/main.py")


def _extract_allowed_user_paths() -> set[str]:
    tree = _parse_module(APP_MAIN_PATH)
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "CLI_ALLOWED_USER_PATHS":
                    return set(ast.literal_eval(node.value))
    raise AssertionError("CLI_ALLOWED_USER_PATHS not found in app/main.py")


def _template_to_sample_api_path(path: str) -> str:
    api_path = f"/api{path}"
    api_path = re.sub(r"\{[^{}]*_id\}", "1", api_path)
    api_path = re.sub(r"\{[^{}]+\}", "sample-key", api_path)
    return api_path


def _is_allowed_cli_route(method: str, sample_path: str) -> bool:
    return any(
        method == allowed_method and re.fullmatch(pattern, sample_path)
        for allowed_method, pattern in _extract_allowed_route_patterns()
    )


class CLIContractConsistencyTests(unittest.TestCase):
    def test_cli_routes_are_allowed_by_server_whitelist_patterns(self) -> None:
        cli_routes = _extract_cli_routes()
        disallowed_routes = sorted(
            (method, path)
            for method, path in cli_routes
            if not _is_allowed_cli_route(method, _template_to_sample_api_path(path))
        )

        self.assertEqual([], disallowed_routes)

    def test_cli_auth_routes_match_allowed_user_paths(self) -> None:
        cli_routes = _extract_cli_routes()
        cli_user_paths = {f"/api{path}" for _, path in cli_routes if path.startswith("/users/")}

        self.assertSetEqual(cli_user_paths, _extract_allowed_user_paths())

    def test_cli_whitelist_keeps_sensitive_management_and_upload_routes_closed(self) -> None:
        blocked_samples = [
            ("POST", "/api/users/login"),
            ("GET", "/api/users/"),
            ("POST", "/api/users/"),
            ("PUT", "/api/users/1"),
            ("DELETE", "/api/users/1"),
            ("POST", "/api/inventory/import/preview"),
            ("POST", "/api/inventory/import/confirm"),
            ("DELETE", "/api/inventory/1"),
            ("POST", "/api/announcements/1/images"),
        ]

        for method, sample_path in blocked_samples:
            with self.subTest(method=method, path=sample_path):
                self.assertFalse(_is_allowed_cli_route(method, sample_path))

    def test_cli_whitelist_allows_only_declared_mutation_surface(self) -> None:
        allowed_mutations = [
            ("POST", "/api/users/login/token"),
            ("POST", "/api/users/logout"),
            ("PUT", "/api/inventory/1"),
            ("POST", "/api/inventory/1/borrow"),
            ("POST", "/api/inventory/1/return"),
            ("POST", "/api/inventory/manual-add"),
            ("POST", "/api/reagent-orders/"),
            ("PUT", "/api/reagent-orders/1"),
            ("POST", "/api/reagent-orders/1/confirm-arrival"),
            ("POST", "/api/reagent-orders/1/stock-in"),
            ("POST", "/api/common-shelf/manual-add"),
            ("POST", "/api/common-shelf/groups/bench_a/add-bottles"),
            ("POST", "/api/common-shelf/groups/bench_a/remove-one"),
            ("POST", "/api/consumable-orders/"),
            ("PUT", "/api/consumable-orders/1"),
            ("POST", "/api/consumable-orders/1/complete"),
        ]

        for method, sample_path in allowed_mutations:
            with self.subTest(method=method, path=sample_path):
                self.assertTrue(_is_allowed_cli_route(method, sample_path))


if __name__ == "__main__":
    unittest.main()
