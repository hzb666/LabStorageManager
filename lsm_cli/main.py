from __future__ import annotations

import argparse
import getpass
import math
import sys
from pathlib import Path
from typing import Any, Callable

from lsm_cli.client import (
    APIClient,
    CLILocalInputError,
    CLINetworkError,
    CLIRequestError,
    get_env_token,
    load_json_payload,
    parse_key_value_pairs,
)
from lsm_cli.config import clear_auth_data, load_config, save_config
from lsm_cli.output import configure_output_encoding, fail, succeed

REAGENT_ORDER_REASON_CHOICES = (
    "running_out",
    "not_stocked",
    "common_public",
    "not_found",
    "reorder",
    "high_usage",
    "degraded",
    "others",
)

PAYLOAD_SOURCE_ERROR = "Use either explicit command arguments or --data-json/--data-file, not both"
DEFAULT_LIST_PAGE_SIZE = 50
SUMMARY_ONLY_LIMIT = 0
INVENTORY_LIST_PARAM_KEYS = frozenset(
    {
        "skip",
        "limit",
        "status_filter",
        "cas_filter",
        "hazardous_only",
        "search",
        "search_field",
        "fuzzy",
        "sort_by",
        "sort_order",
    }
)
INVENTORY_NAME_SEARCH_PARAM_KEYS = INVENTORY_LIST_PARAM_KEYS | {"match_mode"}
ORDER_LIST_PARAM_KEYS = frozenset(
    {
        "skip",
        "limit",
        "status_filter",
        "search",
        "search_field",
        "fuzzy",
        "sort_by",
        "sort_order",
    }
)
ORDER_NAME_SEARCH_PARAM_KEYS = ORDER_LIST_PARAM_KEYS | {"match_mode"}
COMMON_SHELF_LIST_PARAM_KEYS = frozenset(
    {
        "skip",
        "limit",
        "search",
        "search_field",
        "fuzzy",
        "match_mode",
        "sort_by",
        "sort_order",
    }
)
CHEMICAL_NAME_MAP_LIST_PARAM_KEYS = frozenset(
    {
        "skip",
        "limit",
        "search",
        "search_field",
        "fuzzy",
        "match_mode",
        "sort_by",
        "sort_order",
    }
)


class CLIArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        fail(message, code="ARGPARSE_ERROR", exit_code=8)


def _build_common_parser() -> argparse.ArgumentParser:
    parser = CLIArgumentParser(prog=_resolve_prog_name(), description="Lab Storage Manager CLI")
    _add_connection_arguments(parser)
    return parser


def _resolve_prog_name() -> str:
    # 帮助输出统一展示为 `lsm`，避免源码入口和打包入口显示不同命令形式。
    raw_prog = Path(sys.argv[0]).stem.strip().lower()
    if raw_prog in {"", "__main__", "python", "python3", "py", "lsm"}:
        return "lsm"
    return raw_prog


def _add_connection_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--base-url", help="API base url, e.g. http://127.0.0.1:8000/api")
    parser.add_argument("--token", help="Bearer token override")
    parser.add_argument("--timeout", type=float, default=5.0, help="HTTP timeout in seconds")


def _add_login_connection_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--base-url", help="API base url, e.g. http://127.0.0.1:8000/api")
    parser.add_argument("--timeout", type=float, default=5.0, help="HTTP timeout in seconds")


def _add_payload_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--data-json", help="Inline JSON payload")
    parser.add_argument("--data-file", help="Path to JSON payload file")


def _add_inventory_id_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "inventory_id",
        type=_parse_positive_int,
        help="Single positive inventory ID",
    )


def _add_order_id_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "order_id",
        type=_parse_positive_int,
        help="Single positive order ID",
    )


def _add_common_shelf_group_key_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "group_key",
        help="Common shelf group key from `lsm common-shelf list`",
    )


def _add_param_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--param",
        action="append",
        default=[],
        help="Query parameter in key=value form, can be repeated; unknown keys fail with INVALID_INPUT",
    )


def _add_list_arguments(parser: argparse.ArgumentParser) -> None:
    _add_param_arguments(parser)
    _add_pagination_arguments(parser)


def _add_pagination_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--page",
        type=_parse_positive_int,
        help="1-based page number; calculates skip using the effective page size",
    )
    parser.add_argument(
        "--page-size",
        dest="page_size",
        type=_parse_positive_int,
        help="Convenience page size option; maps to limit",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Only fetch and print total/skip/limit summary without row details",
    )


def _add_exact_search_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--exact",
        action="store_true",
        help="Use exact text matching for this name search",
    )


def _set_list_command_help(
    parser: argparse.ArgumentParser,
    *,
    command_label: str,
    allowed_params: frozenset[str],
    known_id_hint: str | None = None,
) -> None:
    allowed = ", ".join(sorted(allowed_params))
    parser.description = f"{command_label} command"
    epilog_lines = [
        "Allowed --param keys:",
        f"  {allowed}",
        "",
        "Unknown --param keys return INVALID_INPUT immediately.",
    ]
    if known_id_hint:
        epilog_lines.extend(["", known_id_hint])
    parser.epilog = "\n".join(epilog_lines)


