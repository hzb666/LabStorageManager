"""Check backend/frontend order status enum drift.

Usage:
    python scripts/check_order_status_enums.py
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONSTANTS_TS = ROOT / "frontend" / "src" / "lib" / "constants.ts"
CLIENT_TS = ROOT / "frontend" / "src" / "api" / "client.ts"


class CheckError(RuntimeError):
    """Raised when a configured source cannot be parsed."""


@dataclass(frozen=True)
class LabelMapSpec:
    path: Path
    name: str


@dataclass(frozen=True)
class EnumCheckSpec:
    name: str
    backend_path: Path
    backend_class: str
    frontend_path: Path
    frontend_enum: str
    label_maps: tuple[LabelMapSpec, ...]


CHECK_SPECS = (
    EnumCheckSpec(
        name="reagent order status",
        backend_path=ROOT / "app" / "models" / "reagent_order.py",
        backend_class="ReagentOrderStatus",
        frontend_path=CLIENT_TS,
        frontend_enum="ReagentOrderStatus",
        label_maps=(
            LabelMapSpec(CONSTANTS_TS, "REAGENT_STATUS_MAP"),
            LabelMapSpec(CONSTANTS_TS, "STATUS_LABELS"),
        ),
    ),
    EnumCheckSpec(
        name="consumable order status",
        backend_path=ROOT / "app" / "models" / "consumable_order.py",
        backend_class="ConsumableOrderStatus",
        frontend_path=CLIENT_TS,
        frontend_enum="ConsumableOrderStatus",
        label_maps=(
            LabelMapSpec(CONSTANTS_TS, "CONSUMABLE_STATUS_MAP"),
            LabelMapSpec(CONSTANTS_TS, "STATUS_LABELS"),
        ),
    ),
)


def read_text(path: Path) -> str:
    if not path.exists():
        raise CheckError(f"File not found: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def extract_python_enum_values(path: Path, class_name: str) -> list[str]:
    tree = ast.parse(read_text(path), filename=str(path))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            return [
                stmt.value.value
                for stmt in node.body
                if isinstance(stmt, ast.Assign)
                and isinstance(stmt.value, ast.Constant)
                and isinstance(stmt.value.value, str)
            ]
    raise CheckError(f"Python enum not found: {class_name} in {path.relative_to(ROOT)}")


def extract_ts_enum_values(path: Path, enum_name: str) -> list[str]:
    text = read_text(path)
    enum_pattern = re.compile(
        rf"export\s+enum\s+{re.escape(enum_name)}\s*\{{(?P<body>.*?)\}}",
        re.DOTALL,
    )
    enum_match = enum_pattern.search(text)
    if enum_match is None:
        raise CheckError(f"TypeScript enum not found: {enum_name} in {path.relative_to(ROOT)}")

    member_pattern = re.compile(
        r"\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*(['\"])(?P<value>.*?)\1"
    )
    return [match.group("value") for match in member_pattern.finditer(enum_match.group("body"))]


def extract_ts_object_keys(path: Path, object_name: str) -> list[str]:
    text = read_text(path)
    object_pattern = re.compile(
        rf"export\s+const\s+{re.escape(object_name)}(?:\s*:[^=]+)?\s*=\s*"
        r"\{(?P<body>.*?)\n\}",
        re.DOTALL,
    )
    object_match = object_pattern.search(text)
    if object_match is None:
        raise CheckError(f"TypeScript object not found: {object_name} in {path.relative_to(ROOT)}")

    key_pattern = re.compile(
        r"(?m)^\s*(?P<key>[A-Za-z_][A-Za-z0-9_]*|['\"][^'\"]+['\"])\s*:"
    )
    keys: list[str] = []
    for match in key_pattern.finditer(object_match.group("body")):
        key = match.group("key").strip("'\"")
        keys.append(key)
    return keys


def missing_values(expected: list[str], actual: list[str]) -> list[str]:
    actual_set = set(actual)
    return [value for value in expected if value not in actual_set]


def extra_values(expected: list[str], actual: list[str]) -> list[str]:
    expected_set = set(expected)
    return [value for value in actual if value not in expected_set]


def format_values(values: list[str]) -> str:
    return ", ".join(values) if values else "(none)"


def run_check(spec: EnumCheckSpec, verbose: bool) -> bool:
    backend_values = extract_python_enum_values(spec.backend_path, spec.backend_class)
    frontend_values = extract_ts_enum_values(spec.frontend_path, spec.frontend_enum)

    print(f"[X2] {spec.name}")
    print(f"  backend : {format_values(backend_values)}")
    print(f"  frontend: {format_values(frontend_values)}")

    failed = False
    frontend_missing = missing_values(backend_values, frontend_values)
    frontend_extra = extra_values(backend_values, frontend_values)

    if frontend_missing:
        failed = True
        print(f"  FAIL missing in frontend enum: {format_values(frontend_missing)}")
    if frontend_extra:
        failed = True
        print(f"  FAIL extra in frontend enum: {format_values(frontend_extra)}")
    if not failed and backend_values != frontend_values:
        print("  WARN same values, but enum order differs")

    for label_map in spec.label_maps:
        keys = extract_ts_object_keys(label_map.path, label_map.name)
        missing_labels = missing_values(backend_values, keys)
        if missing_labels:
            failed = True
            print(
                f"  FAIL missing in {label_map.name}: {format_values(missing_labels)}"
            )
        elif verbose:
            print(f"  labels ok: {label_map.name}")

    if not failed:
        print("  OK")
    return not failed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check backend/frontend order status enum consistency."
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print label map coverage details.",
    )
    args = parser.parse_args()

    try:
        results = [run_check(spec, args.verbose) for spec in CHECK_SPECS]
    except CheckError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if all(results):
        print("[X2] order status enum check passed")
        return 0

    print("[X2] order status enum check failed", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
