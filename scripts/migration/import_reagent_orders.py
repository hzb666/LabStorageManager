"""
试剂订单数据导入脚本
从 XLSX 文件导入数据到 SQLite 数据库
支持用户名到用户ID的自动映射和CAS号验证
"""
import pandas as pd
import sqlite3
import re
import sys
import argparse
from datetime import datetime

# 添加项目路径以便导入 pypinyin
sys.path.insert(0, 'd:/Code/LabStorageManager')

from app.services.pinyin_utils import compute_pinyin_fields
from app.services.cas_utils import validate_cas_format

# 数据库配置
DB_FILE = "d:/Code/LabStorageManager/lab_inventory.db"

# 有效状态枚举（与后端 ReagentOrderStatus.value 一致）
VALID_STATUSES = ['pending', 'approved', 'arrived', 'stocked', 'rejected']

# 有效订单原因枚举（与后端 ReagentOrderReason.value 一致）
VALID_REASONS = ['running_out', 'not_stocked', 'common_public', 'not_found',
                 'reorder', 'high_usage', 'degraded', 'not_enough', 'others']


def get_user_id_map(db_file: str) -> dict:
    """获取用户名到用户ID的映射"""
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    cursor.execute("SELECT id, username FROM users")
    user_map = {row[1]: row[0] for row in cursor.fetchall()}
    conn.close()
    return user_map


def validate_cas_number(cas_number: str) -> tuple:
    """验证 CAS 号：格式 + 校验码"""
    if not cas_number:
        return False, "CAS号不能为空"
    # 使用后端统一的 CAS 校验逻辑（包含校验码验证）
    is_valid, error = validate_cas_format(cas_number)
    if not is_valid:
        return False, f"CAS号无效：{cas_number}（{error}）"
    return True, None


def validate_name(name: str) -> tuple:
    """验证名称不能为空"""
    if not name or not name.strip():
        return False, "名称不能为空"
    return True, None


def validate_quantity(quantity) -> tuple:
    """验证数量必须大于0"""
    try:
        qty = int(quantity) if not isinstance(quantity, int) else quantity
        if qty > 0:
            return True, None
        return False, f"数量必须大于0：{quantity}"
    except:
        return False, f"数量格式错误：{quantity}"


def validate_price(price) -> tuple:
    """验证价格必须大于等于0"""
    try:
        p = float(price) if not isinstance(price, float) else price
        if p >= 0:
            return True, None
        return False, f"价格不能为负数：{price}"
    except:
        return False, f"价格格式错误：{price}"


def validate_order_time(order_time: str) -> tuple:
    """验证订单时间格式"""
    if not order_time:
        return True, None  # 可以为空
    # 尝试解析日期（支持 YYYYMMDD 格式）
    try:
        date_str = str(order_time).strip()
        if len(date_str) == 8 and date_str.isdigit():  # YYYYMMDD
            year = int(date_str[0:4])
            month = int(date_str[4:6])
            day = int(date_str[6:8])
            if 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31:
                return True, None
        # 尝试其他格式
        date_normalized = str(order_time).replace("/", "-")
        parts = date_normalized.split("-")
        if len(parts) >= 3:
            year = int(parts[0])
            month = int(parts[1])
            day = int(parts[2])
            if 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31:
                return True, None
        return False, f"订单时间格式错误：{order_time}"
    except:
        return False, f"订单时间格式错误：{order_time}"


def validate_order_reason(reason: str) -> tuple:
    """验证订单原因必须是有效枚举值"""
    if not reason:
        return True, None  # 可以为空，数据库允许 NULL
    reason_lower = reason.lower()
    if reason_lower in VALID_REASONS:
        return True, None
    return False, f"订单原因无效：{reason}（应为 running_out/not_stocked/common_public 等）"


def validate_row(row_data: dict, row_num: int, user_map: dict) -> list:
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
    
    # 验证数量
    quantity = row_data.get('quantity', 0)
    is_valid, error = validate_quantity(quantity)
    if not is_valid:
        errors.append(f"第{row_num}行: {error}")
    
    # 验证价格
    price = row_data.get('price', 0)
    is_valid, error = validate_price(price)
    if not is_valid:
        errors.append(f"第{row_num}行: {error}")
    
    # 验证订单时间
    order_time = row_data.get('order_time', '')
    is_valid, error = validate_order_time(order_time)
    if not is_valid:
        errors.append(f"第{row_num}行: {error}")
    
    # 验证订单原因
    order_reason = row_data.get('order_reason', '')
    is_valid, error = validate_order_reason(order_reason)
    if not is_valid:
        errors.append(f"第{row_num}行: {error}")
    
    # 验证申请人
    applicant = row_data.get('applicant', '')
    if applicant and applicant not in user_map:
        # 尝试小写匹配
        applicant_lower = applicant.lower()
        found = False
        for username, user_id in user_map.items():
            if username.lower() == applicant_lower:
                found = True
                break
        if not found:
            errors.append(f"第{row_num}行: 申请人 '{applicant}' 不在用户表中")
    
    return errors


