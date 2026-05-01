# 化学物质信息查询服务。
import re
import time
import random
import logging
import hashlib
from urllib.parse import quote, urlparse
import requests
from typing import Optional, Dict, Any
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.core.config import settings
from app.core.constants import (
    CHEMICAL_INFO_FALLBACK_FUTURE_TIMEOUT_SECONDS,
    CHEMICAL_INFO_PRIMARY_FUTURE_TIMEOUT_SECONDS,
    CHEMICAL_INFO_RATE_LIMIT_DELAY_SECONDS,
    CHEMICAL_INFO_CACHE_MAX_SIZE,
    CHEMICAL_INFO_CACHE_TTL_SECONDS,
    MIN_REQUEST_TIMEOUT_SECONDS,
    TRANSLATED_NAME_SUFFIX,
)
from app.core.auth import get_current_user
from app.database import DBSession
from app.models.compound_structure import CompoundStructureCache
from app.services.cas_utils import validate_and_normalize_cas, is_special_cas_value
from app.services.structure_cache_repo import (
    StructureNameCacheWrite,
    get_structure_cache,
    upsert_structure_cache_names,
)

logger = logging.getLogger(__name__)
PUBCHEM_PRIMARY_TIMEOUT_SECONDS = 3
PUBCHEM_FALLBACK_BUDGET_SECONDS = 1
router = APIRouter(prefix="/chemical-info", tags=["Chemical Info"])

# 随机 User-Agent 池
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
]

# 简单内存缓存（带大小限制的 LRU）
_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_ORDER: list = []  # 记录访问顺序
_ALLOWED_OUTBOUND_HOSTS = {
    "www.chemblink.com",
    "chemblink.com",
    "pubchem.ncbi.nlm.nih.gov",
    "api.niutrans.com",
}


def _get_headers() -> Dict[str, str]:
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Connection": "keep-alive",
    }


def _safe_get(url: str, timeout: float):
    # 禁止跟随重定向，避免白名单域名再跳到非预期目标。
    if not _is_safe_outbound_url(url):
        raise requests.RequestException(f"Unsafe outbound URL blocked: {url}")
    return requests.get(url, headers=_get_headers(), timeout=timeout, allow_redirects=False)


def _safe_post(url: str, data: Dict[str, str], timeout: float):
    # 禁止跟随重定向，避免白名单域名再跳到非预期目标。
    if not _is_safe_outbound_url(url):
        raise requests.RequestException(f"Unsafe outbound URL blocked: {url}")
    return requests.post(url, data=data, timeout=timeout, allow_redirects=False)


def _is_safe_outbound_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            return False

        hostname = (parsed.hostname or "").lower()
        if not hostname or hostname not in _ALLOWED_OUTBOUND_HOSTS:
            return False

        return True
    except Exception:
        return False


def _format_exception_message(exc: Exception) -> str:
    message = str(exc).strip()
    if message:
        return f"{exc.__class__.__name__}: {message}"
    return exc.__class__.__name__


def _get_cached(cas_number: str) -> Optional[Dict[str, Any]]:
    if cas_number in _CACHE:
        cached_data, cached_time = _CACHE[cas_number]
        if time.time() - cached_time < CHEMICAL_INFO_CACHE_TTL_SECONDS:
            if cas_number in _CACHE_ORDER:
                _CACHE_ORDER.remove(cas_number)
            _CACHE_ORDER.append(cas_number)
            return cached_data
        else:
            del _CACHE[cas_number]
            if cas_number in _CACHE_ORDER:
                _CACHE_ORDER.remove(cas_number)
    return None


def _set_cached(cas_number: str, data: Dict[str, Any]) -> None:
    if cas_number in _CACHE:
        del _CACHE[cas_number]
        if cas_number in _CACHE_ORDER:
            _CACHE_ORDER.remove(cas_number)

    while len(_CACHE) >= CHEMICAL_INFO_CACHE_MAX_SIZE and _CACHE_ORDER:
        oldest = _CACHE_ORDER.pop(0)
        if oldest in _CACHE:
            del _CACHE[oldest]

    _CACHE[cas_number] = (data, time.time())
    _CACHE_ORDER.append(cas_number)


def _remaining_timeout(deadline: float) -> Optional[float]:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None
    # requests 要求 timeout > 0。
    return max(MIN_REQUEST_TIMEOUT_SECONDS, remaining)


