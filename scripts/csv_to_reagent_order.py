#!/usr/bin/env python3
"""
CSV 导入试剂订单脚本

功能：将 CSV 文件直接导入到试剂订单数据库
CSV 列（与数据库字段名一致）：cas_number, name, english_name, brand, specification, quantity, price, order_reason, applicant, order_time

特性：
- 支持多种编码（UTF-8, GBK, GB2312）
- 自动 CAS 号标准化（去除空格、大写）
- 自动解析 specification 为 initial_quantity + unit
- 支持 order_reason 枚举值: none, running_out, not_stocked, common_public, not_found, reorder, high_usage, degraded
"""

import sys
import os
import re
import pandas as pd
from pathlib import Path
from datetime import datetime
from typing import Optional

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

# 导入时间工具
from app.core.time_utils import get_utc_now

# 数据库配置
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./lab_inventory.db")


def parse_specification_with_quantity(spec: str) -> tuple[Optional[float], Optional[str], Optional[int]]:
    """
    解析规格字符串，返回 (数值, 单位, 数量)
    支持格式: 
      - "500ml", "500 ml", "1L" -> (500, "ml", 1)
      - "2x500ml", "2*500ml", "3*5mL" -> (500, "ml", 2) 或 (5, "mL", 3)
      - "2x（10x0.6 mL）" -> (0.6, "mL", 20) 即 2*10=20个
      - "500*2=1000mL" -> (500, "mL", 2)
      - "25*2=50g" -> (25, "g", 2)
    """
    if not spec or pd.isna(spec):
        return None, None, 1
    
    spec = str(spec).strip()
    
    # 记录原始规格（用于无法解析时）
    original_spec = spec
    
    # 预处理：去除空格、转小写
    spec_lower = spec.lower()
    
    # 模式1: 2x（10x0.6 mL）这种嵌套格式
    # 先处理外层的数量
    match_nested = re.match(r'^(\d+)\s*[x*]\s*[\（\(](\d+)\s*[x*]\s*(\d+\.?\d*)\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)[\）\)]$', spec_lower)
    if match_nested:
        outer_num = int(match_nested.group(1))
        inner_num = int(match_nested.group(2))
        value = float(match_nested.group(3))
        unit = match_nested.group(4)
        quantity = outer_num * inner_num
        return value, unit, quantity
    
    # 模式2: 500*2=1000mL 这种等号格式
    match_eq = re.match(r'^(\d+\.?\d*)\s*\*\s*(\d+)\s*=\s*(\d+\.?\d*)\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)$', spec_lower)
    if match_eq:
        value = float(match_eq.group(1))
        unit = match_eq.group(4)
        quantity = int(match_eq.group(2))
        return value, unit, quantity
    
    # 模式3: 2x500ml, 2*500ml, 3*5mL 这种直接乘格式
    match_mult = re.match(r'^(\d+)\s*[x*]\s*(\d+\.?\d*)\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)$', spec_lower)
    if match_mult:
        quantity = int(match_mult.group(1))
        value = float(match_mult.group(2))
        unit = match_mult.group(3)
        return value, unit, quantity
    
    # 模式4: 标准格式 500ml, 500 ml
    match = re.match(r'^(\d+\.?\d*)\s*(ml|l|g|kg|mg|个|瓶|支|盒|包|套)$', spec_lower)
    if match:
        value = float(match.group(1))
        unit = match.group(2)
        return value, unit, 1
    
    # 无法解析，返回原始值
    return None, None, 1


def normalize_cas(cas: str) -> str:
    """标准化 CAS 号"""
    if not cas or pd.isna(cas):
        return ""
    # 去除空格、转大写
    return str(cas).strip().upper()


def validate_cas_format(cas: str) -> tuple[bool, Optional[str]]:
    """验证 CAS 号格式"""
    if not cas:
        return False, "CAS号不能为空"
    
    # CAS 号格式: XXXXXX-XX-X
    pattern = r'^\d{2,7}-\d{2}-\d$'
    if not re.match(pattern, cas):
        return False, "CAS号格式不正确，应为 XXXXXX-XX-X"
    
    return True, None


