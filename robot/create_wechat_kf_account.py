"""Create a WeChat customer service account through API management."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from robot.wechat_kf.client import WechatKfClient
from robot.wechat_kf.config import get_settings

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_AVATAR_PATH = REPO_ROOT / "robot" / "tx.png"
ENV_PATH = REPO_ROOT / "robot" / ".env"


async def _main() -> int:
    parser = argparse.ArgumentParser(description="Create WeChat customer service account")
    parser.add_argument("--name", default="实验室库存助手", help="KF account display name")
    parser.add_argument("--avatar", default=str(DEFAULT_AVATAR_PATH), help="Avatar image path")
    parser.add_argument("--write-env", action="store_true", help="Write open_kfid into robot/.env")
    parser.add_argument("--json", action="store_true", help="Print full API response as JSON")
    args = parser.parse_args()

    settings = get_settings()
    settings.require_api()
    avatar_path = Path(args.avatar).expanduser().resolve()
    if not avatar_path.is_file():
        print(f"Avatar file not found: {avatar_path}", file=sys.stderr)
        return 2

    client = WechatKfClient(
        corp_id=settings.corp_id,
        secret=settings.secret,
        api_base_url=settings.api_base_url,
    )
    upload_result = await client.upload_image(avatar_path)
    media_id = _read_media_id(upload_result)
    account_result = await client.add_account(name=args.name.strip(), media_id=media_id)
    if args.json:
        print(json.dumps({"upload": upload_result, "account": account_result}, ensure_ascii=False, indent=2))
    else:
        open_kfid = account_result.get("open_kfid")
        print(f"open_kfid={open_kfid}")
    if args.write_env:
        open_kfid = account_result.get("open_kfid")
        if not isinstance(open_kfid, str) or not open_kfid:
            print("API response did not include open_kfid; robot/.env not updated", file=sys.stderr)
            return 1
        _upsert_env("WECHAT_KF_OPEN_KFID", open_kfid)
        print("WECHAT_KF_OPEN_KFID updated in robot/.env")
    return 0


def _read_media_id(result: dict[str, object]) -> str:
    media_id = result.get("media_id")
    if not isinstance(media_id, str) or not media_id:
        raise RuntimeError("Upload response did not include media_id")
    return media_id


def _upsert_env(key: str, value: str) -> None:
    ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    prefix = f"{key}="
    replacement = f'{key}="{value}"'
    for index, line in enumerate(lines):
        if line.strip().startswith(prefix):
            lines[index] = replacement
            break
    else:
        lines.append(replacement)
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    raise SystemExit(asyncio.run(_main()))


if __name__ == "__main__":
    main()
