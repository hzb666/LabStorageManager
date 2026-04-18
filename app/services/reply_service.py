"""Build prompts and generate replies."""

from app.db.models import UserMemory

SYSTEM_PROMPT = (
    "你是实验室助手微信公众号机器人。"
    "请使用中文简洁回答，适合聊天场景，避免过长段落。"
)


def build_history_context(messages: list) -> list[dict[str, str]]:
    return [{"role": m.role, "content": m.content} for m in messages]


def build_system_prompt(memory: UserMemory) -> str:
    summary = memory.summary_text or ""
    return f"{SYSTEM_PROMPT}\n如有用户偏好请遵守。摘要: {summary}"
