"""
拼音工具服务 - 用于中文文本转拼音
"""
from typing import Optional

from pypinyin import lazy_pinyin


def _flush_ascii_buffer(buffer: list[str], full_parts: list[str], initial_parts: list[str]) -> None:
    """Flush buffered ASCII/数字片段，保留完整 token 便于英文搜索。"""
    if not buffer:
        return

    token = "".join(buffer).lower()
    full_parts.append(token)
    initial_parts.append(token)
    buffer.clear()


def to_pinyin_parts(text: Optional[str]) -> tuple[str, str]:
    """
    将文本转换为 (全拼, 首字母)。

    规则：
    - 中文按拼音处理，如 "无水乙醇" -> ("wushuiyichun", "wsyc")
    - 英文/数字 token 原样归一化保留，如 "Sigma" -> ("sigma", "sigma")
    - 常见分隔符被忽略，便于搜索时跨空格/横杠匹配
    """
    if not text:
        return "", ""

    full_parts: list[str] = []
    initial_parts: list[str] = []
    ascii_buffer: list[str] = []

    for char in text:
        if "\u4e00" <= char <= "\u9fff":
            _flush_ascii_buffer(ascii_buffer, full_parts, initial_parts)
            syllable = "".join(lazy_pinyin(char, style=0)).lower()
            if syllable:
                full_parts.append(syllable)
                initial_parts.append(syllable[0])
            continue

        if char.isascii() and char.isalnum():
            ascii_buffer.append(char)
            continue

        if char.isalnum():
            ascii_buffer.append(char.lower())
            continue

        _flush_ascii_buffer(ascii_buffer, full_parts, initial_parts)

    _flush_ascii_buffer(ascii_buffer, full_parts, initial_parts)
    return "".join(full_parts), "".join(initial_parts)


def to_pinyin(text: str) -> str:
    """
    将文本转换为无音调全拼字符串。

    例如：
    - "乙醇" -> "yichun"
    - "Sigma" -> "sigma"
    """
    full_pinyin, _ = to_pinyin_parts(text)
    return full_pinyin


def compute_pinyin_fields(name: str = None, category: str = None,
                          brand: str = None, alias: str = None,
                          storage_location: str = None,
                          full_name: str = None,
                          max_length: int = 200) -> dict:
    """
    计算多个字段的拼音

    Args:
        name: 名称
        category: 类别
        brand: 品牌
        alias: 别名
        storage_location: 位置
        full_name: 姓名（用于用户排序）
        max_length: 拼音字段的最大长度，超出部分会被截断

    Returns:
        包含拼音字段的字典
    """
    def truncate(text: str) -> str:
        """截断超长文本"""
        return text[:max_length] if len(text) > max_length else text

    name_pinyin, name_initials = to_pinyin_parts(name)
    category_pinyin, category_initials = to_pinyin_parts(category)
    brand_pinyin, brand_initials = to_pinyin_parts(brand)
    storage_location_pinyin, storage_location_initials = to_pinyin_parts(storage_location)

    result = {
        'name_pinyin': truncate(name_pinyin) if name else None,
        'name_pinyin_initials': truncate(name_initials) if name else None,
        'category_pinyin': truncate(category_pinyin) if category else None,
        'category_pinyin_initials': truncate(category_initials) if category else None,
        'brand_pinyin': truncate(brand_pinyin) if brand else None,
        'brand_pinyin_initials': truncate(brand_initials) if brand else None,
        'storage_location_pinyin': truncate(storage_location_pinyin) if storage_location else None,
        'storage_location_pinyin_initials': truncate(storage_location_initials) if storage_location else None,
    }

    # 添加 full_name_pinyin（用于用户排序）
    if full_name:
        full_name_pinyin, full_name_initials = to_pinyin_parts(full_name)
        result['full_name_pinyin'] = truncate(full_name_pinyin)
        result['full_name_pinyin_initials'] = truncate(full_name_initials)

    return result
