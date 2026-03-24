"""
化学物质信息查询服务
- 中文名：从 chemblink.com 爬取，如未获取到则翻译 PubChem 的英文名
- 英文名：从 PubChem API 获取
"""
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
from app.services.cas_utils import validate_and_normalize_cas, is_special_cas_value

logger = logging.getLogger(__name__)
PUBCHEM_PRIMARY_TIMEOUT_SECONDS = 3
PUBCHEM_FALLBACK_BUDGET_SECONDS = 1
router = APIRouter(prefix="/chemical-info", tags=["Chemical Info"])

# 随机 User-Agent 池
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
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
    """获取随机请求头"""
    return {
        'User-Agent': random.choice(USER_AGENTS),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
    }


def _safe_get(url: str, timeout: float):
    """Outbound GET with redirect disabled to reduce SSRF abuse surface."""
    if not _is_safe_outbound_url(url):
        raise requests.RequestException(f"Unsafe outbound URL blocked: {url}")
    return requests.get(url, headers=_get_headers(), timeout=timeout, allow_redirects=False)


def _safe_post(url: str, data: Dict[str, str], timeout: float):
    """Outbound POST with redirect disabled to reduce SSRF abuse surface."""
    if not _is_safe_outbound_url(url):
        raise requests.RequestException(f"Unsafe outbound URL blocked: {url}")
    return requests.post(url, data=data, timeout=timeout, allow_redirects=False)


def _is_safe_outbound_url(url: str) -> bool:
    """Validate outbound URL against protocol/host allowlist restrictions."""
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
    """Format exception details for end-user warning without losing root cause."""
    message = str(exc).strip()
    if message:
        return f"{exc.__class__.__name__}: {message}"
    return exc.__class__.__name__


def _get_cached(cas_number: str) -> Optional[Dict[str, Any]]:
    """从缓存获取"""
    if cas_number in _CACHE:
        cached_data, cached_time = _CACHE[cas_number]
        if time.time() - cached_time < CHEMICAL_INFO_CACHE_TTL_SECONDS:
            # 更新访问顺序（移到末尾）
            if cas_number in _CACHE_ORDER:
                _CACHE_ORDER.remove(cas_number)
            _CACHE_ORDER.append(cas_number)
            return cached_data
        else:
            # 缓存过期，删除
            del _CACHE[cas_number]
            if cas_number in _CACHE_ORDER:
                _CACHE_ORDER.remove(cas_number)
    return None


def _set_cached(cas_number: str, data: Dict[str, Any]) -> None:
    """设置缓存"""
    # 如果已存在，先删除（更新）
    if cas_number in _CACHE:
        del _CACHE[cas_number]
        if cas_number in _CACHE_ORDER:
            _CACHE_ORDER.remove(cas_number)

    # 如果缓存已满，删除最旧的条目
    while len(_CACHE) >= CHEMICAL_INFO_CACHE_MAX_SIZE and _CACHE_ORDER:
        oldest = _CACHE_ORDER.pop(0)
        if oldest in _CACHE:
            del _CACHE[oldest]

    # 添加新条目
    _CACHE[cas_number] = (data, time.time())
    _CACHE_ORDER.append(cas_number)


def _remaining_timeout(deadline: float) -> Optional[float]:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None
    # requests 要求 timeout > 0
    return max(MIN_REQUEST_TIMEOUT_SECONDS, remaining)


def _parse_chinese_name(content: str) -> Optional[str]:
    """从页面内容中解析中文名"""
    if '404' in content[:500] or 'File Not Found' in content[:500]:
        return None

    # 方法1: 匹配 <h1>中文名<br>[CAS#...]</h1> 结构
    match = re.search(r'<h1[^>]*>\s*([^<\n]+?)\s*<br>', content)
    if match:
        return match.group(1).strip()

    # 方法2: 从标题提取
    match = re.search(r'<title>\s*CAS 登录号：([^,]+),\s*([^,]+),\s*([^-]+)\s*- chemBlink', content)
    if match:
        return match.group(2).strip()

    # 方法3: 从表格的"产品名称"行提取
    match = re.search(r'产品名称</td>\s*<td>([^<]+)</td>', content)
    if match:
        return match.group(1).strip()

    return None


