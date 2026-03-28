# 中文与混合文本的拼音归一化工具。
from typing import Optional

from pypinyin import lazy_pinyin


PINYIN_FIELD_MAX_LENGTH = 200


def _flush_ascii_buffer(buffer: list[str], full_parts: list[str], initial_parts: list[str]) -> None:
    if not buffer:
        return

    token = "".join(buffer).lower()
    full_parts.append(token)
    initial_parts.append(token)
    buffer.clear()


def to_pinyin_parts(text: Optional[str]) -> tuple[str, str]:
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
    full_pinyin, _ = to_pinyin_parts(text)
    return full_pinyin


def compute_pinyin_fields(
    name: str = None,
    category: str = None,
    brand: str = None,
    storage_location: str = None,
    full_name: str = None,
) -> dict:
    def truncate(text: str) -> str:
        return text[:PINYIN_FIELD_MAX_LENGTH] if len(text) > PINYIN_FIELD_MAX_LENGTH else text

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

    # full_name 只用于用户排序和检索，不和物料字段混在一起。
    if full_name:
        full_name_pinyin, full_name_initials = to_pinyin_parts(full_name)
        result['full_name_pinyin'] = truncate(full_name_pinyin)
        result['full_name_pinyin_initials'] = truncate(full_name_initials)

    return result
