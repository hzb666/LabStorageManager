"""
库存数据导入脚本
从 XLSX 文件导入数据到 SQLite 数据库
支持拼音字段自动计算和数据验证
"""
import argparse
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime

import pandas as pd

# 添加项目路径以便导入 pypinyin
sys.path.insert(0, 'd:/Code/LabStorageManager')

from app.services.cas_utils import validate_cas_format
from app.services.pinyin_utils import compute_pinyin_fields

# 数据库配置
DB_FILE = "d:/Code/LabStorageManager/lab_inventory.db"

# 有效状态枚举（与后端 InventoryStatus.value 一致）
VALID_STATUSES = ['in_stock', 'not_in_stock', 'run_short', 'borrowed', 'consumed']


def compute_remaining_percent(initial_quantity, remaining_quantity):
    """计算剩余百分比，返回 0~1 小数；无法计算时返回 None。"""
    if initial_quantity is None or remaining_quantity is None:
        return None
    if initial_quantity <= 0:
        return None
    return remaining_quantity / initial_quantity


def validate_cas_number(cas_number) -> tuple:
    """验证 CAS 号：格式 + 校验码"""
    # 处理 None、float 或其他非字符串类型
    if cas_number is None or (isinstance(cas_number, float) and pd.isna(cas_number)):
        return False, "CAS号不能为空"

    # 转换为字符串
    cas_str = str(cas_number).strip()
    if not cas_str:
        return False, "CAS号不能为空"

    # 使用后端统一的 CAS 校验逻辑（包含校验码验证）
    is_valid, error = validate_cas_format(cas_str)
    if not is_valid:
        return False, f"CAS号无效：{cas_str}（{error}）"
    return True, None


def validate_name(name: str) -> tuple:
    """验证名称不能为空"""
    if not name or not name.strip():
        return False, "名称不能为空"
    return True, None


def validate_created_at(created_at: str) -> tuple:
    """验证创建日期格式"""
    if not created_at:
        return False, "创建日期不能为空"
    # 尝试解析日期
    try:
        date_normalized = str(created_at).replace("/", "-")
        parts = date_normalized.split("-")
        if len(parts) >= 3:
            year = int(parts[0])
            month = int(parts[1])
            day = int(parts[2])
            # 验证日期有效性
            if 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31:
                return True, None
        return False, f"创建日期格式错误：{created_at}"
    except Exception:
        return False, f"创建日期格式错误：{created_at}"


def validate_status(status: str) -> tuple:
    """验证状态必须是有效枚举值"""
    if not status:
        return True, None  # 状态可以为空
    status_lower = status.lower()
    if status_lower in VALID_STATUSES:
        return True, None
    return False, f"状态值无效：{status}（应为 in_stock/not_in_stock/run_short/borrowed/consumed）"


def validate_row(row_data: dict, row_num: int) -> list:
    """验证单行数据，返回错误列表"""
    errors = []
    
    # 验证 CAS 号
    cas_number = row_data.get('cas_number', '')
    is_valid, error = validate_cas_number(cas_number)
    if not is_valid:
        errors.append(f"第{row_num}行: {error}")
    
    # 验证名称
    name = row_data.get('name', '')
    is_valid, error = validate_name(name)
    if not is_valid:
        errors.append(f"第{row_num}行: {error}")
    
    # 验证创建日期
    created_at = row_data.get('created_at', '')
    is_valid, error = validate_created_at(created_at)
    if not is_valid:
        errors.append(f"第{row_num}行: {error}")
    
    # 验证状态
    status = row_data.get('status', '')
    is_valid, error = validate_status(status)
    if not is_valid:
        errors.append(f"第{row_num}行: {error}")
    
    return errors


def validate_all_data(df: pd.DataFrame) -> tuple:
    """验证所有数据，返回是否有错误和错误列表"""
    all_errors = []
    for idx, row in df.iterrows():
        row_data = row.to_dict()
        row_num = idx + 2  # 加2因为索引从0开始且有表头行
        errors = validate_row(row_data, row_num)
        all_errors.extend(errors)
    return len(all_errors) == 0, all_errors


def generate_internal_code(cas_number: str, created_at: str, sequence: int) -> str:
    """生成 internal_code: CAS号-日期(yymmdd)-序号（匹配后端逻辑）"""
    # 格式化日期为 yymmdd 格式
    if created_at:
        # 统一将 / 或 - 替换为 -
        date_normalized = created_at.replace("/", "-")
        # 处理各种格式如 2026-03-04, 2026-3-5, 2026-03-5 等
        parts = date_normalized.split("-")
        if len(parts) >= 3:
            try:
                year = parts[0][-2:]  # 取后两位如 26
                month = parts[1].zfill(2)  # 确保两位如 03
                day = parts[2].zfill(2)    # 确保两位如 05
                date_str = f"{year}{month}{day}"
            except Exception:
                date_str = datetime.now().strftime("%y%m%d")
        else:
            date_str = datetime.now().strftime("%y%m%d")
    else:
        date_str = datetime.now().strftime("%y%m%d")
    # 去掉 CAS 号中的连字符（如 10166-54-8 -> 10166548）
    cas_clean = cas_number.replace("-", "") if cas_number else ""
    return f"{cas_clean}-{date_str}-{sequence:02d}"