def query_chinese_name(cas_number: str) -> Optional[str]:
    """
    从 chemblink.com 获取中文名（主站和备用站并行查询）
    """
    cas = str(cas_number).strip()
    if not cas:
        return None

    # 检查缓存
    cached = _get_cached(cas)
    if cached and cached.get('chinese_name'):
        return cached['chinese_name']

    urls = [
        f"https://www.chemblink.com/products/{cas}C.htm",
        f"https://www.chemblink.com/moreProducts/more{cas}C.htm",
    ]

    chinese_name: Optional[str] = None

    # 并行查询两个站点
    def fetch_and_parse(url: str) -> Optional[str]:
        try:
            response = _safe_get(url, timeout=3)
            if response.status_code == 200:
                content = response.content.decode('utf-8', errors='ignore')
                return _parse_chinese_name(content)
        except Exception as e:
            logger.warning(f"Failed to query chemblink {url} for CAS {cas}: {e}")
        return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(fetch_and_parse, urls))

    # 优先使用主站点的结果
    chinese_name = results[0] if results else None
    # 如果主站点没有，尝试备用站点
    if not chinese_name and len(results) > 1:
        chinese_name = results[1]

    # 短暂延迟，避免请求过快
    time.sleep(CHEMICAL_INFO_RATE_LIMIT_DELAY_SECONDS)

    return chinese_name


def query_english_name(cas_number: str) -> tuple[Optional[str], Optional[str]]:
    """
    从 PubChem API 获取英文名
    """
    cas = str(cas_number).strip()
    if not cas:
        return None, None
    
    # 检查缓存
    cached = _get_cached(cas)
    if cached and cached.get('english_name'):
        return cached['english_name'], None
    
    english_name = ""
    primary_failure_reason: Optional[str] = None
    fallback_failure_reason: Optional[str] = None
    
    encoded_cas = quote(cas, safe="")

    # 使用 PubChem REST API
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded_cas}/property/IUPACName/JSON"
    
    try:
        response = _safe_get(url, timeout=PUBCHEM_PRIMARY_TIMEOUT_SECONDS)
        if response.status_code == 200:
            data = response.json()
            properties = data.get('PropertyTable', {}).get('Properties', [])
            if properties and properties[0].get('IUPACName'):
                english_name = properties[0]['IUPACName']
            else:
                primary_failure_reason = "主查询返回成功但未包含 IUPACName"
        else:
            primary_failure_reason = f"主查询 HTTP {response.status_code}"
    except Exception as e:
        logger.warning(f"Failed to query PubChem for CAS {cas}: {e}")
        primary_failure_reason = f"主查询异常：{_format_exception_message(e)}"
    
    # 如果 IUPACName 失败，尝试在 1 秒总预算内 fallback
    if not english_name:
        deadline = time.monotonic() + PUBCHEM_FALLBACK_BUDGET_SECONDS
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded_cas}/cids/JSON"
        try:
            fallback_timeout = _remaining_timeout(deadline)
            if fallback_timeout is None:
                fallback_failure_reason = (
                    f"补充查询超时（最多 {PUBCHEM_FALLBACK_BUDGET_SECONDS} 秒）"
                )
                return None, (
                    f"PubChem 未获取英文名：{primary_failure_reason or '主查询无结果'}；{fallback_failure_reason}"
                )

            response = _safe_get(url, timeout=fallback_timeout)
            if response.status_code == 200:
                data = response.json()
                identifier_list = data.get('IdentifierList', {})
                cids = identifier_list.get('CID', [])
                if cids:
                    cid = cids[0]
                    # 用 CID 获取英文名
                    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/property/IUPACName/JSON"
                    property_timeout = _remaining_timeout(deadline)
                    if property_timeout is None:
                        fallback_failure_reason = (
                            f"补充查询超时（最多 {PUBCHEM_FALLBACK_BUDGET_SECONDS} 秒）"
                        )
                        return None, (
                            f"PubChem 未获取英文名：{primary_failure_reason or '主查询无结果'}；{fallback_failure_reason}"
                        )

                    response = _safe_get(url, timeout=property_timeout)
                    if response.status_code == 200:
                        data = response.json()
                        properties = data.get('PropertyTable', {}).get('Properties', [])
                        if properties and properties[0].get('IUPACName'):
                            english_name = properties[0]['IUPACName']
                        else:
                            fallback_failure_reason = "补充查询返回成功但未包含 IUPACName"
                    else:
                        fallback_failure_reason = f"补充属性查询 HTTP {response.status_code}"
                else:
                    fallback_failure_reason = "补充 CID 查询成功但未返回 CID"
            else:
                fallback_failure_reason = f"补充 CID 查询 HTTP {response.status_code}"
        except Exception as e:
            logger.warning(f"Failed to query PubChem CID for CAS {cas}: {e}")
            fallback_failure_reason = f"补充查询异常：{_format_exception_message(e)}"
    
    # 短暂延迟
    time.sleep(CHEMICAL_INFO_RATE_LIMIT_DELAY_SECONDS)

    warning_message: Optional[str] = None
    if not english_name:
        warning_parts = []
        if primary_failure_reason:
            warning_parts.append(primary_failure_reason)
        if fallback_failure_reason:
            warning_parts.append(fallback_failure_reason)
        if not warning_parts:
            warning_parts.append("未命中可用结果")
        warning_message = "PubChem 未获取英文名：" + "；".join(warning_parts)

    return (english_name if english_name else None), warning_message


