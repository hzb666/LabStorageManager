"""
SQL工具函数 - 提供通用的SQL构建辅助函数
"""
from functools import reduce
from typing import Any
from sqlmodel import func as sql_func


# 需要在SQL中移除的字符列表
CHARS_TO_REMOVE = ["-", " ", "\u00A0", "\u2002", "\u2003", "\u2009", "\u200C", "\u200D", "_"]


def normalize_field_sql(field: Any) -> Any:
    """
    构建标准化字段的SQL表达式
    移除所有特殊空格字符和常见分隔符后进行匹配
    使用 reduce 动态生成嵌套的 func.replace

    用法示例:
        base = base.where(
            normalize_field_sql(ConsumableOrder.name).ilike(f"%{search_term}%")
        )

    生成的SQL:
        REPLACE(REPLACE(REPLACE(consumableorder.name, '-', ''), ' ', ''), ...)
    """
    # 使用 reduce 动态生成嵌套的 func.replace
    # 相当于 func.replace(func.replace(field, '-', ''), ' ', '') ...
    return reduce(
        lambda expr, char: sql_func.replace(expr, char, ""),
        CHARS_TO_REMOVE,
        field
    )


def normalize_search_term(search_term: str) -> str:
    """标准化搜索词：移除特殊空格字符和常见分隔符。"""
    if not search_term:
        return search_term

    return reduce(
        lambda text, char: text.replace(char, ""),
        CHARS_TO_REMOVE,
        search_term,
    )


def order_with_nulls_last(field: Any, direction: str = "desc") -> tuple[Any, ...]:
    """构建兼容 SQLite 的 NULLS LAST 排序表达式。

    性能优先：
    - ``DESC`` 时，SQLite 默认就是 NULLS LAST，直接 ``field DESC`` 可最大化索引利用。
    - ``ASC`` 时，为保持 NULLS LAST，仍使用 ``field IS NULL, field ASC`` 兼容写法。
    """
    normalized_direction = direction.lower() if direction else "desc"
    if normalized_direction == "desc":
        return (field.desc(),)
    return field.is_(None).asc(), field.asc()


def order_with_special_last(field: Any, special_value: str, direction: str = "desc") -> tuple[Any, ...]:
    """Build sort expression that always places one special value at the end.

    Order strategy:
    1) NULL values last
    2) special value last
    3) regular value sort by requested direction
    """
    normalized_direction = direction.lower() if direction else "desc"
    special_rank = (field == special_value).asc()
    if normalized_direction == "desc":
        # DESC 下 NULL 默认在末尾，避免再叠加 null_rank 影响索引排序。
        return special_rank, field.desc()
    return field.is_(None).asc(), special_rank, field.asc()
