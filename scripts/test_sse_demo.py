"""SSE demo smoke test script.

This script validates the SSE flow end-to-end against scripts/sse_demo_server.py:
1) Connect to /api/events stream.
2) Confirm 'connected' event arrives.
3) Publish a demo event.
4) Assert the expected event and payload are received.

Run:
    .venv\\Scripts\\python.exe scripts/test_sse_demo.py
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from dataclasses import dataclass
from queue import Empty, Queue
from typing import Any, Optional

import requests


@dataclass
class SSEMessage:
    event: str
    data: dict[str, Any]


def _read_sse_stream(stream_url: str, out_queue: Queue[SSEMessage], stop_flag: threading.Event) -> None:
    """Consume SSE stream and push parsed messages into queue."""
    with requests.get(stream_url, stream=True, timeout=30) as response:
        response.raise_for_status()

        current_event: Optional[str] = None
        current_data: Optional[str] = None

        for raw_line in response.iter_lines(decode_unicode=True):
            if stop_flag.is_set():
                break
            if raw_line is None:
                continue

            line = raw_line.strip()
            if not line:
                # 空行标记一个事件结束。
                if current_event and current_data:
                    try:
                        payload = json.loads(current_data)
                    except json.JSONDecodeError:
                        payload = {"raw": current_data}
                    out_queue.put(SSEMessage(event=current_event, data=payload))
                current_event = None
                current_data = None
                continue

            if line.startswith(":"):
                # 心跳或注释行。
                continue
            if line.startswith("event:"):
                current_event = line.split(":", 1)[1].strip()
                continue
            if line.startswith("data:"):
                current_data = line.split(":", 1)[1].strip()
                continue


def _wait_for_event(
    msg_queue: Queue[SSEMessage],
    event_name: str,
    timeout_seconds: float,
) -> SSEMessage:
    """Wait until target event appears or timeout."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        remaining = max(0.05, deadline - time.time())
        try:
            message = msg_queue.get(timeout=remaining)
        except Empty:
            continue
        if message.event == event_name:
            return message
    raise TimeoutError(f"Timeout waiting event: {event_name}")


def main() -> int:
    parser = argparse.ArgumentParser(description="SSE demo smoke test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8010", help="Demo server base URL")
    parser.add_argument("--room", default="inventory", help="Room name")
    parser.add_argument("--event", default="inventory.updated", help="Event name to publish")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")

    # 检查 demo 服务是否就绪。
    health = requests.get(f"{base_url}/api/sse-demo/health", timeout=5)
    health.raise_for_status()

    stream_url = f"{base_url}/api/events?rooms={args.room}"
    queue: Queue[SSEMessage] = Queue()
    stop_flag = threading.Event()

    reader = threading.Thread(
        target=_read_sse_stream,
        args=(stream_url, queue, stop_flag),
        daemon=True,
    )
    reader.start()

    connected = _wait_for_event(queue, "connected", timeout_seconds=8)
    print("[OK] connected:", connected.data)

    test_payload = {
        "action": "update",
        "item_id": 10001,
        "item": {
            "id": 10001,
            "name": "SSE Demo Item",
            "notes": "from smoke test",
        },
    }

    publish_resp = requests.post(
        f"{base_url}/api/sse-demo/publish",
        json={
            "room": args.room,
            "event": args.event,
            "data": test_payload,
        },
        timeout=8,
    )
    publish_resp.raise_for_status()
    print("[OK] publish:", publish_resp.json())

    received = _wait_for_event(queue, args.event, timeout_seconds=8)
    print("[OK] received:", received.data)

    if received.data.get("data", {}).get("item_id") != 10001:
        raise AssertionError("item_id mismatch in received event")

    print("[PASS] SSE demo smoke test passed")

    stop_flag.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