def validate_all_data(df: pd.DataFrame, user_map: dict) -> tuple:
    """验证所有数据，返回是否有错误和错误列表"""
    all_errors = []
    for idx, row in df.iterrows():
        row_data = row.to_dict()
        row_num = idx + 2  # 加2因为索引从0开始且有表头行
        errors = validate_row(row_data, row_num, user_map)
        all_errors.extend(errors)
    return len(all_errors) == 0, all_errors


def parse_date(date_val) -> str:
    """解析日期为 YYYY-MM-DD 格式"""
    if not date_val:
        return None
    try:
        date_str = str(date_val).strip()
        if len(date_str) == 8 and date_str.isdigit():  # YYYYMMDD
            year = date_str[0:4]
            month = date_str[4:6]
            day = date_str[6:8]
            return f"{year}-{month}-{day}"
        # 尝试其他格式
        date_normalized = date_str.replace("/", "-")
        parts = date_normalized.split("-")
        if len(parts) >= 3:
            year = parts[0]
            month = parts[1].zfill(2)
            day = parts[2].zfill(2)
            return f"{year}-{month}-{day}"
    except:
        pass
    return None


def process_row(row_data: dict, user_map: dict) -> dict:
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
        except:
            return default
    
    def clean_int(val, default=None):
        if val is None or pd.isna(val):
            return default
        if isinstance(val, int):
            return val
        try:
            return int(float(val))
        except:
            return default
    
    # 获取字段值
    cas_number = clean_str(row_data.get('cas_number', ''))
    name = clean_str(row_data.get('name', ''))
    english_name = clean_str(row_data.get('english_name'), None)
    category = clean_str(row_data.get('category'), None)
    brand = clean_str(row_data.get('brand'), None)
    initial_quantity = clean_float(row_data.get('initial_quantity'), None)
    unit = clean_str(row_data.get('unit'), None)
    quantity = clean_int(row_data.get('quantity'), 0)
    price = clean_float(row_data.get('price'), 0)
    order_reason = clean_str(row_data.get('order_reason'), None)
    status = clean_str(row_data.get('status'), 'pending')
    applicant = clean_str(row_data.get('applicant'), None)
    order_time = clean_str(row_data.get('order_time'), None)
    
    # 处理申请人ID（用户名 -> 用户ID）
    applicant_id_val = None
    if applicant:
        # 先尝试精确匹配
        if applicant in user_map:
            applicant_id_val = user_map[applicant]
        else:
            # 尝试小写匹配
            applicant_lower = applicant.lower()
            for username, user_id in user_map.items():
                if username.lower() == applicant_lower:
                    applicant_id_val = user_id
                    break
    
    # 处理订单原因（存 value 小写），无效值回落为 NULL
    order_reason_val = order_reason.lower() if order_reason else None
    if order_reason_val and order_reason_val not in VALID_REASONS:
        order_reason_val = None

    # 处理状态（存 value 小写）
    status_val = status.lower() if status else 'pending'
    if status_val not in VALID_STATUSES:
        status_val = 'pending'
    
    # 处理订单时间（格式化为 YYYY-MM-DD）
    order_time_val = parse_date(order_time)
    
    # 计算拼音字段
    pinyin_fields = compute_pinyin_fields(
        name=name,
        category=category,
        brand=brand,
    )
    
    return {
        'cas_number': cas_number if cas_number else '',
        'name': name if name else '',
        'english_name': english_name,
        'category': category,
        'brand': brand,
        'initial_quantity': initial_quantity,
        'unit': unit,
        'quantity': quantity,
        'price': price,
        'order_reason': order_reason_val,
        'status': status_val,
        'applicant_id': applicant_id_val,
        'created_at': order_time_val,
        'name_pinyin': pinyin_fields.get('name_pinyin'),
        'name_pinyin_initials': pinyin_fields.get('name_pinyin_initials'),
        'category_pinyin': pinyin_fields.get('category_pinyin'),
        'category_pinyin_initials': pinyin_fields.get('category_pinyin_initials'),
        'brand_pinyin': pinyin_fields.get('brand_pinyin'),
        'brand_pinyin_initials': pinyin_fields.get('brand_pinyin_initials'),
    }