def _parse_chinese_name(content: str) -> Optional[str]:
    if "404" in content[:500] or "File Not Found" in content[:500]:
        return None

    match = re.search(r"<h1[^>]*>\s*([^<\n]+?)\s*<br>", content)
    if match:
        return match.group(1).strip()

    match = re.search(r"<title>\s*CAS 登录号：([^,]+),\s*([^,]+),\s*([^-]+)\s*- chemBlink", content)
    if match:
        return match.group(2).strip()

    match = re.search(r"产品名称</td>\s*<td>([^<]+)</td>", content)
    if match:
        return match.group(1).strip()

    return None


def query_chinese_name(cas_number: str) -> Optional[str]:
    cas = str(cas_number).strip()
    if not cas:
        return None

    cached = _get_cached(cas)
    if cached and cached.get("chinese_name"):
        return cached["chinese_name"]

    urls = [
        f"https://www.chemblink.com/zh/products/{cas}C.htm",
        f"https://www.chemblink.com/zh/moreProducts/more{cas}C.htm",
    ]

    chinese_name: Optional[str] = None

    def fetch_and_parse(url: str) -> Optional[str]:
        try:
            response = _safe_get(url, timeout=3)
            if response.status_code == 200:
                content = response.content.decode("utf-8", errors="ignore")
                return _parse_chinese_name(content)
        except Exception as e:
            logger.warning(f"Failed to query chemblink {url} for CAS {cas}: {e}")
        return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(fetch_and_parse, urls))

    chinese_name = results[0] if results else None
    if not chinese_name and len(results) > 1:
        chinese_name = results[1]

    # 保持轻微节流，避免被外部站点按高频抓取封禁。
    time.sleep(CHEMICAL_INFO_RATE_LIMIT_DELAY_SECONDS)

    return chinese_name


def _extract_iupac_name(data: Dict[str, Any]) -> Optional[str]:
    properties = data.get("PropertyTable", {}).get("Properties", [])
    if properties and properties[0].get("IUPACName"):
        return properties[0]["IUPACName"]
    return None


def _query_pubchem_primary(cas: str, encoded_cas: str) -> tuple[Optional[str], Optional[str]]:
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded_cas}/property/IUPACName/JSON"
    try:
        response = _safe_get(url, timeout=PUBCHEM_PRIMARY_TIMEOUT_SECONDS)
        if response.status_code != 200:
            return None, f"主查询 HTTP {response.status_code}"

        english_name = _extract_iupac_name(response.json())
        if english_name:
            return english_name, None
        return None, "主查询返回成功但未包含 IUPACName"
    except Exception as exc:
        logger.warning(f"Failed to query PubChem for CAS {cas}: {exc}")
        return None, f"主查询异常：{_format_exception_message(exc)}"


def _safe_get_with_deadline(url: str, deadline: float) -> tuple[Optional[requests.Response], Optional[str]]:
    timeout = _remaining_timeout(deadline)
    if timeout is None:
        return None, f"补充查询超时（最多 {PUBCHEM_FALLBACK_BUDGET_SECONDS} 秒）"
    return _safe_get(url, timeout=timeout), None


def _query_pubchem_fallback(cas: str, encoded_cas: str) -> tuple[Optional[str], Optional[str]]:
    deadline = time.monotonic() + PUBCHEM_FALLBACK_BUDGET_SECONDS
    cid_url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded_cas}/cids/JSON"
    english_name: Optional[str] = None
    failure_reason: Optional[str] = None

    try:
        cid_response, failure_reason = _safe_get_with_deadline(cid_url, deadline)
        if failure_reason is None and cid_response is not None:
            if cid_response.status_code != 200:
                failure_reason = f"补充 CID 查询 HTTP {cid_response.status_code}"
            else:
                cids = cid_response.json().get("IdentifierList", {}).get("CID", [])
                if not cids:
                    failure_reason = "补充 CID 查询成功但未返回 CID"
                else:
                    property_url = (
                        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cids[0]}/property/IUPACName/JSON"
                    )
                    property_response, failure_reason = _safe_get_with_deadline(property_url, deadline)
                    if failure_reason is None and property_response is not None:
                        if property_response.status_code != 200:
                            failure_reason = f"补充属性查询 HTTP {property_response.status_code}"
                        else:
                            english_name = _extract_iupac_name(property_response.json())
                            if english_name is None:
                                failure_reason = "补充查询返回成功但未包含 IUPACName"
        elif failure_reason is None:
            failure_reason = "补充 CID 查询失败"
    except Exception as exc:
        logger.warning(f"Failed to query PubChem CID for CAS {cas}: {exc}")
        failure_reason = f"补充查询异常：{_format_exception_message(exc)}"

    return english_name, failure_reason

def _build_pubchem_warning(*failure_reasons: Optional[str]) -> str:
    warning_parts = [reason for reason in failure_reasons if reason]
    if not warning_parts:
        warning_parts.append("未命中可用结果")
    return "PubChem 未获取英文名：" + "；".join(warning_parts)


