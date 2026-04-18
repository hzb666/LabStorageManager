"""Run the WeCom AI Bot webhook server."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    host = os.getenv("WECOM_AIBOT_WEBHOOK_HOST", "0.0.0.0")
    port = int(os.getenv("WECOM_AIBOT_WEBHOOK_PORT", "8010"))
    uvicorn.run("robot.wecom_aibot.webhook:app", host=host, port=port)


if __name__ == "__main__":
    main()

