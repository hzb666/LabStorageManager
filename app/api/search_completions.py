"""搜索补全预测 API。"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.database import DBSession
from app.models.user import User
from app.search_completion_db import (
    TARGET_ENDPOINTS,
    get_user_preferences,
    increment_feedback,
    upsert_user_preferences,
)
from app.services.search_completion_entity_index import rebuild_completion_entity_index_if_stale
from app.services.search_completion_ranker import InlineCompletionRequest, get_inline_completion
from app.services.sql_utils import normalize_search_term

router = APIRouter(prefix="/search-completions", tags=["Search Completions"])
logger = logging.getLogger(__name__)
ALL_SEARCH_FIELD = "all"


# ---------- 数据模型 ----------


class InlineCompletionResponse(BaseModel):
    completion: str | None = None
    suffix: str | None = None
    confidence: float = 0.0
    source: str | None = None
    personalized: bool = False


class SearchPreferencesResponse(BaseModel):
    personalization_enabled: bool


class SearchPreferencesUpdate(BaseModel):
    personalization_enabled: bool


class CompletionFeedbackRequest(BaseModel):
    endpoint: str
    field: str = "all"
    query: str
    accepted: bool


# ---------- 接口 ----------


@router.get("/preferences", response_model=SearchPreferencesResponse)
def get_preferences(current_user: User = Depends(get_current_user)):
    prefs = get_user_preferences(current_user.id)
    return SearchPreferencesResponse(personalization_enabled=prefs.personalization_enabled)


@router.put("/preferences", response_model=SearchPreferencesResponse)
def update_preferences(
    body: SearchPreferencesUpdate,
    current_user: User = Depends(get_current_user),
):
    prefs = upsert_user_preferences(current_user.id, body.personalization_enabled)
    return SearchPreferencesResponse(personalization_enabled=prefs.personalization_enabled)


@router.get("/inline", response_model=InlineCompletionResponse)
def get_inline_completion_endpoint(
    endpoint: str,
    q: str,
    db: DBSession,
    field: str = "all",
    current_user: User = Depends(get_current_user),
):
    if endpoint not in TARGET_ENDPOINTS:
        return InlineCompletionResponse()
    if field != ALL_SEARCH_FIELD:
        return InlineCompletionResponse()
    if len(q.strip()) < 1:
        return InlineCompletionResponse()
    if " " in q:
        return InlineCompletionResponse()

    rebuild_completion_entity_index_if_stale(db, endpoint)

    result = get_inline_completion(InlineCompletionRequest(
        user_id=current_user.id,
        endpoint=endpoint,
        field=field,
        prefix=q.strip(),
    ))
    return InlineCompletionResponse(
        completion=result.completion,
        suffix=result.suffix,
        confidence=result.confidence,
        source=result.source,
        personalized=result.personalized,
    )


@router.post("/feedback")
def submit_feedback(
    body: CompletionFeedbackRequest,
    current_user: User = Depends(get_current_user),
):
    if body.endpoint not in TARGET_ENDPOINTS:
        return {"ok": True}
    if body.field != ALL_SEARCH_FIELD:
        return {"ok": True}

    normalized = normalize_search_term(body.query.strip()).casefold()
    if not normalized:
        return {"ok": True}

    search_field = body.field if body.field and body.field != "all" else None
    prefs = get_user_preferences(current_user.id)
    user_id = current_user.id if prefs.personalization_enabled else None

    increment_feedback(
        user_id=user_id,
        endpoint=body.endpoint,
        search_field=search_field,
        normalized_query=normalized,
        accepted=body.accepted,
    )
    return {"ok": True}
