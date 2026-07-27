"""Background structure cache resolution triggers."""
from __future__ import annotations

import logging

from fastapi import BackgroundTasks
from sqlmodel import Session

from app.core.config import settings
from app.database import engine
from app.services.cas_utils import BIOLOGICAL_REAGENT_CAS, normalize_cas, validate_cas_format
from app.services.structure_resolution_jobs import enqueue_structure_resolution_job
from app.services.structure_resolution_scheduler import structure_resolution_scheduler

logger = logging.getLogger(__name__)


def enqueue_structure_cache_resolution(
    _background_tasks: BackgroundTasks,
    cas_number: str | None,
    *,
    reason: str,
) -> bool:
    normalized_cas = _normalize_resolvable_cas(cas_number)
    if normalized_cas is None:
        return False
    if not settings.chem_structure_feature_enabled or not settings.chem_resolver_pubchem_enabled:
        return False

    try:
        with Session(engine) as db:
            created = enqueue_structure_resolution_job(
                db,
                normalized_cas,
                trigger_reason=reason,
            )
            db.commit()
    except Exception:
        logger.exception(
            "structure_resolution_job enqueue=failed cas=%s reason=%s",
            normalized_cas,
            reason,
        )
        return False
    if created:
        structure_resolution_scheduler.notify()
    return created


def _normalize_resolvable_cas(cas_number: str | None) -> str | None:
    normalized_cas = normalize_cas(cas_number)
    if not normalized_cas or normalized_cas == BIOLOGICAL_REAGENT_CAS:
        return None

    is_valid, _error = validate_cas_format(normalized_cas)
    return normalized_cas if is_valid else None
