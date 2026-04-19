"""Print a WeChat customer service contact link."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from robot.wechat_kf.client import WechatKfClient
from robot.wechat_kf.config import get_settings


async def _main() -> int:
    parser = argparse.ArgumentParser(description="Get WeChat customer service contact link")
    parser.add_argument("--scene", default="lsm", help="Scene string, default: lsm")
    parser.add_argument("--scene-param", default="", help="Optional scene parameter appended to URL")
    parser.add_argument("--json", action="store_true", help="Print full API response as JSON")
    args = parser.parse_args()

    settings = get_settings()
    settings.require_api()
    if not settings.open_kfid:
        print("WECHAT_KF_OPEN_KFID is missing in robot/.env", file=sys.stderr)
        return 2

    client = WechatKfClient(
        corp_id=settings.corp_id,
        secret=settings.secret,
        api_base_url=settings.api_base_url,
    )
    result = await client.add_contact_way(
        open_kfid=settings.open_kfid,
        scene=args.scene,
    )
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    url = result.get("url")
    if not isinstance(url, str) or not url:
        print("WeChat KF API response did not include url", file=sys.stderr)
        print(json.dumps(result, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print(_append_scene_param(url, args.scene_param))
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(_main()))


def _append_scene_param(url: str, scene_param: str) -> str:
    if not scene_param:
        return url
    parts = urlsplit(url)
    query = "&".join(part for part in [parts.query, urlencode({"scene_param": scene_param})] if part)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


if __name__ == "__main__":
    main()
