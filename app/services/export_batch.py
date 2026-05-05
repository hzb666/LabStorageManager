from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, func, select

EXPORT_BATCH_SIZE = 2000
EXPORT_HARD_LIMIT = 20000


@dataclass
class BatchFetchResult:
    items: list[Any]
    total_count: int
    is_truncated: bool

    def apply_truncation_headers(self, response: Any) -> None:
        if self.is_truncated:
            response.headers["X-Export-Truncated"] = "true"
            response.headers["X-Export-Total-Count"] = str(self.total_count)
            response.headers["X-Export-Exported-Count"] = str(len(self.items))


def batch_fetch_all(
    db: Session,
    statement: Any,
    *,
    batch_size: int = EXPORT_BATCH_SIZE,
    hard_limit: int = EXPORT_HARD_LIMIT,
) -> BatchFetchResult:
    """分批查询全量数据，每批查询后释放 ORM 强引用。

    超过硬上限时截断并标记 is_truncated。
    """
    count_stmt = select(func.count()).select_from(statement.subquery())
    total_count = db.exec(count_stmt).one()

    limit = min(total_count, hard_limit)
    results: list[Any] = []
    offset = 0
    while offset < limit:
        current_batch = min(batch_size, limit - offset)
        batch = db.exec(statement.offset(offset).limit(current_batch)).all()
        if not batch:
            break
        results.extend(batch)
        offset += current_batch
        db.expire_all()

    return BatchFetchResult(
        items=results,
        total_count=total_count,
        is_truncated=total_count > hard_limit,
    )
