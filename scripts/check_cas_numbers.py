"""
CAS 号合法性检查脚本

CAS 号格式: XXX-XX-X 或 XXXX-XX-X 等，三段数字用连字符分隔
- 第一段: 2-7 位数字
- 第二段: 2 位数字
- 第三段: 1 位校验码

校验码计算:
  将前两段数字从右向左依次乘以 1, 2, 3...，求和后取模10
"""
# ruff: noqa: E402

import re
import sys
from pathlib import Path

# 添加项目根目录到模块搜索路径，确保可导入 app.*
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sqlmodel import Session, select
from app.database import engine
from app.models.reagent_order import ReagentOrder
from app.models.inventory import Inventory


def validate_cas_format(cas: str) -> tuple[bool, str]:
    """
    验证 CAS 号格式和校验码
    返回: (是否合法, 错误信息)
    """
    if not cas or not isinstance(cas, str):
        return False, "为空或非字符串"

    cas = cas.strip()

    # 1. 检查基本格式: 三段数字用连字符分隔
    pattern = r'^(\d{2,7})-(\d{2})-(\d)$'
    match = re.match(pattern, cas)
    if not match:
        # 尝试更宽松的格式检查
        parts = cas.split('-')
        if len(parts) != 3:
            return False, f"格式错误: 应为 '数字-数字-数字'，实际为 '{cas}'"
        if not all(p.isdigit() for p in parts):
            return False, f"格式错误: 包含非数字字符 '{cas}'"
        if not (2 <= len(parts[0]) <= 7):
            return False, f"第一段长度错误: 应为 2-7 位，实际为 {len(parts[0])} 位 '{cas}'"
        if len(parts[1]) != 2:
            return False, f"第二段长度错误: 应为 2 位，实际为 {len(parts[1])} 位 '{cas}'"
        if len(parts[2]) != 1:
            return False, f"第三段长度错误: 应为 1 位，实际为 {len(parts[2])} 位 '{cas}'"

    part1, part2, check_digit = match.groups() if match else (parts[0], parts[1], parts[2])

    # 2. 计算校验码（标准递增权重算法）
    digits = list(part1 + part2)
    digits.reverse()  # 从右向左

    total = 0
    for i, digit in enumerate(digits, start=1):  # 递增权重 1, 2, 3...
        total += int(digit) * i

    calculated_check = total % 10

    if int(check_digit) != calculated_check:
        return False, f"校验码错误: 输入 '{check_digit}'，应为 '{calculated_check}' (计算总和={total})"

    return True, "合法"


def check_reagent_orders() -> dict:
    """检查试剂订单表"""
    results = {
        "total": 0,
        "valid": 0,
        "invalid": 0,
        "empty": 0,
        "invalid_cas": [],
        "empty_cas": [],
    }

    with Session(engine) as session:
        orders = session.exec(select(ReagentOrder)).all()
        results["total"] = len(orders)

        for order in orders:
            cas = order.cas_number
            if not cas or not cas.strip():
                results["empty"] += 1
                results["empty_cas"].append({
                    "id": order.id,
                    "name": order.name,
                    "cas_number": repr(cas),
                })
                continue

            is_valid, msg = validate_cas_format(cas)
            if is_valid:
                results["valid"] += 1
            else:
                results["invalid"] += 1
                results["invalid_cas"].append({
                    "id": order.id,
                    "name": order.name,
                    "cas_number": cas,
                    "reason": msg,
                })

    return results


def check_inventory() -> dict:
    """检查库存表"""
    results = {
        "total": 0,
        "valid": 0,
        "invalid": 0,
        "empty": 0,
        "invalid_cas": [],
        "empty_cas": [],
    }

    with Session(engine) as session:
        items = session.exec(select(Inventory)).all()
        results["total"] = len(items)

        for item in items:
            cas = item.cas_number
            if not cas or not cas.strip():
                results["empty"] += 1
                results["empty_cas"].append({
                    "id": item.id,
                    "name": item.name,
                    "cas_number": repr(cas),
                })
                continue

            is_valid, msg = validate_cas_format(cas)
            if is_valid:
                results["valid"] += 1
            else:
                results["invalid"] += 1
                results["invalid_cas"].append({
                    "id": item.id,
                    "name": item.name,
                    "cas_number": cas,
                    "reason": msg,
                })

    return results


def main():
    print("=" * 60)
    print("CAS 号合法性检查")
    print("=" * 60)

    # 检查试剂订单
    print("\n[1] 检查 ReagentOrder (试剂订单表)...")
    order_results = check_reagent_orders()

    print(f"  总数: {order_results['total']}")
    print(f"  合法: {order_results['valid']}")
    print(f"  非法: {order_results['invalid']}")
    print(f"  空值: {order_results['empty']}")

    if order_results["invalid_cas"]:
        print(f"\n  非法 CAS 号 (共 {len(order_results['invalid_cas'])} 条):")
        for item in order_results["invalid_cas"]:
            print(f"    ID={item['id']}, 名称={item['name']}, CAS={item['cas_number']}, 原因={item['reason']}")

    if order_results["empty_cas"]:
        print(f"\n  空 CAS 号 (共 {len(order_results['empty_cas'])} 条):")
        for item in order_results["empty_cas"]:
            print(f"    ID={item['id']}, 名称={item['name']}, CAS={item['cas_number']}")

    # 检查库存
    print("\n" + "-" * 60)
    print("\n[2] 检查 Inventory (库存表)...")
    inv_results = check_inventory()

    print(f"  总数: {inv_results['total']}")
    print(f"  合法: {inv_results['valid']}")
    print(f"  非法: {inv_results['invalid']}")
    print(f"  空值: {inv_results['empty']}")

    if inv_results["invalid_cas"]:
        print(f"\n  非法 CAS 号 (共 {len(inv_results['invalid_cas'])} 条):")
        for item in inv_results["invalid_cas"]:
            print(f"    ID={item['id']}, 名称={item['name']}, CAS={item['cas_number']}, 原因={item['reason']}")

    if inv_results["empty_cas"]:
        print(f"\n  空 CAS 号 (共 {len(inv_results['empty_cas'])} 条):")
        for item in inv_results["empty_cas"]:
            print(f"    ID={item['id']}, 名称={item['name']}, CAS={item['cas_number']}")

    # 总结
    print("\n" + "=" * 60)
    total_invalid = order_results["invalid"] + inv_results["invalid"]
    total_empty = order_results["empty"] + inv_results["empty"]
    print(f"总结: 共发现 {total_invalid} 条非法 CAS 号, {total_empty} 条空值")
    print("=" * 60)


if __name__ == "__main__":
    main()
