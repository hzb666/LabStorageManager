"""
批量更新库存表拼音字段脚本
用于为已有的库存数据填充 storage_location_pinyin 拼音字段

使用方式：
    python update_pinyin.py
"""
from sqlalchemy import text
from app.database import get_db
from app.models.inventory import Inventory
from app.services.pinyin_utils import compute_pinyin_fields
from sqlmodel import select


def add_column_if_not_exists():
    """检查并添加 storage_location_pinyin 列"""
    db = next(get_db())

    # 检查列是否存在
    try:
        db.execute(text("SELECT storage_location_pinyin FROM inventory LIMIT 1"))
        print("列已存在，跳过添加")
        return True
    except Exception:
        pass

    # 添加列
    try:
        db.execute(text("ALTER TABLE inventory ADD COLUMN storage_location_pinyin VARCHAR(200)"))
        db.commit()
        print("已添加 storage_location_pinyin 列")
        return True
    except Exception as e:
        print(f"添加列失败: {e}")
        return False


def create_indexes():
    """为拼音排序字段创建索引"""
    db = next(get_db())

    indexes = [
        ("inventory", "idx_inventory_storage_location_pinyin", "storage_location_pinyin"),
        ("inventory", "idx_inventory_name_pinyin", "name_pinyin"),
        ("inventory", "idx_inventory_category_pinyin", "category_pinyin"),
        ("inventory", "idx_inventory_brand_pinyin", "brand_pinyin"),
        ("reagent_order", "idx_reagent_order_name_pinyin", "name_pinyin"),
        ("reagent_order", "idx_reagent_order_brand_pinyin", "brand_pinyin"),
        ("consumable_order", "idx_consumable_order_name_pinyin", "name_pinyin"),
    ]

    for table, index_name, column in indexes:
        try:
            db.execute(text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({column})"))
            print(f"索引 {index_name} 已创建")
        except Exception as e:
            print(f"创建索引 {index_name} 失败: {e}")

    db.commit()
    print("索引创建完成")


def update_pinyin_fields():
    """批量更新库存表的拼音字段"""
    # 先检查并添加列
    if not add_column_if_not_exists():
        print("无法添加列，退出")
        return

    # 创建索引
    create_indexes()

    db = next(get_db())

    # 查询所有 storage_location_pinyin 为 NULL 的记录
    statement = select(Inventory).where(
        Inventory.storage_location_pinyin.is_(None),
        Inventory.storage_location.isnot(None)
    )
    items = db.exec(statement).all()

    if not items:
        print("没有需要更新的记录")
        return

    print(f"找到 {len(items)} 条需要更新拼音字段的记录")

    count = 0
    for item in items:
        # 只计算 storage_location 的拼音
        pinyin_fields = compute_pinyin_fields(
            storage_location=item.storage_location,
        )

        # 只更新 storage_location_pinyin 字段
        item.storage_location_pinyin = pinyin_fields.get('storage_location_pinyin')

        count += 1
        if count % 100 == 0:
            print(f"已处理 {count}/{len(items)} 条记录")

    db.commit()
    print(f"完成！共更新 {count} 条记录的拼音字段")


if __name__ == "__main__":
    update_pinyin_fields()
