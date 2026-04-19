"""Run the WeChat customer service webhook server."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    host = os.getenv("WECHAT_KF_WEBHOOK_HOST", "0.0.0.0")
    port = int(os.getenv("WECHAT_KF_WEBHOOK_PORT", "8020"))
    uvicorn.run("robot.wechat_kf.webhook:app", host=host, port=port)


if __name__ == "__main__":
    main()
