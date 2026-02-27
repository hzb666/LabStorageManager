"""
一次性脚本：重建库存表的拼音字段
用于为历史数据生成拼音排序字段
"""
import sqlite3
from pypinyin import lazy_pinyin

DB_PATH = "D:/Code/LabStorageManager/lab_inventory.db"


def to_pinyin(text):
    """将中文文本转换为拼音字符串"""
    if not text:
        return ''
    pinyin_list = lazy_pinyin(text, style=0)
    return ''.join(pinyin_list).lower()


def rebuild_pinyin():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 获取所有库存记录
    cursor.execute("SELECT id, name, category, brand, alias FROM inventory")
    rows = cursor.fetchall()
    
    total = len(rows)
    print(f"开始重建拼音字段，共 {total} 条记录...")
    
    for i, (id, name, category, brand, alias) in enumerate(rows):
        name_p = to_pinyin(name) if name else ''
        cat_p = to_pinyin(category) if category else ''
        brand_p = to_pinyin(brand) if brand else ''
        alias_p = to_pinyin(alias) if alias else ''
        
        cursor.execute("""
            UPDATE inventory 
            SET name_pinyin = ?, category_pinyin = ?, brand_pinyin = ?, alias_pinyin = ?
            WHERE id = ?
        """, (name_p, cat_p, brand_p, alias_p, id))
        
        if (i + 1) % 1000 == 0:
            conn.commit()
            print(f"已处理 {i + 1}/{total} 条...")
    
    conn.commit()
    print(f"完成！共更新 {total} 条记录")
    
    # 验证
    cursor.execute("SELECT COUNT(*) FROM inventory WHERE name_pinyin IS NOT NULL AND name_pinyin != ''")
    count = cursor.fetchone()[0]
    print(f"有拼音的记录数: {count}")
    
    conn.close()


if __name__ == "__main__":
    rebuild_pinyin()