def main():
    # 解析命令行参数
    parser = argparse.ArgumentParser(description='导入试剂订单数据到数据库')
    parser.add_argument('file', nargs='?', help='XLSX 文件路径')
    parser.add_argument('--db', default=DB_FILE, help='数据库文件路径')
    parser.add_argument('--skip-validation', action='store_true', help='跳过数据验证')
    args = parser.parse_args()
    
    # 确定输入文件
    if args.file:
        xlsx_file = args.file
    else:
        print("错误：请提供 XLSX 文件路径")
        print("用法：python import_reagent_orders.py <xlsx文件路径>")
        sys.exit(1)
    
    print("开始导入试剂订单数据...")
    
    # 获取用户映射
    print("加载用户数据...")
    user_map = get_user_id_map(args.db)
    print(f"已加载 {len(user_map)} 个用户")
    
    # 读取 XLSX
    print(f"读取 XLSX 文件: {xlsx_file}")
    df = pd.read_excel(xlsx_file, dtype={'order_time': str})
    
    print(f"列名: {df.columns.tolist()}")
    print(f"总行数: {len(df)}")
    
    # 数据验证
    if not args.skip_validation:
        print("正在进行数据验证...")
        is_valid, errors = validate_all_data(df, user_map)
        if not is_valid:
            print(f"\n数据验证失败！共发现 {len(errors)} 个错误：")
            for error in errors[:20]:
                print(f"  - {error}")
            if len(errors) > 20:
                print(f"  ... 还有 {len(errors) - 20} 个错误")
            print("\n请修复上述错误后重新导入！")
            print("或使用 --skip-validation 参数跳过验证")
            return
        print("数据验证通过！")
    else:
        print("跳过数据验证")
    
    # 处理所有数据
    records = []
    for idx, row in df.iterrows():
        row_data = row.to_dict()
        processed = process_row(row_data, user_map)
        records.append(processed)
    
    print(f"处理完成，共 {len(records)} 条记录")

    # 倒序导入，使最后插入的记录 ID 为 1
    records.reverse()
    print("已反转记录顺序，ID 将倒序分配")

    # 连接数据库
    print(f"连接数据库: {args.db}")
    conn = sqlite3.connect(args.db)
    cursor = conn.cursor()
    
    # 清空现有数据（可选，根据需求决定是否清空）
    
    # 插入记录
    insert_sql = """
    INSERT INTO reagent_order (
        cas_number, name, english_name, category, brand, initial_quantity, unit,
        quantity, price, order_reason, applicant_id, status, created_at, updated_at,
        name_pinyin, name_pinyin_initials, category_pinyin, category_pinyin_initials,
        brand_pinyin, brand_pinyin_initials, is_hazardous
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    inserted = 0
    errors = 0
    
    for record in records:
        try:
            cursor.execute(insert_sql, (
                record['cas_number'],
                record['name'],
                record['english_name'],
                record['category'],
                record['brand'],
                record['initial_quantity'],
                record['unit'],
                record['quantity'],
                record['price'],
                record['order_reason'],
                record['applicant_id'],
                record['status'],
                record['created_at'],
                now,
                record.get('name_pinyin'),
                record.get('name_pinyin_initials'),
                record.get('category_pinyin'),
                record.get('category_pinyin_initials'),
                record.get('brand_pinyin'),
                record.get('brand_pinyin_initials'),
                0,  # is_hazardous 默认值
            ))
            inserted += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"插入错误: {e}")
                print(f"记录: {record}")
    
    conn.commit()
    
    # 验证
    cursor.execute("SELECT COUNT(*) FROM reagent_order")
    after_count = cursor.fetchone()[0]
    print(f"导入后试剂订单记录数: {after_count}")
    print(f"插入成功: {inserted}")
    print(f"插入失败: {errors}")
    
    # 验证拼音字段
    cursor.execute("SELECT COUNT(*) FROM reagent_order WHERE name_pinyin IS NOT NULL AND name_pinyin != ''")
    pinyin_count = cursor.fetchone()[0]
    print(f"有拼音的记录数: {pinyin_count}")
    
    conn.close()
    print("导入完成!")


if __name__ == "__main__":
    main()
