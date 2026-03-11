"""
更新现有库存数据的 remaining_percent 字段
"""
from app.database import get_db
from app.models.inventory import Inventory
from sqlmodel import select


def compute_remaining_percent(remaining, initial):
    """计算剩余百分比"""
    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


def update_remaining_percent():
    """更新所有库存项的 remaining_percent"""
    db = next(get_db())

    # 获取所有库存项
    items = db.exec(select(Inventory)).all()

    updated_count = 0
    for item in items:
        new_percent = compute_remaining_percent(item.remaining_quantity, item.initial_quantity)
        if item.remaining_percent != new_percent:
            item.remaining_percent = new_percent
            updated_count += 1

    db.commit()
    print(f"更新了 {updated_count} 条数据")


if __name__ == "__main__":
    update_remaining_percent()