def import_csv_to_reagent_orders(csv_path: str, dry_run: bool = False):
    """
    将 CSV 文件导入到试剂订单数据库
    """
    print(f"正在读取 CSV 文件: {csv_path}")
    
    # 尝试多种编码
    encodings = ['utf-8-sig', 'utf-8', 'gbk', 'gb2312']
    df = None
    last_error = None
    
    for encoding in encodings:
        try:
            df = pd.read_csv(csv_path, encoding=encoding)
            print(f"成功使用 {encoding} 编码读取文件")
            break
        except Exception as e:
            last_error = str(e)
            print(f"  {encoding} 编码失败: {e}")
    
    if df is None:
        raise ValueError(f"无法读取 CSV 文件，请检查编码。\n错误: {last_error}")
    
    # 标准化列名（去除空格）
    df.columns = [col.strip() if isinstance(col, str) else col for col in df.columns]
    print(f"CSV 列名: {list(df.columns)}")
    print(f"共 {len(df)} 行数据")
    
    # 验证必要的列
    required_cols = ['cas_number', 'name']
    missing_cols = [col for col in required_cols if col not in df.columns]
    if missing_cols:
        raise ValueError(f"CSV 文件缺少必要的列: {missing_cols}")
    
    # 连接数据库
    engine = create_engine(DATABASE_URL, echo=False)
    
    # 导入 SQLModel 定义
    from app.models.reagent_order import ReagentOrder, ReagentOrderReason, ReagentOrderStatus
    from app.models.user import User
    
    # 创建表（如果不存在）
    SQLModel.metadata.create_all(engine)
    
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # 获取所有用户用于匹配 applicant
    all_users = session.query(User).all()
    users_map = {u.username: u.id for u in all_users}
    users_map.update({u.full_name: u.id for u in all_users if u.full_name})
    
    # 处理每一行
    success_count = 0
    error_count = 0
    errors = []
    
    for idx, row in df.iterrows():
        row_num = idx + 2  # CSV 行号（1-based，跳过表头）
        
        try:
            # 跳过空行
            if pd.isna(row.get('name')):
                continue
            
            # 标准化 CAS 号
            cas_number = normalize_cas(row.get('cas_number', ''))
            
            # 验证 CAS 号
            if cas_number:
                is_valid, error = validate_cas_format(cas_number)
                if not is_valid:
                    errors.append(f"行 {row_num}: CAS号格式错误 '{row.get('cas_number')}' - {error}")
                    error_count += 1
                    continue
            
            # 解析规格（同时获取数量）
            specification = str(row.get('specification', '')).strip() if pd.notna(row.get('specification')) else ''
            initial_quantity, unit, parsed_quantity = parse_specification_with_quantity(specification)
            
            # 如果 CSV 中 quantity 列有正确的值，使用它；否则使用从规格解析的数量
            csv_quantity = row.get('quantity')
            if pd.notna(csv_quantity):
                try:
                    quantity = int(float(csv_quantity))
                except:
                    quantity = parsed_quantity
            else:
                quantity = parsed_quantity
            
            # 解析价格
            price = row.get('price')
            if pd.notna(price):
                try:
                    price = float(price)
                except:
                    price = None
            else:
                price = None
            
            # 解析 order_reason
            order_reason_str = str(row.get('order_reason', 'none')).strip().lower()
            if order_reason_str in ['running_out', 'not_stocked', 'common_public', 'not_found', 'reorder', 'none', 'high_usage', 'degraded']:
                order_reason = ReagentOrderReason(order_reason_str)
            else:
                order_reason = ReagentOrderReason.NONE
            
            # 匹配申请人
            applicant_name = str(row.get('applicant', '')).strip() if pd.notna(row.get('applicant')) else ''
            applicant_id = users_map.get(applicant_name) if applicant_name else None
            
            # 解析 order_time 作为创建时间
            created_at = None
            order_time = row.get('order_time')
            if pd.notna(order_time):
                try:
                    # order_time 格式: 20240715.0 或 20240715
                    order_time_str = str(order_time).replace('.0', '')
                    if len(order_time_str) == 8:
                        created_at = datetime.strptime(order_time_str, '%Y%m%d')
                except Exception as e:
                    print(f"  警告: 无法解析 order_time '{order_time}': {e}")
            
            # 构建订单对象
            order = ReagentOrder(
                cas_number=cas_number,
                name=str(row.get('name', '')).strip(),
                english_name=str(row.get('english_name', '')).strip() if pd.notna(row.get('english_name')) else None,
                brand=str(row.get('brand', '')).strip() if pd.notna(row.get('brand')) else None,
                initial_quantity=initial_quantity,
                unit=unit,
                quantity=quantity,
                price=price,
                order_reason=order_reason,
                applicant_id=applicant_id,
                status=ReagentOrderStatus.ARRIVED,  # 设为已到货
                created_at=created_at if created_at else get_utc_now(),
            )
            
            if not dry_run:
                session.add(order)
                session.flush()  # 获取 ID
                print(f"  ✓ 行 {row_num}: {order.name} (CAS: {cas_number})")
            else:
                print(f"  [dry-run] 行 {row_num}: {order.name} (CAS: {cas_number})")
            
            success_count += 1
            
        except Exception as e:
            errors.append(f"行 {row_num}: {str(e)}")
            error_count += 1
            print(f"  ✗ 行 {row_num}: {e}")
    
    # 提交事务
    if not dry_run and success_count > 0:
        session.commit()
        print(f"\n已提交 {success_count} 条记录到数据库")
    
    session.close()
    
    # 输出结果
    print("\n" + "=" * 50)
    print(f"导入完成！")
    print(f"  成功: {success_count}")
    print(f"  失败: {error_count}")
    print("=" * 50)
    
    if errors:
        print("\n错误详情:")
        for err in errors[:20]:  # 最多显示20条
            print(f"  - {err}")
        if len(errors) > 20:
            print(f"  ... 还有 {len(errors) - 20} 条错误")
    
    return {
        'success': success_count,
        'errors': error_count,
        'details': errors
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python csv_to_reagent_order.py <csv文件路径> [--dry-run]")
        print("\n示例:")
        print("  python csv_to_reagent_order.py 试剂订单.csv        # 导入数据")
        print("  python csv_to_reagent_order.py 试剂订单.csv --dry-run  # 预览模式，不写入数据库")
        print("\nCSV 列名（必须与数据库字段名一致）:")
        print("  cas_number, name, english_name, brand, specification, quantity, price, order_reason, applicant, order_time")
        sys.exit(1)
    
    csv_path = sys.argv[1]
    dry_run = '--dry-run' in sys.argv
    
    if dry_run:
        print("=" * 50)
        print("运行在 DRY-RUN 模式，不会写入数据库！")
        print("=" * 50 + "\n")
    
    try:
        import_csv_to_reagent_orders(csv_path, dry_run=dry_run)
    except Exception as e:
        print(f"\n错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
