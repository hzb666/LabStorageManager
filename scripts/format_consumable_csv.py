#!/usr/bin/env python3
"""
Consumable CSV 格式化脚本
将原始 consumable.csv 转换为数据库可导入的格式
"""
import csv
import re
from pathlib import Path

# 中文数字映射
CN_NUM_MAP = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '两': 2
}

# 单位映射
UNIT_MAP = {
    '箱': '箱', '盒': '盒', '包': '包', '个': '个',
    '瓶': '瓶', '支': '支', '卷': '卷', '件': '件',
    '双': '双', '袋': '袋', 't': '包', '台': '台',
    '把': '把', '组': '组', '套': '套', '排': '排'
}

# 状态映射
STATUS_MAP = {
    '已采购': 'completed',
    '未采购': 'pending',
    '已完成': 'completed',
    '待采购': 'pending'
}


def parse_quantity(text: str) -> tuple[int, str | None]:
    """解析数量文本，返回 (数字, 单位)"""
    if not text or text.strip() == '':
        return 1, None
    
    text = text.strip()
    
    # 提取阿拉伯数字
    numbers = re.findall(r'\d+', text)
    if numbers:
        qty = int(numbers[0])
        # 提取单位
        for unit in UNIT_MAP:
            if unit in text:
                return qty, UNIT_MAP[unit]
        return qty, None
    
    # 处理中文数字
    for cn, num in CN_NUM_MAP.items():
        if cn in text:
            for unit in UNIT_MAP:
                if unit in text:
                    return num, UNIT_MAP[unit]
            return num, None
    
    # 无法解析，默认 1
    return 1, None


def parse_date(text: str) -> str:
    """解析中文日期格式，返回 ISO 格式"""
    if not text or text.strip() == '':
        return ''
    
    text = text.strip()
    
    # 匹配格式: 2021年4月27日
    match = re.match(r'(\d+)年(\d+)月(\d+)日', text)
    if match:
        year, month, day = match.groups()
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}T00:00:00"
    
    # 匹配格式: 20260122 (YYYYMMDD)
    match = re.match(r'^(\d{4})(\d{2})(\d{2})$', text)
    if match:
        year, month, day = match.groups()
        return f"{year}-{month}-{day}T00:00:00"
    
    # 无法解析时返回空字符串
    return ''


def map_status(text: str) -> str:
    """映射状态值"""
    if not text or text.strip() == '':
        return 'pending'
    
    text = text.strip()
    return STATUS_MAP.get(text, 'pending')


def load_user_mapping(path: str) -> dict[str, str]:
    """加载用户映射表"""
    mapping = {}
    p = Path(path)
    if not p.exists():
        return mapping
    
    with open(p, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # 格式: original_name, username, status
            original_name = row.get('original_name', '').strip()
            username = row.get('username', '').strip()
            if original_name and username:
                mapping[original_name] = username
    return mapping


def main():
    local_dir = Path('scripts/local')
    input_file = local_dir / 'consumable.csv'
    output_file = local_dir / 'consumable_formatted_v5.csv'
    user_mapping_file = local_dir / 'migration' / 'user_mapping.csv'
    
    # 加载用户映射
    user_map = load_user_mapping(str(user_mapping_file))
    
    # 读取原始 CSV
    with open(input_file, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    # 输出格式化后的 CSV
    # 输出 CSV 中实际存在字段对应的数据库字段
    output_fields = [
        'name',           # 耗材名称
        'specification',  # 规格
        'product_code',   # 货号
        'quantity',       # 数量
        'unit',           # 单位
        'communication',  # 交流备注 (原备注)
        'applicant_name', # 申请人姓名
        'applicant_id',  # 申请人ID
        'status',         # 状态
        'created_at',     # 创建时间
    ]
    
    with open(output_file, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=output_fields)
        writer.writeheader()
        
        for row in rows:
            # 解析数量
            qty, unit = parse_quantity(row.get('数量', ''))
            
            # 解析日期
            created_at = parse_date(row.get('登记时间', ''))
            
            # 映射状态
            status = map_status(row.get('状态', ''))
            
            # 映射用户
            applicant_name = row.get('订购人', '').strip()
            # 使用 username 作为 applicant_id
            applicant_id = user_map.get(applicant_name, '')
            
            # 构建新行
            new_row = {
                'name': row.get('耗材名称', '').strip(),
                'specification': row.get('规格', '').strip(),
                'product_code': row.get('货号', '').strip(),
                'quantity': qty,
                'unit': unit if unit else '',
                'communication': row.get('备注', '').strip(),
                'applicant_name': applicant_name,  # 申请人姓名
                'applicant_id': applicant_id,
                'status': status,
                'created_at': created_at,
            }
            
            writer.writerow(new_row)
    
    print(f"格式化完成，共处理 {len(rows)} 条记录")
    print(f"输出文件: {output_file}")


if __name__ == '__main__':
    main()