def process_row(row_data: dict, sequence: int) -> dict:
    """处理单行数据"""
    # 通用字段清理函数
    def clean_str(val, default=None):
        if val is None or pd.isna(val):
            return default
        if isinstance(val, float):
            return default
        return str(val).strip() if str(val).strip() else default
    
    def clean_float(val, default=None):
        if val is None or pd.isna(val):
            return default
        if isinstance(val, float):
            return float(val) if not pd.isna(val) else default
        try:
            return float(val)
        except Exception:
            return default
    
    # 获取字段值
    cas_number = clean_str(row_data.get('cas_number', ''))
    name = clean_str(row_data.get('name', ''))
    english_name = clean_str(row_data.get('english_name'), None)
    alias = clean_str(row_data.get('alias'), None)
    category = clean_str(row_data.get('category'), None)
    brand = clean_str(row_data.get('brand'), None)
    initial_quantity = clean_float(row_data.get('initial_quantity'), None)
    unit = clean_str(row_data.get('unit'), None)
    location = clean_str(row_data.get('location'), None)  # 对应 storage_location
    is_hazardous = row_data.get('is_hazardous')
    notes = clean_str(row_data.get('notes'), None)
    created_at = clean_str(row_data.get('created_at'), None)
    status = clean_str(row_data.get('status', 'in_stock'), None)
    
    # 处理 is_hazardous
    if is_hazardous is None or is_hazardous == '' or is_hazardous == 0:
        is_hazardous_val = 0
    elif isinstance(is_hazardous, bool):
        is_hazardous_val = 1 if is_hazardous else 0
    elif isinstance(is_hazardous, str):
        is_hazardous_val = 1 if is_hazardous.lower() in ['true', '1', 'yes', '是'] else 0
    else:
        is_hazardous_val = 0
    
    # 处理 status（存 value 小写，必须是有效值才存入）
    status_val = status.lower() if status else None
    if status_val and status_val not in VALID_STATUSES:
        status_val = None
    
    # 处理 created_at（格式化为 YYYY-MM-DD）
    created_at_val = None
    if created_at:
        # 统一将 / 或 - 替换为 -，然后解析
        date_normalized = str(created_at).replace("/", "-")
        parts = date_normalized.split("-")
        if len(parts) >= 3:
            try:
                year = parts[0]
                month = parts[1].zfill(2)
                day = parts[2].zfill(2)
                created_at_val = f"{year}-{month}-{day}"
            except Exception:
                created_at_val = None
    
    # 处理数量
    qty = initial_quantity if initial_quantity is not None else None
    remaining = initial_quantity if initial_quantity is not None else None
    remaining_percent = compute_remaining_percent(qty, remaining)
    
    # 生成 internal_code
    internal_code = generate_internal_code(cas_number, created_at_val, sequence)
    
    # 计算拼音字段（先检查并转换 NaN 值）
    def clean_text(val):
        """清理文本值，处理 NaN"""
        if val is None or pd.isna(val):
            return None
        if isinstance(val, float):
            return None
        return str(val).strip() if str(val).strip() else None
    
    name_clean = clean_text(name)
    category_clean = clean_text(category)
    brand_clean = clean_text(brand)
    location_clean = clean_text(location)
    
    pinyin_fields = compute_pinyin_fields(
        name=name_clean,
        category=category_clean,
        brand=brand_clean,
        storage_location=location_clean,
    )
    
    # 移除 alias_pinyin 字段（数据库表中不存在此列）
    pinyin_fields.pop('alias_pinyin', None)
    
    return {
        'internal_code': internal_code,
        'cas_number': cas_number if cas_number else '',
        'name': name if name else '',
        'english_name': english_name if english_name and not pd.isna(english_name) else None,
        'alias': alias if alias and not pd.isna(alias) else None,
        'category': category if category and not pd.isna(category) else None,
        'brand': brand if brand and not pd.isna(brand) else None,
        'storage_location': location if location and not pd.isna(location) else None,
        'initial_quantity': qty,
        'remaining_quantity': remaining,
        'remaining_percent': remaining_percent,
        'unit': unit,
        'is_hazardous': is_hazardous_val,
        'status': status_val,
        'notes': notes if notes and not pd.isna(notes) else None,
        'created_at': created_at_val,
        **pinyin_fields
    }


