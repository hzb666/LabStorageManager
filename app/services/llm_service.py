"""LLM service adapter with OpenAI-compatible responses API."""

from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class LLMTimeoutError(Exception):
    """Raised when LLM request times out."""


class LLMService:
    def __init__(self) -> None:
        self.api_key = settings.openai_api_key
        self.model = settings.openai_model
        self.timeout_seconds = settings.llm_timeout_seconds

    async def generate_reply(
        self,
        system_prompt: str,
        summary: str,
        history: list[dict[str, str]],
        user_input: str,
    ) -> str:
        if not self.api_key:
            logger.warning("OPENAI_API_KEY is missing, return fallback message")
            return "我在认真听你说，请再多告诉我一点。"

        instructions = f"{system_prompt}\n\n用户长期记忆摘要：{summary or '暂无'}"
        messages = history + [{"role": "user", "content": user_input}]
        payload = {
            "model": self.model,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": instructions}]},
                *[
                    {"role": item["role"], "content": [{"type": "input_text", "text": item["content"]}]}
                    for item in messages
                ],
            ],
            "temperature": 0.4,
            "max_output_tokens": 300,
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        # 被动回复场景必须快速返回，默认单次请求避免超时累计放大。
        attempts = 1
        for attempt in range(1, attempts + 1):
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                    response = await client.post(
                        "https://api.openai.com/v1/responses",
                        json=payload,
                        headers=headers,
                    )
                    response.raise_for_status()
                    data = response.json()
                    text = data.get("output_text")
                    if text:
                        return text.strip()
                    return "我收到了你的消息，我们继续聊。"
            except httpx.TimeoutException as exc:
                logger.warning("LLM timeout attempt=%s", attempt)
                if attempt == attempts:
                    raise LLMTimeoutError from exc
            except Exception:
                logger.exception("LLM call failed, using fallback")
                if attempt == attempts:
                    return "我刚刚有点忙不过来，请稍后再发我一次。"

        return "我收到了，我们继续。"

    async def summarize_memory(self, history: list[dict[str, str]], previous_summary: str) -> str:
        history_text = "\n".join([f"{item['role']}: {item['content']}" for item in history[-30:]])
        prompt = (
            "请把对话总结成稳定事实、长期偏好、未完成事项，中文简洁输出。\n"
            f"旧摘要：{previous_summary or '无'}\n"
            f"对话：\n{history_text}"
        )
        return await self.generate_reply(
            system_prompt="你是记忆整理助手，只输出摘要文本。",
            summary="",
            history=[],
            user_input=prompt,
        )
