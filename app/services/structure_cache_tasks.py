"""Background structure cache resolution triggers."""
from __future__ import annotations

import logging
from threading import Lock

from fastapi import BackgroundTasks
from sqlmodel import Session

from app.core.config import settings
from app.database import engine
from app.services.cas_utils import BIOLOGICAL_REAGENT_CAS, normalize_cas, validate_cas_format
from app.services.structure_cache_workflow import StructureWorkflowError, resolve_cas_to_cache

logger = logging.getLogger(__name__)

_inflight_cas_numbers: set[str] = set()
_inflight_lock = Lock()


def enqueue_structure_cache_resolution(
    background_tasks: BackgroundTasks,
    cas_number: str | None,
    *,
    reason: str,
) -> bool:
    normalized_cas = _normalize_resolvable_cas(cas_number)
    if normalized_cas is None:
        return False

    with _inflight_lock:
        if normalized_cas in _inflight_cas_numbers:
            return False
        _inflight_cas_numbers.add(normalized_cas)

    background_tasks.add_task(_resolve_structure_cache_background, normalized_cas, reason)
    return True


def _normalize_resolvable_cas(cas_number: str | None) -> str | None:
    normalized_cas = normalize_cas(cas_number)
    if not normalized_cas or normalized_cas == BIOLOGICAL_REAGENT_CAS:
        return None

    is_valid, _error = validate_cas_format(normalized_cas)
    return normalized_cas if is_valid else None


async def _resolve_structure_cache_background(cas_number: str, reason: str) -> None:
    try:
        if not settings.chem_structure_feature_enabled or not settings.chem_resolver_pubchem_enabled:
            logger.debug("structure_cache_auto_resolve_skipped cas=%s reason=%s", cas_number, reason)
            return

        with Session(engine) as db:
            await resolve_cas_to_cache(
                db,
                cas_number=cas_number,
                force=False,
                overwrite_manual=False,
            )
        logger.info("structure_cache_auto_resolve_finished cas=%s reason=%s", cas_number, reason)
    except StructureWorkflowError as exc:
        logger.warning(
            "structure_cache_auto_resolve_failed cas=%s reason=%s error=%s",
            cas_number,
            reason,
            exc,
        )
    except Exception:
        logger.exception("structure_cache_auto_resolve_unhandled cas=%s reason=%s", cas_number, reason)
    finally:
        with _inflight_lock:
            _inflight_cas_numbers.discard(cas_number)
