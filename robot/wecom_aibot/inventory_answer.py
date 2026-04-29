"""Inventory question answering for the WeCom intelligent robot."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import or_
from sqlmodel import Session, select

from app.core.constants import LOW_STOCK_PERCENT
from app.database import engine
from app.models.inventory import Inventory, InventoryStatus
from app.services.cas_utils import normalize_cas

CAS_PATTERN = re.compile(r"(?<!\d)\d{2,7}-\d{2}-\d(?!\d)")
HELP_KEYWORDS = ("帮助", "help", "怎么用", "指令")
LOW_STOCK_KEYWORDS = ("低库存", "快没", "不足", "缺货")
BORROWED_KEYWORDS = ("借出", "借用中", "谁借", "借走")
QUERY_STOP_WORDS = (
    "查询",
    "查一下",
    "看看",
    "库存",
    "还有",
    "有没有",
    "有吗",
    "位置",
    "在哪",
    "在哪里",
    "请问",
    "?",
    "？",
)
STATUS_LABELS = {
    InventoryStatus.IN_STOCK: "在库",
    InventoryStatus.RUN_SHORT: "低库存",
    InventoryStatus.BORROWED: "借用中",
    InventoryStatus.CONSUMED: "已消耗",
    InventoryStatus.NOT_IN_STOCK: "未入库",
}


@dataclass(frozen=True)
class InventoryAnswerService:
    search_limit: int = 5
    low_stock_threshold: float = LOW_STOCK_PERCENT

    def answer(self, question: str) -> str:
        normalized = question.strip()
        if not normalized or self._has_any(normalized, HELP_KEYWORDS):
            return self.help_text()
        with Session(engine) as db:
            if self._has_any(normalized, LOW_STOCK_KEYWORDS):
                return self._answer_low_stock(db)
            if self._has_any(normalized, BORROWED_KEYWORDS):
                return self._answer_borrowed(db, self._extract_query(normalized))
            return self._answer_inventory_search(db, self._extract_query(normalized))

    @staticmethod
    def help_text() -> str:
        return "\n".join(
            [
                "可以这样问我：",
                "1. 查询乙醇库存",
                "2. 64-17-5 在哪里",
                "3. 有哪些低库存",
                "4. 谁借走了乙醇",
            ]
        )

    @staticmethod
    def _has_any(text: str, keywords: Iterable[str]) -> bool:
        lower = text.lower()
        return any(keyword.lower() in lower for keyword in keywords)

    @staticmethod
    def _extract_query(question: str) -> str:
        cas_match = CAS_PATTERN.search(question)
        if cas_match:
            return cas_match.group(0)
        cleaned = question
        for word in QUERY_STOP_WORDS:
            cleaned = cleaned.replace(word, " ")
        return " ".join(cleaned.split())

    def _answer_low_stock(self, db: Session) -> str:
        threshold = self.low_stock_threshold
        statement = (
            select(Inventory)
            .where(
                Inventory.status.in_([InventoryStatus.IN_STOCK, InventoryStatus.RUN_SHORT]),
                Inventory.remaining_percent <= threshold,
            )
            .order_by(Inventory.remaining_percent.asc(), Inventory.updated_at.desc())
            .limit(self.search_limit)
        )
        items = list(db.exec(statement))
        if not items:
            return f"暂时没有低于 {threshold:.0%} 的库存记录。"
        return "低库存记录：\n" + "\n".join(self._format_item(item) for item in items)

    def _answer_borrowed(self, db: Session, query: str) -> str:
        statement = select(Inventory).where(Inventory.status == InventoryStatus.BORROWED)
        if query:
            statement = statement.where(self._build_search_clause(query))
        items = list(db.exec(statement.order_by(Inventory.updated_at.desc()).limit(self.search_limit)))
        if not items:
            return "没有查到匹配的借用中库存。"
        return "借用中库存：\n" + "\n".join(self._format_item(item) for item in items)

    def _answer_inventory_search(self, db: Session, query: str) -> str:
        if not query:
            return self.help_text()
        statement = (
            select(Inventory)
            .where(
                Inventory.status.in_(
                    [
                        InventoryStatus.IN_STOCK,
                        InventoryStatus.RUN_SHORT,
                        InventoryStatus.BORROWED,
                    ]
                ),
                self._build_search_clause(query),
            )
            .order_by(Inventory.updated_at.desc())
            .limit(self.search_limit)
        )
        items = list(db.exec(statement))
        if not items:
            return f"没有查到“{query}”的库存记录。"
        return f"查到 {len(items)} 条匹配记录：\n" + "\n".join(
            self._format_item(item) for item in items
        )

    @staticmethod
    def _build_search_clause(query: str):
        normalized_cas = normalize_cas(query)
        like_value = query.strip()
        clauses = [
            Inventory.name.contains(like_value),
            Inventory.cas_number.contains(normalized_cas or like_value),
            Inventory.storage_location.contains(like_value),
            Inventory.brand.contains(like_value),
            Inventory.category.contains(like_value),
        ]
        return or_(*clauses)

    @staticmethod
    def _format_item(item: Inventory) -> str:
        quantity = _format_quantity(item.remaining_quantity, item.unit)
        location = item.storage_location or "未填写位置"
        status = STATUS_LABELS.get(item.status, item.status.value)
        return f"- {item.name}（{item.cas_number}）：{quantity}，{location}，{status}"


def _format_quantity(value: float | None, unit: str | None) -> str:
    if value is None:
        return "剩余量未知"
    amount = int(value) if value == int(value) else value
    return f"剩余 {amount}{unit or ''}"