def query_english_name(cas_number: str) -> tuple[Optional[str], Optional[str]]:
    cas = str(cas_number).strip()
    if not cas:
        return None, None

    cached = _get_cached(cas)
    if cached and cached.get("english_name"):
        return cached["english_name"], None

    encoded_cas = quote(cas, safe="")

    english_name, primary_failure_reason = _query_pubchem_primary(cas, encoded_cas)
    fallback_failure_reason: Optional[str] = None
    if not english_name:
        english_name, fallback_failure_reason = _query_pubchem_fallback(cas, encoded_cas)

    # 保持轻微节流，避免被外部站点按高频抓取封禁。
    time.sleep(CHEMICAL_INFO_RATE_LIMIT_DELAY_SECONDS)

    warning_message = None
    if not english_name:
        warning_message = _build_pubchem_warning(primary_failure_reason, fallback_failure_reason)

    return (english_name if english_name else None), warning_message


def _get_cache_smiles(cache: CompoundStructureCache | None) -> Optional[str]:
    if cache is None:
        return None
    return cache.smiles_canonical or cache.smiles_isomeric


def _cache_to_chemical_info(cas: str, cache: CompoundStructureCache | None) -> Dict[str, Any]:
    if cache is None:
        return {
            "cas_number": cas,
            "name": None,
            "english_name": None,
            "warning": None,
            "smiles": None,
            "chinese_name_is_translated": False,
        }

    return {
        "cas_number": cas,
        "name": cache.chinese_name,
        "english_name": cache.english_name,
        "warning": cache.name_error_message,
        "smiles": _get_cache_smiles(cache),
        "chinese_name_is_translated": cache.chinese_name_is_translated,
    }


def _set_chemical_info_memory_cache(cas: str, result: Dict[str, Any]) -> None:
    _set_cached(cas, {
        "chinese_name": result.get("name"),
        "english_name": result.get("english_name"),
        "warning": result.get("warning"),
        "smiles": result.get("smiles"),
        "chinese_name_is_translated": result.get("chinese_name_is_translated"),
    })


def _has_required_names(result: Dict[str, Any], *, skip_chinese: bool) -> bool:
    if skip_chinese:
        return bool(result.get("english_name"))
    return bool(result.get("name")) and bool(result.get("english_name"))


def _query_chinese_name_safely(cas: str) -> Optional[str]:
    try:
        return query_chinese_name(cas)
    except Exception as exc:
        logger.warning(f"Failed to get Chinese name for CAS {cas}: {exc}")
        return None


def _query_english_name_safely(cas: str) -> tuple[Optional[str], Optional[str]]:
    try:
        return query_english_name(cas)
    except Exception as exc:
        logger.warning(f"Failed to get English name for CAS {cas}: {exc}")
        return None, "英文名查询超时，已跳过 PubChem 补充识别"


