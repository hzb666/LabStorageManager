"""LLM client used by the Wechat bot."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
DEFAULT_FALLBACK_REPLY = "我现在有点忙，请稍后再试。"


class WechatLLMService:
    """Small wrapper around the OpenAI Responses API."""

    async def generate_reply(
        self,
        *,
        memory_summary: str,
        history: list[dict[str, str]],
        user_input: str,
    ) -> str:
        """Generate a short assistant reply with a strict request timeout."""

        if not settings.openai_api_key:
            return DEFAULT_FALLBACK_REPLY

        payload = _build_payload(
            memory_summary=memory_summary,
            history=history,
            user_input=user_input,
        )
        try:
            data = await asyncio.to_thread(_post_responses_api, payload)
        except requests.Timeout:
            logger.warning("Wechat LLM request timed out")
            return DEFAULT_FALLBACK_REPLY
        except requests.RequestException as exc:
            logger.warning("Wechat LLM request failed: %s", type(exc).__name__)
            return DEFAULT_FALLBACK_REPLY

        reply = _extract_output_text(data).strip()
        return reply or DEFAULT_FALLBACK_REPLY

    async def summarize_memory(self, *, messages: list[str], previous_summary: str) -> str:
        """Summarize recent conversation for future replies."""

        if not settings.openai_api_key or not messages:
            return previous_summary

        payload = {
            "model": settings.openai_model,
            "instructions": (
                "Summarize stable user preferences and useful context in Chinese. "
                "Do not include secrets, raw identifiers, or transient details."
            ),
            "input": "\n".join([previous_summary, *messages])[-8000:],
            "max_output_tokens": settings.wechat_memory_max_output_tokens,
        }
        try:
            data = await asyncio.to_thread(_post_responses_api, payload)
        except requests.RequestException as exc:
            logger.warning("Wechat memory summary failed: %s", type(exc).__name__)
            return previous_summary
        return _extract_output_text(data).strip() or previous_summary


def _post_responses_api(payload: dict[str, Any]) -> dict[str, Any]:
    response = requests.post(
        OPENAI_RESPONSES_URL,
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=settings.wechat_llm_timeout_seconds,
    )
    response.raise_for_status()
    return response.json()


def _build_payload(
    *,
    memory_summary: str,
    history: list[dict[str, str]],
    user_input: str,
) -> dict[str, Any]:
    instructions = (
        "You are the Lab Storage Manager Wechat assistant. Reply in concise Chinese. "
        "Help users with lab inventory, reagent, consumable, and workflow questions. "
        "If unsure, say what information is needed instead of inventing facts."
    )
    if memory_summary:
        instructions = f"{instructions}\nKnown user context:\n{memory_summary}"

    input_messages: list[dict[str, str]] = [*history[-settings.wechat_history_message_limit :]]
    input_messages.append({"role": "user", "content": user_input})
    return {
        "model": settings.openai_model,
        "instructions": instructions,
        "input": input_messages,
        "max_output_tokens": settings.wechat_reply_max_output_tokens,
    }


def _extract_output_text(data: dict[str, Any]) -> str:
    output_text = data.get("output_text")
    if isinstance(output_text, str):
        return output_text

    chunks: list[str] = []
    for item in data.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str):
                chunks.append(text)
    return "".join(chunks)
