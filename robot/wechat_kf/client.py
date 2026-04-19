"""HTTP client for WeChat customer service APIs."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

import requests

from robot.wecom_aibot.replies import clamp_text

MAX_WECHAT_KF_TEXT_CHARS = 2000


class WechatKfApiError(RuntimeError):
    """Raised when WeChat customer service API returns an error."""


@dataclass
class WechatKfClient:
    corp_id: str
    secret: str
    api_base_url: str = "https://qyapi.weixin.qq.com"
    timeout_seconds: float = 15.0
    _access_token: str = field(default="", init=False)
    _expires_at: int = field(default=0, init=False)

    async def sync_msg(
        self,
        *,
        token: str,
        cursor: str = "",
        open_kfid: str = "",
        limit: int = 100,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"token": token, "cursor": cursor, "limit": limit}
        if open_kfid:
            body["open_kfid"] = open_kfid
        return await self._post("/cgi-bin/kf/sync_msg", body)

    async def send_text(self, *, touser: str, open_kfid: str, content: str) -> dict[str, Any]:
        body = {
            "touser": touser,
            "open_kfid": open_kfid,
            "msgtype": "text",
            "text": {"content": clamp_text(content, MAX_WECHAT_KF_TEXT_CHARS)},
        }
        return await self._post("/cgi-bin/kf/send_msg", body)

    async def add_contact_way(self, *, open_kfid: str, scene: str) -> dict[str, Any]:
        body: dict[str, Any] = {"open_kfid": open_kfid, "scene": scene}
        return await self._post("/cgi-bin/kf/add_contact_way", body)

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        access_token = await self._get_access_token()
        return await asyncio.to_thread(self._post_sync, path, access_token, body)

    async def _get_access_token(self) -> str:
        if self._access_token and time.time() < self._expires_at - 60:
            return self._access_token
        data = await asyncio.to_thread(self._get_token_sync)
        self._access_token = _required_text(data, "access_token")
        self._expires_at = int(time.time()) + int(data.get("expires_in") or 7200)
        return self._access_token

    def _get_token_sync(self) -> dict[str, Any]:
        response = requests.get(
            self._url("/cgi-bin/gettoken"),
            params={"corpid": self.corp_id, "corpsecret": self.secret},
            timeout=self.timeout_seconds,
        )
        return _checked_response(response)

    def _post_sync(self, path: str, access_token: str, body: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            self._url(path),
            params={"access_token": access_token},
            json=body,
            timeout=self.timeout_seconds,
        )
        return _checked_response(response)

    def _url(self, path: str) -> str:
        return self.api_base_url.rstrip("/") + path


def _checked_response(response: requests.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError as exc:
        raise WechatKfApiError("WeChat KF API returned non-JSON response") from exc
    if not isinstance(data, dict):
        raise WechatKfApiError("WeChat KF API returned invalid response")
    errcode = data.get("errcode")
    if errcode not in (None, 0):
        raise WechatKfApiError(f"WeChat KF API failed errcode={errcode}")
    return data


def _required_text(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise WechatKfApiError(f"WeChat KF API response missing {key}")
    return value