def _query_missing_external_names(
    cas: str,
    *,
    need_chinese: bool,
    need_english: bool,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    if need_chinese and need_english:
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_chinese = executor.submit(query_chinese_name, cas)
            future_english = executor.submit(query_english_name, cas)
            chinese_name = _read_chinese_future(cas, future_chinese)
            english_name, warning_message = _read_english_future(cas, future_english)
        return chinese_name, english_name, warning_message

    chinese_name = _query_chinese_name_safely(cas) if need_chinese else None
    if need_english:
        english_name, warning_message = _query_english_name_safely(cas)
        return chinese_name, english_name, warning_message
    return chinese_name, None, None


def _read_chinese_future(cas: str, future) -> Optional[str]:
    try:
        return future.result(timeout=CHEMICAL_INFO_PRIMARY_FUTURE_TIMEOUT_SECONDS)
    except Exception as exc:
        logger.warning(f"Failed to get Chinese name for CAS {cas}: {exc}")
        return None


def _read_english_future(cas: str, future) -> tuple[Optional[str], Optional[str]]:
    try:
        return future.result(timeout=CHEMICAL_INFO_FALLBACK_FUTURE_TIMEOUT_SECONDS)
    except Exception as exc:
        logger.warning(f"Failed to get English name for CAS {cas}: {exc}")
        return None, "英文名查询超时，已跳过 PubChem 补充识别"


def _fill_translated_chinese_name(
    cas: str,
    *,
    chinese_name: Optional[str],
    english_name: Optional[str],
) -> tuple[Optional[str], bool]:
    if chinese_name or not english_name:
        return chinese_name, False

    logger.info(
        "Chinese name not found for CAS %s, trying to translate English name: %s",
        cas,
        english_name,
    )
    translated_name = translate_text(english_name)
    if not translated_name:
        return None, False

    result = f"{translated_name}{TRANSLATED_NAME_SUFFIX}"
    logger.info(f"Translated Chinese name for CAS {cas}: {result}")
    return result, True


def _resolve_and_store_missing_names(
    db: Session,
    cas: str,
    result: Dict[str, Any],
    *,
    skip_chinese: bool,
) -> Dict[str, Any]:
    need_chinese = not skip_chinese and not result.get("name")
    need_english = not result.get("english_name")
    chinese_name, english_name, warning_message = _query_missing_external_names(
        cas,
        need_chinese=need_chinese,
        need_english=need_english,
    )

    resolved_chinese_name = result.get("name") or chinese_name
    resolved_english_name = result.get("english_name") or english_name
    chinese_name_is_translated = bool(result.get("chinese_name_is_translated"))
    if need_chinese:
        resolved_chinese_name, chinese_name_is_translated = _fill_translated_chinese_name(
            cas,
            chinese_name=resolved_chinese_name,
            english_name=resolved_english_name,
        )

    cache = upsert_structure_cache_names(
        db,
        StructureNameCacheWrite(
            cas_number=cas,
            english_name=resolved_english_name,
            chinese_name=resolved_chinese_name,
            chinese_name_is_translated=chinese_name_is_translated,
            name_error_message=warning_message,
        ),
    )
    db.commit()
    db.refresh(cache)
    return _cache_to_chemical_info(cas, cache)


def translate_text(text: str, from_lang: str = "en", to_lang: str = "zh") -> Optional[str]:
    if not text:
        return None

    if not settings.niutrans_appid or not settings.niutrans_apikey:
        logger.warning("Niutrans API credentials not configured")
        return None

    try:
        timestamp = str(int(time.time() * 1000))

        params = {
            "appId": settings.niutrans_appid,
            "from": from_lang,
            "to": to_lang,
            "srcText": text,
            "timestamp": timestamp
        }

        sorted_params = sorted(list(params.items()) + [("apikey", settings.niutrans_apikey)], key=lambda x: x[0])
        param_str = "&".join([f"{key}={value}" for key, value in sorted_params])

        auth_str = hashlib.md5(param_str.encode("utf-8")).hexdigest()

        params["authStr"] = auth_str

        url = "https://api.niutrans.com/v2/text/translate"
        response = _safe_post(url, data=params, timeout=2)

        if response.status_code == 200:
            result = response.json()
            if "tgtText" in result:
                return result["tgtText"]
            elif "errorCode" in result:
                logger.warning(f"Niutrans API error: {result.get('errorCode')} - {result.get('errorMsg')}")
        else:
            logger.warning(f"Niutrans API request failed with status {response.status_code}")

    except Exception as e:
        logger.warning(f"Failed to translate text via niutrans: {e}")

    return None


def query_chemical_info(
    db: Session,
    cas_number: str,
    *,
    skip_chinese: bool = False,
    cache_only: bool = False,
) -> Dict[str, Any]:
    cas = str(cas_number).strip()
    if not cas:
        return _cache_to_chemical_info(cas, None)

    cache = get_structure_cache(db, cas)
    result = _cache_to_chemical_info(cas, cache)
    if cache_only or _has_required_names(result, skip_chinese=skip_chinese):
        _set_chemical_info_memory_cache(cas, result)
        return result

    result = _resolve_and_store_missing_names(
        db,
        cas,
        result,
        skip_chinese=skip_chinese,
    )
    _set_chemical_info_memory_cache(cas, result)

    logger.info(
        "Chemical info for CAS %s: name=%s, english_name=%s, warning=%s",
        cas,
        result["name"],
        result["english_name"],
        result.get("warning"),
    )

    return result


@router.get("/{cas_number}", dependencies=[Depends(get_current_user)])
def get_chemical_info(
    cas_number: str,
    db: DBSession,
    skip_chinese: bool = False,
    cache_only: bool = False,
):
    is_valid, error_msg, normalized_cas = validate_and_normalize_cas(cas_number)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg or "Invalid CAS number"
        )

    if is_special_cas_value(normalized_cas):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Biological reagents do not support CAS query",
        )

    result = query_chemical_info(
        db,
        normalized_cas,
        skip_chinese=skip_chinese,
        cache_only=cache_only,
    )

    return {
        "cas_number": normalized_cas,
        "name": result["name"],
        "english_name": result["english_name"],
        "warning": result.get("warning"),
        "smiles": result.get("smiles"),
        "chinese_name_is_translated": result.get("chinese_name_is_translated"),
    }