def _client_from_args(args: argparse.Namespace) -> APIClient:
    return APIClient(base_url=args.base_url, token=args.token, timeout=args.timeout)


def _uses_connection_override(args: argparse.Namespace) -> bool:
    return (
        getattr(args, "base_url", None) is not None
        or getattr(args, "token", None) is not None
        or bool(get_env_token())
    )


def _handle_auth_login(args: argparse.Namespace) -> None:
    if getattr(args, "token", None) is not None:
        raise CLILocalInputError("auth login does not accept --token")
    client = APIClient(base_url=args.base_url, timeout=args.timeout, use_env_token=False)
    payload = {
        "username": args.username,
        "password": _resolve_login_password(args),
        "device_id": "cli",
        "device_name": "LabStorageManager CLI",
    }
    data = client.request("POST", "/users/login/token", json_body=payload)
    config = load_config()
    config.update(
        {
            "base_url": client.base_url,
            "access_token": data["access_token"],
            "token_type": data.get("token_type", "bearer"),
            "user": data.get("user"),
        }
    )
    path = save_config(config)
    succeed({"config_path": str(path), "user": data.get("user")})


def _handle_auth_logout(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    persist_local_auth = not _uses_connection_override(args)
    try:
        data = client.request("POST", "/users/logout")
    except CLIRequestError as exc:
        if persist_local_auth and exc.status_code == 401:
            clear_auth_data()
        raise
    else:
        # 本地 token 一旦失效或登出，就不再保留，避免 agent 继续复用旧凭据重试。
        if persist_local_auth:
            clear_auth_data()
        succeed(data)


def _handle_auth_whoami(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    data = client.request("GET", "/users/me")
    if not _uses_connection_override(args):
        config = load_config()
        # `whoami` 成功后顺手刷新本地缓存用户信息，避免配置里的展示信息长期漂移。
        config["user"] = data
        save_config(config)
    succeed(data)


def _handle_list_command(args: argparse.Namespace, path: str) -> None:
    client = _client_from_args(args)
    params = _build_list_query_params(args)
    data = client.request("GET", path, params=params)
    if getattr(args, "summary", False):
        succeed(_build_list_summary(data))
        return
    succeed(data)


def _handle_get_command(args: argparse.Namespace, path: str) -> None:
    client = _client_from_args(args)
    succeed(client.request("GET", path.format(**vars(args))))


def _handle_post_command(args: argparse.Namespace, path: str, *, payload_required: bool = False) -> None:
    client = _client_from_args(args)
    payload = load_json_payload(args.data_json, args.data_file, required=payload_required)
    params = parse_key_value_pairs(getattr(args, "param", []))
    succeed(client.request("POST", path.format(**vars(args)), params=params, json_body=payload))


def _handle_put_command(args: argparse.Namespace, path: str, *, payload_required: bool = False) -> None:
    client = _client_from_args(args)
    payload = load_json_payload(args.data_json, args.data_file, required=payload_required)
    succeed(client.request("PUT", path.format(**vars(args)), json_body=payload))


def _parse_bool_arg(raw_value: str) -> bool:
    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    raise argparse.ArgumentTypeError("Expected a boolean value: true/false")


def _parse_positive_int(raw_value: str) -> int:
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected a positive integer") from exc
    if value <= 0:
        raise argparse.ArgumentTypeError("Expected a positive integer")
    return value


def _read_positive_int_param(
    params: dict[str, Any],
    key: str,
    *,
    default: int,
) -> int:
    raw_value = params.get(key)
    if raw_value is None:
        return default
    try:
        value = int(str(raw_value))
    except (TypeError, ValueError) as exc:
        raise CLILocalInputError(f"`{key}` must be a positive integer") from exc
    if value <= 0:
        raise CLILocalInputError(f"`{key}` must be a positive integer")
    return value


def _build_list_query_params(args: argparse.Namespace) -> dict[str, Any]:
    params = parse_key_value_pairs(args.param)
    _validate_allowed_list_params(
        params,
        allowed_params=getattr(args, "allowed_params", frozenset()),
        command_label=getattr(args, "list_command_label", "list command"),
    )
    page = getattr(args, "page", None)
    page_size = getattr(args, "page_size", None)
    summary = bool(getattr(args, "summary", False))

    if summary:
        if page is not None or page_size is not None or "skip" in params or "limit" in params:
            raise CLILocalInputError(
                "`--summary` cannot be combined with skip/limit or --page/--page-size"
            )
        params["skip"] = 0
        params["limit"] = SUMMARY_ONLY_LIMIT
        return params

    if page is not None and "skip" in params:
        raise CLILocalInputError("Use either `--page` or `--param skip=...`, not both")
    if page_size is not None and "limit" in params:
        raise CLILocalInputError("Use either `--page-size` or `--param limit=...`, not both")

    effective_page_size = page_size
    if effective_page_size is None and page is not None:
        effective_page_size = _read_positive_int_param(
            params,
            "limit",
            default=DEFAULT_LIST_PAGE_SIZE,
        )
        params["limit"] = effective_page_size
    elif effective_page_size is not None:
        params["limit"] = effective_page_size

    if page is not None:
        params["skip"] = (page - 1) * effective_page_size

    return params


def _build_list_summary(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise CLILocalInputError("List summary response is not a JSON object")
    return {
        "total": data.get("total", 0),
        "skip": data.get("skip", 0),
        "limit": data.get("limit", SUMMARY_ONLY_LIMIT),
    }


def _validate_allowed_list_params(
    params: dict[str, Any],
    *,
    allowed_params: frozenset[str],
    command_label: str,
) -> None:
    if not allowed_params:
        return
    unknown_keys = sorted(key for key in params if key not in allowed_params)
    if not unknown_keys:
        return
    allowed = ", ".join(sorted(allowed_params))
    invalid = ", ".join(unknown_keys)
    message = f"Unsupported --param key(s) for {command_label}: {invalid}. Allowed keys: {allowed}."

    if command_label == "inventory list" and any(key in {"id", "inventory_id"} for key in unknown_keys):
        message += " inventory list does not support filtering by inventory_id; use `lsm inventory get <inventory_id>` when the ID is known."
    elif command_label == "reagent-orders list" and any(key in {"id", "order_id"} for key in unknown_keys):
        message += " reagent-orders list does not support filtering by order_id; use `lsm reagent-orders get <order_id>` when the ID is known."
    elif command_label == "consumable-orders list" and any(key in {"id", "order_id"} for key in unknown_keys):
        message += " consumable-orders list does not support filtering by order_id; use `lsm consumable-orders get <order_id>` when the ID is known."

    raise CLILocalInputError(message)


def _has_inline_payload_args(args: argparse.Namespace) -> bool:
    return bool(getattr(args, "data_json", None) or getattr(args, "data_file", None))


def _collect_explicit_payload(args: argparse.Namespace, field_names: tuple[str, ...]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for field_name in field_names:
        value = getattr(args, field_name, None)
        if value is None:
            continue
        payload[field_name] = value
    return payload


def _load_payload_from_command_args(
    args: argparse.Namespace,
    *,
    explicit_fields: tuple[str, ...],
    command_label: str,
    allow_empty: bool = False,
) -> dict[str, Any] | None:
    explicit_payload = _collect_explicit_payload(args, explicit_fields)
    if explicit_payload:
        if _has_inline_payload_args(args):
            raise CLILocalInputError(PAYLOAD_SOURCE_ERROR)
        return explicit_payload

    payload = load_json_payload(args.data_json, args.data_file, required=False)
    if payload is not None:
        return payload
    if allow_empty:
        return None

    raise CLILocalInputError(
        f"{command_label} requires at least one explicit field or a JSON object payload"
    )


def _request_with_payload(
    *,
    client: APIClient,
    method: str,
    path: str,
    json_body: dict[str, Any] | None,
    params: dict[str, Any] | None = None,
) -> None:
    succeed(client.request(method, path, params=params, json_body=json_body))


def _ensure_finite_number(value: float, *, field_name: str) -> float:
    if not math.isfinite(value):
        raise CLILocalInputError(f"Field `{field_name}` must be a finite number")
    return value


def _parse_finite_float_arg(raw_value: str) -> float:
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a valid number") from exc
    if not math.isfinite(value):
        raise argparse.ArgumentTypeError("must be a finite number")
    return value


def _validate_payload_finite_numbers(payload: dict[str, Any], *field_names: str) -> None:
    for field_name in field_names:
        if field_name not in payload:
            continue
        payload[field_name] = _read_float_field(payload, field_name)


def _read_float_field(payload: dict[str, Any], field_name: str) -> float | None:
    value = payload.get(field_name)
    if value is None:
        return None
    if isinstance(value, bool):
        raise CLILocalInputError(f"Field `{field_name}` is not a valid number")
    if isinstance(value, (int, float)):
        return _ensure_finite_number(float(value), field_name=field_name)
    try:
        return _ensure_finite_number(float(str(value)), field_name=field_name)
    except (TypeError, ValueError) as exc:
        raise CLILocalInputError(f"Field `{field_name}` is not a valid number") from exc


def _resolve_inventory_remaining_for_return(payload: Any) -> tuple[float, str | None]:
    if not isinstance(payload, dict):
        raise CLILocalInputError("Inventory response is not a JSON object")

    remaining_quantity = _read_float_field(payload, "remaining_quantity")
    initial_quantity = _read_float_field(payload, "initial_quantity")
    current_remaining = remaining_quantity if remaining_quantity is not None else initial_quantity
    if current_remaining is None:
        raise CLILocalInputError("Inventory item does not expose a usable remaining quantity")
    if current_remaining < 0:
        raise CLILocalInputError("Inventory item has an invalid negative remaining quantity")

    unit = payload.get("unit")
    return current_remaining, str(unit) if unit else None


def _build_inventory_return_payload(
    args: argparse.Namespace,
    client: APIClient,
) -> dict[str, Any]:
    has_explicit = any(
        getattr(args, field_name, None) is not None
        for field_name in ("remaining_quantity", "used_quantity")
    )
    if has_explicit and _has_inline_payload_args(args):
        raise CLILocalInputError(PAYLOAD_SOURCE_ERROR)

    if args.used_quantity is None and args.remaining_quantity is None:
        payload = load_json_payload(args.data_json, args.data_file, required=True)
        _validate_payload_finite_numbers(payload or {}, "remaining_quantity")
        if payload and "unit" in payload:
            raise CLILocalInputError("inventory return does not accept `unit`; existing inventory unit is preserved")
        return payload or {}

    if args.used_quantity is not None and args.remaining_quantity is not None:
        raise CLILocalInputError("Use either --remaining-quantity or --used-quantity, not both")

    if args.remaining_quantity is not None:
        return {"remaining_quantity": args.remaining_quantity}

    if args.used_quantity < 0:
        raise CLILocalInputError("used quantity must be greater than or equal to 0")

    inventory = client.request("GET", f"/inventory/{args.inventory_id}")
    current_remaining, _unit = _resolve_inventory_remaining_for_return(inventory)
    if args.used_quantity > current_remaining:
        raise CLILocalInputError(
            f"Used quantity ({args.used_quantity}) cannot exceed current remaining quantity ({current_remaining})"
        )

    payload: dict[str, Any] = {
        "remaining_quantity": max(0.0, round(current_remaining - args.used_quantity, 10))
    }
    return payload


def _handle_inventory_borrow(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    _request_with_payload(
        client=client,
        method="POST",
        path=f"/inventory/{args.inventory_id}/borrow",
        json_body=None,
    )


def _handle_inventory_return(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    payload = _build_inventory_return_payload(args, client)
    _request_with_payload(
        client=client,
        method="POST",
        path=f"/inventory/{args.inventory_id}/return",
        json_body=payload,
    )


def _handle_inventory_update(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    payload = _load_payload_from_command_args(
        args,
        explicit_fields=(
            "name",
            "cas_number",
            "storage_location",
            "remaining_quantity",
            "notes",
            "english_name",
            "alias",
            "category",
            "brand",
            "purity",
            "is_hazardous",
            "specification",
        ),
        command_label="inventory update",
    )
    if payload is not None:
        _validate_payload_finite_numbers(payload, "remaining_quantity")
    _request_with_payload(
        client=client,
        method="PUT",
        path=f"/inventory/{args.inventory_id}",
        json_body=payload,
    )


def _handle_reagent_order_update(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    payload = _load_payload_from_command_args(
        args,
        explicit_fields=(
            "cas_number",
            "name",
            "english_name",
            "alias",
            "category",
            "brand",
            "purity",
            "initial_quantity",
            "unit",
            "quantity",
            "price",
            "order_reason",
            "is_hazardous",
            "notes",
        ),
        command_label="reagent-orders update",
    )
    if payload is not None:
        _validate_payload_finite_numbers(payload, "initial_quantity", "price")
    _request_with_payload(
        client=client,
        method="PUT",
        path=f"/reagent-orders/{args.order_id}",
        json_body=payload,
    )


def _handle_reagent_confirm_arrival(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    payload = _load_payload_from_command_args(
        args,
        explicit_fields=("arrival_notes", "storage_location"),
        command_label="reagent-orders confirm-arrival",
        allow_empty=True,
    )
    _request_with_payload(
        client=client,
        method="POST",
        path=f"/reagent-orders/{args.order_id}/confirm-arrival",
        json_body=payload,
    )


def _build_reagent_stock_in_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload = _load_payload_from_command_args(
        args,
        explicit_fields=("storage_location", "remaining_quantity"),
        command_label="reagent-orders stock-in",
    )
    if payload is None:
        raise CLILocalInputError("reagent-orders stock-in requires input")
    _validate_payload_finite_numbers(payload, "remaining_quantity")
    if "storage_location" not in payload:
        raise CLILocalInputError("reagent-orders stock-in requires `--storage-location` in explicit-argument mode")
    return payload


def _handle_reagent_stock_in(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    payload = _build_reagent_stock_in_payload(args)
    _request_with_payload(
        client=client,
        method="POST",
        path=f"/reagent-orders/{args.order_id}/stock-in",
        json_body=payload,
    )


def _build_common_shelf_add_bottles_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload = _load_payload_from_command_args(
        args,
        explicit_fields=("count", "storage_location", "purity", "notes"),
        command_label="common-shelf add-bottles",
    )
    if payload is None or payload.get("count") is None:
        raise CLILocalInputError(
            "common-shelf add-bottles requires `--count` or JSON field `count`"
        )
    return payload


def _handle_common_shelf_add_bottles(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    payload = _build_common_shelf_add_bottles_payload(args)
    _request_with_payload(
        client=client,
        method="POST",
        path=f"/common-shelf/groups/{args.group_key}/add-bottles",
        json_body=payload,
    )


def _handle_field_search(
    args: argparse.Namespace,
    *,
    path: str,
    search_attr: str,
    search_field: str,
    allowed_params: frozenset[str],
    command_label: str,
    match_mode: str | None = None,
) -> None:
    search_value = str(getattr(args, search_attr, "") or "").strip()
    if not search_value:
        raise CLILocalInputError(f"{command_label} requires a non-empty search value")
    args.param = [f"search={search_value}", f"search_field={search_field}"]
    resolved_match_mode = match_mode
    if resolved_match_mode is None and getattr(args, "exact", False):
        resolved_match_mode = "exact"
    if resolved_match_mode and "match_mode" in allowed_params:
        args.param.append(f"match_mode={resolved_match_mode}")
    args.allowed_params = allowed_params
    args.list_command_label = command_label
    _handle_list_command(args, path)


def _build_common_shelf_remove_one_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload = _load_payload_from_command_args(
        args,
        explicit_fields=("storage_location",),
        command_label="common-shelf remove-one",
        allow_empty=True,
    )
    if payload is None:
        return {}

    if "storage_location" in payload:
        storage_location = str(payload.get("storage_location") or "").strip()
        payload["storage_location"] = storage_location or None
    return payload


def _handle_common_shelf_remove_one(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    payload = _build_common_shelf_remove_one_payload(args)
    _request_with_payload(
        client=client,
        method="POST",
        path=f"/common-shelf/groups/{args.group_key}/remove-one",
        json_body=payload,
    )


def _handle_consumable_order_update(args: argparse.Namespace) -> None:
    client = _client_from_args(args)
    payload = _load_payload_from_command_args(
        args,
        explicit_fields=(
            "name",
            "english_name",
            "product_number",
            "specification",
            "unit",
            "quantity",
            "price",
            "communication",
            "notes",
        ),
        command_label="consumable-orders update",
    )
    if payload is not None:
        _validate_payload_finite_numbers(payload, "price")
    _request_with_payload(
        client=client,
        method="PUT",
        path=f"/consumable-orders/{args.order_id}",
        json_body=payload,
    )


def _register_list_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
    *,
    name: str,
    help_text: str,
    path: str,
    allowed_params: frozenset[str],
    command_label: str,
    known_id_hint: str | None = None,
) -> None:
    parser = subparsers.add_parser(name, help=help_text, formatter_class=argparse.RawTextHelpFormatter)
    _add_connection_arguments(parser)
    _add_list_arguments(parser)
    _set_list_command_help(
        parser,
        command_label=command_label,
        allowed_params=allowed_params,
        known_id_hint=known_id_hint,
    )
    parser.set_defaults(
        handler=lambda args: _handle_list_command(args, path),
        allowed_params=allowed_params,
        list_command_label=command_label,
    )


def _register_get_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
    *,
    name: str,
    help_text: str,
    path: str,
    add_target_argument: Callable[[argparse.ArgumentParser], None] | None = None,
) -> None:
    parser = subparsers.add_parser(name, help=help_text)
    _add_connection_arguments(parser)
    if add_target_argument is not None:
        add_target_argument(parser)
    parser.set_defaults(handler=lambda args: _handle_get_command(args, path))


def _register_field_search_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
    *,
    name: str,
    help_text: str,
    path: str,
    argument_name: str,
    search_attr: str,
    search_field: str,
    allowed_params: frozenset[str],
    command_label: str,
    exact: bool = False,
    match_mode: str | None = None,
) -> None:
    parser = subparsers.add_parser(name, help=help_text)
    _add_connection_arguments(parser)
    parser.add_argument(argument_name)
    _add_pagination_arguments(parser)
    if exact:
        _add_exact_search_argument(parser)
    parser.set_defaults(
        handler=lambda args: _handle_field_search(
            args,
            path=path,
            search_attr=search_attr,
            search_field=search_field,
            allowed_params=allowed_params,
            command_label=command_label,
            match_mode=match_mode,
        )
    )


def _register_post_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
    *,
    name: str,
    help_text: str,
    path: str,
    payload_required: bool = False,
    add_target_argument: Callable[[argparse.ArgumentParser], None] | None = None,
    add_payload_arguments: bool = False,
) -> None:
    parser = subparsers.add_parser(name, help=help_text)
    _add_connection_arguments(parser)
    if add_target_argument is not None:
        add_target_argument(parser)
    if add_payload_arguments:
        _add_payload_arguments(parser)
    parser.set_defaults(
        handler=lambda args: _handle_post_command(args, path, payload_required=payload_required)
    )


def _register_auth_commands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    auth = subparsers.add_parser("auth", help="Authentication commands")
    auth_sub = auth.add_subparsers(dest="auth_command", required=True)

    login = auth_sub.add_parser("login", help="Login and store token locally")
    _add_login_connection_arguments(login)
    login.add_argument("--username", required=True, help="Username for CLI login")
    login.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read password from stdin to avoid interactive prompt",
    )
    login.set_defaults(handler=_handle_auth_login)

    whoami = auth_sub.add_parser("whoami", help="Get current user profile")
    _add_connection_arguments(whoami)
    whoami.set_defaults(handler=_handle_auth_whoami)

    logout = auth_sub.add_parser("logout", help="Logout and clear local token")
    _add_connection_arguments(logout)
    logout.set_defaults(handler=_handle_auth_logout)


def _register_inventory_commands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    inventory = subparsers.add_parser("inventory", help="Inventory commands")
    inventory_sub = inventory.add_subparsers(dest="inventory_command", required=True)
    _register_list_command(
        inventory_sub, name="list", help_text="List inventory", path="/inventory/",
        allowed_params=INVENTORY_LIST_PARAM_KEYS, command_label="inventory list",
        known_id_hint="Known inventory ID? Use `lsm inventory get <inventory_id>` instead of `--param id=...`.",
    )
    _register_get_command(
        inventory_sub, name="get", help_text="Get inventory by id",
        path="/inventory/{inventory_id}",
        add_target_argument=_add_inventory_id_argument,
    )
    _register_get_command(
        inventory_sub, name="cas", help_text="Get inventory summary by CAS",
        path="/inventory/cas/{cas_number}",
        add_target_argument=lambda parser: parser.add_argument("cas_number"),
    )
    _register_field_search_command(
        inventory_sub, name="name", help_text="Search inventory by name", path="/inventory/",
        argument_name="keyword", search_attr="keyword", search_field="name",
        allowed_params=INVENTORY_NAME_SEARCH_PARAM_KEYS, command_label="inventory name",
        exact=True,
    )
    _register_get_command(
        inventory_sub, name="code", help_text="Get inventory by internal code",
        path="/inventory/code/{internal_code}",
        add_target_argument=lambda parser: parser.add_argument("internal_code"),
    )
    _register_get_command(
        inventory_sub, name="my-borrows", help_text="Get current user's borrows",
        path="/inventory/dashboard/my-borrows",
    )
    _register_get_command(
        inventory_sub, name="pending-stockin", help_text="Get current user's pending stock-in items",
        path="/inventory/dashboard/pending-stockin",
    )
    borrow = inventory_sub.add_parser("borrow", help="Borrow an inventory item")
    _add_connection_arguments(borrow)
    _add_inventory_id_argument(borrow)
    borrow.set_defaults(handler=_handle_inventory_borrow)

    return_cmd = inventory_sub.add_parser("return", help="Return an inventory item")
    _add_connection_arguments(return_cmd)
    _add_inventory_id_argument(return_cmd)
    _add_payload_arguments(return_cmd)
    return_cmd.add_argument(
        "--remaining-quantity",
        type=_parse_finite_float_arg,
        help="Final remaining quantity after return",
    )
    return_cmd.add_argument(
        "--used-quantity",
        type=_parse_finite_float_arg,
        help="Interpret input as used quantity; CLI converts it to remaining_quantity before submit",
    )
    return_cmd.set_defaults(handler=_handle_inventory_return)
    _register_post_command(
        inventory_sub, name="manual-add", help_text="Create inventory manually",
        path="/inventory/manual-add", payload_required=True, add_payload_arguments=True,
    )

    update = inventory_sub.add_parser("update", help="Update inventory")
    _add_connection_arguments(update)
    _add_inventory_id_argument(update)
    _add_payload_arguments(update)
    update.add_argument("--name")
    update.add_argument("--cas-number", dest="cas_number")
    update.add_argument("--storage-location", dest="storage_location")
    update.add_argument("--remaining-quantity", dest="remaining_quantity", type=_parse_finite_float_arg)
    update.add_argument("--notes")
    update.add_argument("--english-name", dest="english_name")
    update.add_argument("--alias")
    update.add_argument("--category")
    update.add_argument("--brand")
    update.add_argument("--purity")
    update.add_argument("--is-hazardous", dest="is_hazardous", type=_parse_bool_arg)
    update.add_argument("--specification")
    update.set_defaults(handler=_handle_inventory_update)


def _register_reagent_order_commands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    reagent = subparsers.add_parser("reagent-orders", help="Reagent order commands")
    reagent_sub = reagent.add_subparsers(dest="reagent_command", required=True)
    _register_list_command(
        reagent_sub, name="list", help_text="List reagent orders", path="/reagent-orders/",
        allowed_params=ORDER_LIST_PARAM_KEYS, command_label="reagent-orders list",
        known_id_hint="Known order ID? Use `lsm reagent-orders get <order_id>` instead of `--param id=...`.",
    )
    _register_get_command(
        reagent_sub, name="get", help_text="Get reagent order by id",
        path="/reagent-orders/{order_id}",
        add_target_argument=_add_order_id_argument,
    )
    _register_field_search_command(
        reagent_sub, name="cas", help_text="List reagent orders by CAS", path="/reagent-orders/",
        argument_name="cas_number", search_attr="cas_number", search_field="cas_number",
        allowed_params=ORDER_LIST_PARAM_KEYS, command_label="reagent-orders cas",
    )
    _register_field_search_command(
        reagent_sub, name="name", help_text="Search reagent orders by name", path="/reagent-orders/",
        argument_name="keyword", search_attr="keyword", search_field="name",
        allowed_params=ORDER_NAME_SEARCH_PARAM_KEYS, command_label="reagent-orders name",
        exact=True,
    )
    _register_get_command(
        reagent_sub, name="my", help_text="Get current user's reagent orders",
        path="/reagent-orders/dashboard/my-reagent-orders",
    )
    _register_post_command(
        reagent_sub, name="create", help_text="Create reagent order",
        path="/reagent-orders/", payload_required=True, add_payload_arguments=True,
    )

    update_cmd = reagent_sub.add_parser("update", help="Update reagent order")
    _add_connection_arguments(update_cmd)
    _add_order_id_argument(update_cmd)
    _add_payload_arguments(update_cmd)
    update_cmd.add_argument("--cas-number", dest="cas_number")
    update_cmd.add_argument("--name")
    update_cmd.add_argument("--english-name", dest="english_name")
    update_cmd.add_argument("--alias")
    update_cmd.add_argument("--category")
    update_cmd.add_argument("--brand")
    update_cmd.add_argument("--purity")
    update_cmd.add_argument("--initial-quantity", dest="initial_quantity", type=_parse_finite_float_arg)
    update_cmd.add_argument("--unit")
    update_cmd.add_argument("--quantity", type=int)
    update_cmd.add_argument("--price", type=_parse_finite_float_arg)
    update_cmd.add_argument("--order-reason", dest="order_reason", choices=REAGENT_ORDER_REASON_CHOICES)
    update_cmd.add_argument("--is-hazardous", dest="is_hazardous", type=_parse_bool_arg)
    update_cmd.add_argument("--notes")
    update_cmd.set_defaults(handler=_handle_reagent_order_update)

    _register_get_command(reagent_sub, name="cas-overview", help_text="Get reagent CAS overview", path="/reagent-orders/cas-overview/{cas_number}", add_target_argument=lambda parser: parser.add_argument("cas_number"))

    arrival_cmd = reagent_sub.add_parser("confirm-arrival", help="Confirm reagent order arrival")
    _add_connection_arguments(arrival_cmd)
    _add_order_id_argument(arrival_cmd)
    _add_payload_arguments(arrival_cmd)
    arrival_cmd.add_argument("--arrival-notes", dest="arrival_notes")
    arrival_cmd.add_argument("--storage-location", dest="storage_location")
    arrival_cmd.set_defaults(handler=_handle_reagent_confirm_arrival)

    stock_in_cmd = reagent_sub.add_parser("stock-in", help="Stock in reagent order")
    _add_connection_arguments(stock_in_cmd)
    _add_order_id_argument(stock_in_cmd)
    _add_payload_arguments(stock_in_cmd)
    stock_in_cmd.add_argument("--storage-location", dest="storage_location")
    stock_in_cmd.add_argument("--remaining-quantity", dest="remaining_quantity", type=_parse_finite_float_arg)
    stock_in_cmd.set_defaults(handler=_handle_reagent_stock_in)


def _register_common_shelf_commands(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    common_shelf = subparsers.add_parser("common-shelf", help="Common shelf commands")
    common_shelf_sub = common_shelf.add_subparsers(
        dest="common_shelf_command",
        required=True,
    )
    _register_list_command(
        common_shelf_sub, name="list", help_text="List common shelf groups", path="/common-shelf/groups",
        allowed_params=COMMON_SHELF_LIST_PARAM_KEYS, command_label="common-shelf list",
        known_id_hint="Use the returned group.group_key for add-bottles or remove-one.",
    )
    _register_field_search_command(
        common_shelf_sub, name="cas", help_text="Search common shelf groups by CAS", path="/common-shelf/groups",
        argument_name="cas_number", search_attr="cas_number", search_field="cas_number",
        allowed_params=COMMON_SHELF_LIST_PARAM_KEYS, command_label="common-shelf cas",
        match_mode="exact",
    )
    _register_field_search_command(
        common_shelf_sub, name="alias", help_text="Search common shelf groups by alias", path="/common-shelf/groups",
        argument_name="keyword", search_attr="keyword", search_field="alias",
        allowed_params=COMMON_SHELF_LIST_PARAM_KEYS, command_label="common-shelf alias",
    )
    _register_get_command(
        common_shelf_sub, name="locations", help_text="List locations for a common shelf group",
        path="/common-shelf/groups/{group_key}/locations",
        add_target_argument=_add_common_shelf_group_key_argument,
    )
    _register_post_command(
        common_shelf_sub, name="manual-add", help_text="Create common shelf bottles manually",
        path="/common-shelf/manual-add", payload_required=True, add_payload_arguments=True,
    )

    add_bottles = common_shelf_sub.add_parser(
        "add-bottles",
        help="Add bottles to a common shelf group",
    )
    _add_connection_arguments(add_bottles)
    _add_common_shelf_group_key_argument(add_bottles)
    _add_payload_arguments(add_bottles)
    add_bottles.add_argument("--count", type=_parse_positive_int, help="Bottle count to add")
    add_bottles.add_argument("--storage-location", dest="storage_location")
    add_bottles.add_argument("--purity")
    add_bottles.add_argument("--notes")
    add_bottles.set_defaults(handler=_handle_common_shelf_add_bottles)

    remove_one = common_shelf_sub.add_parser(
        "remove-one",
        help="Remove one bottle from a group location",
    )
    _add_connection_arguments(remove_one)
    _add_common_shelf_group_key_argument(remove_one)
    _add_payload_arguments(remove_one)
    remove_one.add_argument(
        "--storage-location",
        dest="storage_location",
        help="Target storage location to decrement; omit to decrement a bottle with no location",
    )
    remove_one.set_defaults(handler=_handle_common_shelf_remove_one)


def _register_chemical_name_map_commands(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    name_map = subparsers.add_parser(
        "chemical-name-map",
        help="Chemical CAS master data commands",
    )
    name_map_sub = name_map.add_subparsers(dest="chemical_name_map_command", required=True)
    _register_list_command(
        name_map_sub, name="list", help_text="List chemical CAS master data", path="/chemical-name-map",
        allowed_params=CHEMICAL_NAME_MAP_LIST_PARAM_KEYS, command_label="chemical-name-map list",
    )
    _register_field_search_command(
        name_map_sub, name="search", help_text="Search chemical CAS master data", path="/chemical-name-map",
        argument_name="keyword", search_attr="keyword", search_field="all",
        allowed_params=CHEMICAL_NAME_MAP_LIST_PARAM_KEYS, command_label="chemical-name-map search",
    )
    _register_field_search_command(
        name_map_sub, name="cas", help_text="Search chemical CAS master data by CAS", path="/chemical-name-map",
        argument_name="cas_number", search_attr="cas_number", search_field="cas_number",
        allowed_params=CHEMICAL_NAME_MAP_LIST_PARAM_KEYS, command_label="chemical-name-map cas",
        match_mode="exact",
    )


def _register_consumable_order_commands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    consumable = subparsers.add_parser("consumable-orders", help="Consumable order commands")
    consumable_sub = consumable.add_subparsers(dest="consumable_command", required=True)
    _register_list_command(
        consumable_sub, name="list", help_text="List consumable orders", path="/consumable-orders/",
        allowed_params=ORDER_LIST_PARAM_KEYS, command_label="consumable-orders list",
        known_id_hint="Known order ID? Use `lsm consumable-orders get <order_id>` instead of `--param id=...`.",
    )
    _register_get_command(
        consumable_sub, name="get", help_text="Get consumable order by id",
        path="/consumable-orders/{order_id}",
        add_target_argument=_add_order_id_argument,
    )
    _register_field_search_command(
        consumable_sub, name="name", help_text="Search consumable orders by name", path="/consumable-orders/",
        argument_name="keyword", search_attr="keyword", search_field="name",
        allowed_params=ORDER_NAME_SEARCH_PARAM_KEYS, command_label="consumable-orders name",
        exact=True,
    )
    _register_get_command(
        consumable_sub, name="my", help_text="Get current user's consumable orders",
        path="/consumable-orders/dashboard/my-consumable-orders",
    )
    _register_post_command(
        consumable_sub, name="create", help_text="Create consumable order",
        path="/consumable-orders/", payload_required=True, add_payload_arguments=True,
    )

    update_cmd = consumable_sub.add_parser("update", help="Update consumable order")
    _add_connection_arguments(update_cmd)
    _add_order_id_argument(update_cmd)
    _add_payload_arguments(update_cmd)
    update_cmd.add_argument("--name")
    update_cmd.add_argument("--english-name", dest="english_name")
    update_cmd.add_argument("--product-number", dest="product_number")
    update_cmd.add_argument("--specification")
    update_cmd.add_argument("--unit")
    update_cmd.add_argument("--quantity", type=int)
    update_cmd.add_argument("--price", type=_parse_finite_float_arg)
    update_cmd.add_argument("--communication")
    update_cmd.add_argument("--notes")
    update_cmd.set_defaults(handler=_handle_consumable_order_update)

    _register_post_command(consumable_sub, name="complete", help_text="Complete consumable order", path="/consumable-orders/{order_id}/complete", add_target_argument=_add_order_id_argument)


def build_parser() -> argparse.ArgumentParser:
    parser = _build_common_parser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    _register_auth_commands(subparsers)
    _register_inventory_commands(subparsers)
    _register_reagent_order_commands(subparsers)
    _register_common_shelf_commands(subparsers)
    _register_chemical_name_map_commands(subparsers)
    _register_consumable_order_commands(subparsers)
    return parser


def _resolve_login_password(args: argparse.Namespace) -> str:
    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
        if not password:
            raise CLILocalInputError("Password read from stdin is empty")
        return password
    password = getpass.getpass("Password: ")
    if not password:
        raise CLILocalInputError("Password prompt is empty")
    return password


def main(argv: list[str] | None = None) -> None:
    configure_output_encoding()
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.handler(args)
    except CLIRequestError as exc:
        exit_code = 1
        # 退出码按 HTTP 语义分层，agent 可以直接拿它做重试或权限分支判断。
        if exc.status_code == 401:
            exit_code = 2
        elif exc.status_code == 403:
            exit_code = 3
        elif exc.status_code == 404:
            exit_code = 4
        elif exc.status_code == 429:
            exit_code = 5
        fail(exc.message, code="HTTP_ERROR", exit_code=exit_code, detail=exc.payload)
    except FileNotFoundError as exc:
        fail(str(exc), code="FILE_NOT_FOUND", exit_code=6)
    except CLILocalInputError as exc:
        fail(str(exc), code="INVALID_INPUT", exit_code=7)
    except CLINetworkError as exc:
        fail(exc.message, code="NETWORK_ERROR", exit_code=9)
    except ValueError as exc:
        fail(str(exc), code="INVALID_INPUT", exit_code=7)
