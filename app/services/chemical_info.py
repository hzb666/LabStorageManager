"""
化学物质信息查询服务
- 中文名：从 chemblink.com 爬取
- 英文名：从 PubChem API 获取
"""
import re
import time
import random
import logging
import requests
from typing import Optional, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

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
_CACHE_MAX_SIZE = 1000   # 最大缓存条目数
_CACHE_TTL_SECONDS = 3600  # 缓存1小时


def _get_headers() -> Dict[str, str]:
    """获取随机请求头"""
    return {
        'User-Agent': random.choice(USER_AGENTS),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
    }


def _get_cached(cas_number: str) -> Optional[Dict[str, Any]]:
    """从缓存获取"""
    if cas_number in _CACHE:
        cached_data, cached_time = _CACHE[cas_number]
        if time.time() - cached_time < _CACHE_TTL_SECONDS:
            # 更新访问顺序（移到末尾）
            if cas_number in _CACHE_ORDER:
                _CACHE_ORDER.remove(cas_number)
            _CACHE_ORDER.append(cas_number)
            return cached_data
        else:
            # 缓存过期，删除
            del _CACHE[cas_number]
            _CACHE_ORDER.remove(cas_number)
    return None


def _set_cached(cas_number: str, data: Dict[str, Any]) -> None:
    """设置缓存"""
    # 如果已存在，先删除（更新）
    if cas_number in _CACHE:
        del _CACHE[cas_number]
        _CACHE_ORDER.remove(cas_number)

    # 如果缓存已满，删除最旧的条目
    while len(_CACHE) >= _CACHE_MAX_SIZE and _CACHE_ORDER:
        oldest = _CACHE_ORDER.pop(0)
        if oldest in _CACHE:
            del _CACHE[oldest]

    # 添加新条目
    _CACHE[cas_number] = (data, time.time())
    _CACHE_ORDER.append(cas_number)


def query_chinese_name(cas_number: str) -> Optional[str]:
    """
    从 chemblink.com 获取中文名
    """
    cas = str(cas_number).strip()
    if not cas:
        return None
    
    # 检查缓存
    cached = _get_cached(cas)
    if cached and cached.get('chinese_name'):
        return cached['chinese_name']
    
    chinese_name = ""
    
    # 尝试主站
    url = f"https://www.chemblink.com/products/{cas}C.htm"
    try:
        response = requests.get(url, headers=_get_headers(), timeout=15)
        if response.status_code == 200:
            content = response.content.decode('utf-8', errors='ignore')
            
            if '404' not in content[:500] and 'File Not Found' not in content[:500]:
                # 方法1: 匹配 <h1>中文名<br>[CAS#...]</h1> 结构
                match = re.search(r'<h1[^>]*>\s*([^<\n]+?)\s*<br>', content)
                if match:
                    chinese_name = match.group(1).strip()
                
                # 方法2: 从标题提取
                if not chinese_name:
                    match = re.search(r'<title>\s*CAS 登录号：([^,]+),\s*([^,]+),\s*([^-]+)\s*- chemBlink', content)
                    if match:
                        chinese_name = match.group(2).strip()
                
                # 方法3: 从表格的"产品名称"行提取
                if not chinese_name:
                    match = re.search(r'产品名称</td>\s*<td>([^<]+)</td>', content)
                    if match:
                        chinese_name = match.group(1).strip()
    except Exception as e:
        logger.warning(f"Failed to query chemblink main site for CAS {cas}: {e}")
    
    # 备用站点
    if not chinese_name:
        url = f"https://www.chemblink.com/moreProducts/more{cas}C.htm"
        try:
            response = requests.get(url, headers=_get_headers(), timeout=15)
            if response.status_code == 200:
                content = response.content.decode('utf-8', errors='ignore')
                
                if '404' not in content[:500] and 'File Not Found' not in content[:500]:
                    match = re.search(r'<h1[^>]*>\s*([^<\n]+?)\s*<br>', content)
                    if match:
                        chinese_name = match.group(1).strip()
                    
                    if not chinese_name:
                        match = re.search(r'<title>\s*CAS 登录号：([^,]+),\s*([^,]+),\s*([^-]+)\s*- chemBlink', content)
                        if match:
                            chinese_name = match.group(2).strip()
                    
                    if not chinese_name:
                        match = re.search(r'产品名称</td>\s*<td>([^<]+)</td>', content)
                        if match:
                            chinese_name = match.group(1).strip()
        except Exception as e:
            logger.warning(f"Failed to query chemblink backup site for CAS {cas}: {e}")
    
    # 短暂延迟，避免请求过快
    time.sleep(0.1)
    
    return chinese_name if chinese_name else None


def query_english_name(cas_number: str) -> Optional[str]:
    """
    从 PubChem API 获取英文名
    """
    cas = str(cas_number).strip()
    if not cas:
        return None
    
    # 检查缓存
    cached = _get_cached(cas)
    if cached and cached.get('english_name'):
        return cached['english_name']
    
    english_name = ""
    
    # 使用 PubChem REST API
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{cas}/property/IUPACName/JSON"
    
    try:
        response = requests.get(url, headers=_get_headers(), timeout=15)
        if response.status_code == 200:
            data = response.json()
            properties = data.get('PropertyTable', {}).get('Properties', [])
            if properties and properties[0].get('IUPACName'):
                english_name = properties[0]['IUPACName']
    except Exception as e:
        logger.warning(f"Failed to query PubChem for CAS {cas}: {e}")
    
    # 如果 IUPACName 失败，尝试用 CID 获取英文名
    if not english_name:
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{cas}/cids/JSON"
        try:
            response = requests.get(url, headers=_get_headers(), timeout=15)
            if response.status_code == 200:
                data = response.json()
                identifier_list = data.get('IdentifierList', {})
                cids = identifier_list.get('CID', [])
                if cids:
                    cid = cids[0]
                    # 用 CID 获取英文名
                    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/property/IUPACName/JSON"
                    response = requests.get(url, headers=_get_headers(), timeout=15)
                    if response.status_code == 200:
                        data = response.json()
                        properties = data.get('PropertyTable', {}).get('Properties', [])
                        if properties and properties[0].get('IUPACName'):
                            english_name = properties[0]['IUPACName']
        except Exception as e:
            logger.warning(f"Failed to query PubChem CID for CAS {cas}: {e}")
    
    # 短暂延迟
    time.sleep(0.05)
    
    return english_name if english_name else None


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
            "english_name": cached.get('english_name')
        }
    
    # 并行查询中文名和英文名
    chinese_name = None
    english_name = None
    
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_chinese = executor.submit(query_chinese_name, cas)
        future_english = executor.submit(query_english_name, cas)
        
        # 等待两个任务完成
        try:
            chinese_name = future_chinese.result(timeout=30)
        except Exception as e:
            logger.warning(f"Failed to get Chinese name for CAS {cas}: {e}")
        
        try:
            english_name = future_english.result(timeout=30)
        except Exception as e:
            logger.warning(f"Failed to get English name for CAS {cas}: {e}")
    
    # 保存到缓存
    result = {
        "name": chinese_name,
        "english_name": english_name
    }
    _set_cached(cas, {
        "chinese_name": chinese_name,
        "english_name": english_name
    })
    
    logger.info(f"Chemical info for CAS {cas}: name={chinese_name}, english_name={english_name}")
    
    return result
