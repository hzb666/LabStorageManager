"""Run the WeCom AI Bot WebSocket worker."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from robot.wecom_aibot.worker import main


if __name__ == "__main__":
    asyncio.run(main())

