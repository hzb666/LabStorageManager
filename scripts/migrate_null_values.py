"""
迁移脚本：
1. 修改表结构：将 remaining_quantity、initial_quantity、unit 改为允许 NULL
2. 将 remaining_quantity、initial_quantity 为 0 的值改为 NULL
3. 将 unit 为 '-' 的值改为 NULL
"""
import os
import sys

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlmodel import Session, text

from app.database import engine


def migrate_null_values():
    """批量更新数据库中的空值"""
    
    with Session(engine) as session:
        # SQLite 需要禁用外键检查
        session.exec(text("PRAGMA foreign_keys=OFF"))
        
        # 1. 创建新表，允许 NULL
        print("创建新表结构...")
        session.exec(text("""
            CREATE TABLE inventory_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                internal_code VARCHAR(50) NOT NULL UNIQUE,
                cas_number VARCHAR(50) NOT NULL,
                name VARCHAR(200) NOT NULL,
                english_name VARCHAR(200),
                alias VARCHAR(200),
                category VARCHAR(100),
                brand VARCHAR(100),
                storage_location VARCHAR(200),
                initial_quantity REAL,
                remaining_quantity REAL,
                unit VARCHAR(20),
                is_hazardous BOOLEAN NOT NULL,
                status VARCHAR(20) NOT NULL,
                image_path VARCHAR(200),
                borrower_id INTEGER REFERENCES users(id),
                last_borrower_id INTEGER REFERENCES users(id),
                temporary_keeper_id INTEGER REFERENCES users(id),
                created_by_id INTEGER REFERENCES users(id),
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL,
                name_pinyin VARCHAR(200),
                category_pinyin VARCHAR(200),
                brand_pinyin VARCHAR(200)
            )
        """))
        
        # 2. 复制数据，将 0 转为 NULL
        print("复制数据...")
        session.exec(text("""
            INSERT INTO inventory_new 
            SELECT id, internal_code, cas_number, name, english_name, alias, category, 
                   brand, storage_location,
                   CASE WHEN initial_quantity = 0 THEN NULL ELSE initial_quantity END,
                   CASE WHEN remaining_quantity = 0 THEN NULL ELSE remaining_quantity END,
                   CASE WHEN unit = '-' THEN NULL ELSE unit END,
                   is_hazardous, status, image_path, borrower_id, last_borrower_id,
                   temporary_keeper_id, created_by_id, created_at, updated_at,
                   name_pinyin, category_pinyin, brand_pinyin
            FROM inventory
        """))
        
        # 3. 删除旧表
        session.exec(text("DROP TABLE inventory"))
        
        # 4. 重命名新表
        session.exec(text("ALTER TABLE inventory_new RENAME TO inventory"))
        
        # 5. 重建索引
        print("重建索引...")
        
        # 重建 unique 索引
        session.exec(text("CREATE UNIQUE INDEX ix_inventory_internal_code ON inventory(internal_code)"))
        
        # 重建其他索引
        session.exec(text("CREATE INDEX ix_inventory_cas_number ON inventory(cas_number)"))
        session.exec(text("CREATE INDEX ix_inventory_name ON inventory(name)"))
        session.exec(text("CREATE INDEX ix_inventory_category ON inventory(category)"))
        session.exec(text("CREATE INDEX ix_inventory_brand ON inventory(brand)"))
        session.exec(text("CREATE INDEX ix_inventory_storage_location ON inventory(storage_location)"))
        session.exec(text("CREATE INDEX ix_inventory_status ON inventory(status)"))
        session.exec(text("CREATE INDEX ix_inventory_borrower_id ON inventory(borrower_id)"))
        session.exec(text("CREATE INDEX ix_inventory_temporary_keeper_id ON inventory(temporary_keeper_id)"))
        session.exec(text("CREATE INDEX ix_inventory_created_by_id ON inventory(created_by_id)"))
        session.exec(text("CREATE INDEX ix_inventory_created_at ON inventory(created_at)"))
        session.exec(text("CREATE INDEX ix_inventory_updated_at ON inventory(updated_at)"))
        session.exec(text("CREATE INDEX ix_inventory_name_pinyin ON inventory(name_pinyin)"))
        session.exec(text("CREATE INDEX ix_inventory_category_pinyin ON inventory(category_pinyin)"))
        session.exec(text("CREATE INDEX ix_inventory_brand_pinyin ON inventory(brand_pinyin)"))
        
        session.commit()
        
        # 启用外键检查
        session.exec(text("PRAGMA foreign_keys=ON"))
        
        print("✅ 迁移完成!")
        
        # 统计
        result = session.exec(text("SELECT COUNT(*) FROM inventory WHERE remaining_quantity IS NULL"))
        null_remaining = result.one()
        
        result = session.exec(text("SELECT COUNT(*) FROM inventory WHERE initial_quantity IS NULL"))
        null_initial = result.one()
        
        result = session.exec(text("SELECT COUNT(*) FROM inventory WHERE unit IS NULL"))
        null_unit = result.one()
        
        print("统计:")
        print(f"   - remaining_quantity 为 NULL: {null_remaining} 条")
        print(f"   - initial_quantity 为 NULL: {null_initial} 条")
        print(f"   - unit 为 NULL: {null_unit} 条")


if __name__ == "__main__":
    print("开始迁移库存数据...")
    try:
        migrate_null_values()
    except Exception as e:
        print(f"迁移失败: {e}")
        import traceback
        traceback.print_exc()
