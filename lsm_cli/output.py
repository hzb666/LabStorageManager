from __future__ import annotations

import json
import sys
from typing import Any


def print_json(payload: Any) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")


def fail(message: str, *, code: str = "CLI_ERROR", exit_code: int = 1, detail: Any = None) -> None:
    payload: dict[str, Any] = {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
        },
    }
    if detail is not None:
        payload["error"]["detail"] = detail
    print_json(payload)
    raise SystemExit(exit_code)


def succeed(data: Any = None) -> None:
    print_json({"ok": True, "data": data})