def translate_text(text: str, from_lang: str = "en", to_lang: str = "zh") -> Optional[str]:
    """
    使用 niutrans API 翻译文本
    """
    if not text:
        return None
    
    # 检查 API 配置
    if not settings.niutrans_appid or not settings.niutrans_apikey:
        logger.warning("Niutrans API credentials not configured")
        return None
    
    try:
        # 生成 authStr
        timestamp = str(int(time.time() * 1000))
        
        # 构建参数字典（不包括 authStr 本身）
        params = {
            "appId": settings.niutrans_appid,
            "from": from_lang,
            "to": to_lang,
            "srcText": text,
            "timestamp": timestamp
        }
        
        # 按参数名排序并拼接
        sorted_params = sorted(list(params.items()) + [("apikey", settings.niutrans_apikey)], key=lambda x: x[0])
        param_str = "&".join([f"{key}={value}" for key, value in sorted_params])
        
        # MD5 加密
        auth_str = hashlib.md5(param_str.encode("utf-8")).hexdigest()
        
        # 添加 authStr
        params["authStr"] = auth_str
        
        # 发送请求
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


def query_chemical_info(cas_number: str) -> Dict[str, Optional[str]]:
    """
    综合查询化学物质信息（并行查询）
    返回: { "name": "中文名", "english_name": "英文名" }
    """
    cas = str(cas_number).strip()
    if not cas:
        return {"name": None, "english_name": None}
    
    # 先检查缓存
    cached = _get_cached(cas)
    if cached:
        return {
            "name": cached.get('chinese_name'),
            "english_name": cached.get('english_name'),
            "warning": cached.get('warning'),
        }
    
    # 并行查询中文名和英文名
    chinese_name = None
    english_name = None
    warning_message: Optional[str] = None
    
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_chinese = executor.submit(query_chinese_name, cas)
        future_english = executor.submit(query_english_name, cas)
        
        # 等待两个任务完成
        try:
            chinese_name = future_chinese.result(timeout=CHEMICAL_INFO_PRIMARY_FUTURE_TIMEOUT_SECONDS)
        except Exception as e:
            logger.warning(f"Failed to get Chinese name for CAS {cas}: {e}")
        
        try:
            english_name, warning_message = future_english.result(timeout=CHEMICAL_INFO_FALLBACK_FUTURE_TIMEOUT_SECONDS)
        except Exception as e:
            logger.warning(f"Failed to get English name for CAS {cas}: {e}")
            warning_message = "英文名查询超时，已跳过 PubChem 补充识别"
    
    # 如果中文名为空但英文名存在，尝试翻译英文名作为备选
    if not chinese_name and english_name:
        logger.info(f"Chinese name not found for CAS {cas}, trying to translate English name: {english_name}")
        translated_name = translate_text(english_name)
        if translated_name:
            # 翻译的中文名添加后缀标记
            chinese_name = f"{translated_name}{TRANSLATED_NAME_SUFFIX}"
            logger.info(f"Translated Chinese name for CAS {cas}: {chinese_name}")
    
    # 保存到缓存
    result = {
        "name": chinese_name,
        "english_name": english_name,
        "warning": warning_message,
    }
    _set_cached(cas, {
        "chinese_name": chinese_name,
        "english_name": english_name,
        "warning": warning_message,
    })
    
    logger.info(
        f"Chemical info for CAS {cas}: name={chinese_name}, english_name={english_name}, warning={warning_message}"
    )
    
    return result


@router.get("/{cas_number}", dependencies=[Depends(get_current_user)])
def get_chemical_info(
    cas_number: str,
    skip_chinese: bool = False,
):
    """
    根据 CAS 号查询化学物质信息
    
    返回:
    - name: 中文名（从 chemblink.com 获取；skip_chinese=true 时不查询）
    - english_name: 英文名（从 PubChem API 获取）
    """
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

    if skip_chinese:
        english_name, warning_message = query_english_name(normalized_cas)
        return {
            "cas_number": normalized_cas,
            "name": None,
            "english_name": english_name,
            "warning": warning_message,
        }

    result = query_chemical_info(normalized_cas)

    return {
        "cas_number": normalized_cas,
        "name": result["name"],
        "english_name": result["english_name"],
        "warning": result.get("warning"),
    }