def main():
    # 解析命令行参数
    parser = argparse.ArgumentParser(description='导入库存数据到数据库')
    parser.add_argument('file', nargs='?', help='XLSX 文件路径')
    parser.add_argument('--db', default=DB_FILE, help='数据库文件路径')
    args = parser.parse_args()
    
    # 确定输入文件
    if args.file:
        xlsx_file = args.file
    else:
        print("错误：请提供 XLSX 文件路径")
        print("用法：python import_inventory.py <xlsx文件路径>")
        sys.exit(1)
    
    print("开始导入库存数据...")
    
    # 读取 XLSX（使用 dtype 防止 Excel 自动转换数字为日期/化学式）
    print(f"读取 XLSX 文件: {xlsx_file}")
    df = pd.read_excel(xlsx_file, dtype={'cas_number': str, 'created_at': str})
    
    print(f"列名: {df.columns.tolist()}")
    print(f"总行数: {len(df)}")
    
    # ========== 先进行数据验证 ==========
    print("正在进行数据验证...")
    is_valid, errors = validate_all_data(df)
    if not is_valid:
        print(f"\n数据验证失败！共发现 {len(errors)} 个错误：")
        for error in errors[:20]:  # 最多显示20个错误
            print(f"  - {error}")
        if len(errors) > 20:
            print(f"  ... 还有 {len(errors) - 20} 个错误")
        print("\n请修复上述错误后重新导入！")
        return
    print("数据验证通过！")
    # ========== 验证结束 ==========
    
    # 按 CAS号+日期 分组计数
    cas_date_counts = defaultdict(int)
    
    # 处理所有数据
    records = []
    for idx, row in df.iterrows():
        row_data = row.to_dict()
        
        # 获取 CAS 号和日期用于生成序列号
        cas_number = row_data.get('cas_number', '')
        created_at = row_data.get('created_at', '')
        
        # 生成日期键（如 2026-03-04 -> 260304, 2026/3/5 -> 260305）
        if created_at and not pd.isna(created_at):
            date_normalized = str(created_at).replace("/", "-")
            parts = date_normalized.split("-")
            if len(parts) >= 3:
                try:
                    year = parts[0][-2:]
                    month = parts[1].zfill(2)
                    day = parts[2].zfill(2)
                    date_str = f"{year}{month}{day}"
                except Exception:
                    date_str = 'unknown'
            else:
                date_str = 'unknown'
        else:
            date_str = 'unknown'
        
        if not cas_number or pd.isna(cas_number):
            cas_number = 'unknown'
        
        # CAS号+日期 作为分组键
        key = f"{cas_number}_{date_str}"
        cas_date_counts[key] += 1
        sequence = cas_date_counts[key]
        
        processed = process_row(row_data, sequence)
        records.append(processed)
    
    print(f"处理完成，共 {len(records)} 条记录")
    
    # 反转记录顺序，使最后插入的记录 ID 为 1
    records.reverse()
    print("已反转记录顺序，ID 将倒序分配")
    
    # 插入数据库
    print(f"连接数据库: {args.db}")
    conn = sqlite3.connect(args.db)
    cursor = conn.cursor()
    
    # 清空现有数据
    cursor.execute("DELETE FROM inventory")
    print("已清空现有库存数据")
    
    # 插入记录
    insert_sql = """
    INSERT INTO inventory (
        internal_code, cas_number, name, english_name, alias, category, brand,
        storage_location, initial_quantity, remaining_quantity, remaining_percent, unit,
        is_hazardous, status, notes, created_at, updated_at,
        name_pinyin, name_pinyin_initials,
        category_pinyin, category_pinyin_initials,
        brand_pinyin, brand_pinyin_initials,
        storage_location_pinyin, storage_location_pinyin_initials
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    inserted = 0
    errors = 0
    
    for record in records:
        try:
            cursor.execute(insert_sql, (
                record['internal_code'],
                record['cas_number'],
                record['name'],
                record['english_name'],
                record['alias'],
                record['category'],
                record['brand'],
                record['storage_location'],
                record['initial_quantity'],
                record['remaining_quantity'],
                record['remaining_percent'],
                record['unit'],
                record['is_hazardous'],
                record['status'],
                record['notes'],
                record['created_at'],
                now,
                record.get('name_pinyin'),
                record.get('name_pinyin_initials'),
                record.get('category_pinyin'),
                record.get('category_pinyin_initials'),
                record.get('brand_pinyin'),
                record.get('brand_pinyin_initials'),
                record.get('storage_location_pinyin'),
                record.get('storage_location_pinyin_initials'),
            ))
            inserted += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"插入错误: {e}")
                print(f"记录: {record}")
    
    conn.commit()
    
    # 验证
    cursor.execute("SELECT COUNT(*) FROM inventory")
    after_count = cursor.fetchone()[0]
    print(f"导入后库存记录数: {after_count}")
    print(f"插入成功: {inserted}")
    print(f"插入失败: {errors}")
    
    # 验证拼音字段
    cursor.execute("SELECT COUNT(*) FROM inventory WHERE name_pinyin IS NOT NULL AND name_pinyin != ''")
    pinyin_count = cursor.fetchone()[0]
    print(f"有名称拼音的记录数: {pinyin_count}")
    
    cursor.execute("SELECT COUNT(*) FROM inventory WHERE storage_location_pinyin IS NOT NULL AND storage_location_pinyin != ''")
    location_pinyin_count = cursor.fetchone()[0]
    print(f"有储存位置拼音的记录数: {location_pinyin_count}")
    
    conn.close()
    print("导入完成!")


if __name__ == "__main__":
    main()
