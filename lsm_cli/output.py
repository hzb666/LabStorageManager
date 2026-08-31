from __future__ import annotations

import json
import sys
from typing import Any

OUTPUT_ENCODING = "utf-8"


def configure_output_encoding() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if not callable(reconfigure):
            continue
        try:
            reconfigure(encoding=OUTPUT_ENCODING)
        except (AttributeError, OSError, ValueError):
            continue


def print_json(payload: Any) -> None:
    configure_output_encoding()
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
