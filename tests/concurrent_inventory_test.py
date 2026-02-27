"""
并发库存写入测试脚本
模拟100个并发请求，每个请求写入1000条数据，总共10万条
直接操作数据库进行测试

使用方法:
    cd D:/Code/LabStorageManager
    set PYTHONPATH=D:/Code/LabStorageManager
    python tests/concurrent_inventory_test.py
"""
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import random
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# 测试配置
CONCURRENT_REQUESTS = 100  # 并发请求数
ITEMS_PER_REQUEST = 1000  # 每个请求写入的数据量


# 测试用的CAS号列表（有效的CAS号格式）
TEST_CAS_NUMBERS = [
    "64-17-5",     # 乙醇
    "7732-18-5",   # 水
    "67-68-5",     # DMSO
    "60-24-2",     # 2-巯基乙醇
    "1310-73-2",   # 氢氧化钠
    "64-19-7",     # 乙酸
    "7664-93-9",   # 硫酸
    "67-56-1",     # 甲醇
    "71-43-2",     # 苯
    "108-95-2",    # 苯酚
]


def parse_specification(spec: str):
    """解析规格字符串为数值和单位"""
    match = re.match(r'(\d+\.?\d*)(ml|L|g|kg|mg)', spec)
    if match:
        return float(match.group(1)), match.group(2)
    return 500.0, "ml"


def create_batch(batch_index: int) -> dict:
    """创建一批库存数据"""
    from app.database import Session, engine
    from app.models.inventory import Inventory, InventoryStatus
    from app.services.internal_code import generate_internal_code
    
    session = Session(bind=engine)
    try:
        # 随机选择CAS号和规格
        cas_number = random.choice(TEST_CAS_NUMBERS)
        specification = f"{random.randint(100, 2000)}{random.choice(['ml', 'L', 'g'])}"
        value, unit = parse_specification(specification)
        
        # 生成内部编码
        internal_codes = generate_internal_code(session, cas_number, ITEMS_PER_REQUEST)
        
        # 批量创建库存对象
        items = []
        for internal_code in internal_codes:
            item = Inventory(
                internal_code=internal_code,
                cas_number=cas_number,
                name=f"测试试剂-{batch_index}-{random.randint(1000, 9999)}",
                category=random.choice(["分析纯", "生化试剂", "色谱试剂", "标准品"]),
                brand=random.choice(["Sigma", "Aladdin", "TCI", "Merk", "国药"]),
                storage_location=random.choice(["A1-01", "A2-02", "B1-03", "B2-04", "C1-05"]),
                initial_quantity=value,
                remaining_quantity=value,
                unit=unit,
                is_hazardous=random.choice([True, False]),
                status=InventoryStatus.IN_STOCK,
                notes=f"并发测试批次 {batch_index}"
            )
            items.append(item)
        
        # 批量提交
        session.add_all(items)
        session.commit()
        
        return {
            "batch_index": batch_index,
            "success": True,
            "items_created": len(items),
            "cas_number": cas_number,
            "specification": specification
        }
        
    except Exception as e:
        session.rollback()
        return {
            "batch_index": batch_index,
            "success": False,
            "error": str(e)
        }
    finally:
        session.close()


def verify_data():
    """验证数据库中的数据"""
    from app.database import Session, engine
    from app.models.inventory import Inventory
    from sqlmodel import select, func
    
    session = Session(bind=engine)
    try:
        # 统计总条数
        total = session.exec(select(func.count()).select_from(Inventory)).one()
        
        # 按CAS号统计
        cas_stats = session.exec(
            select(Inventory.cas_number, func.count(Inventory.id))
            .group_by(Inventory.cas_number)
        ).all()
        
        return {
            "total_count": total,
            "cas_stats": dict(cas_stats)
        }
    finally:
        session.close()


def run_concurrent_test():
    """运行并发测试"""
    print("=" * 60)
    print("并发库存写入测试")
    print("=" * 60)
    print(f"并发数: {CONCURRENT_REQUESTS}")
    print(f"每批数据量: {ITEMS_PER_REQUEST}")
    print(f"预计总数据量: {CONCURRENT_REQUESTS * ITEMS_PER_REQUEST}")
    print("=" * 60)
    
    # 先查看当前数据量
    print("\n[测试前] 验证数据库当前状态...")
    before_data = verify_data()
    print(f"当前库存总数: {before_data['total_count']}")
    
    # 运行并发测试
    print(f"\n[开始] 启动 {CONCURRENT_REQUESTS} 个并发线程写入数据...")
    start_time = time.time()
    
    results = []
    with ThreadPoolExecutor(max_workers=CONCURRENT_REQUESTS) as executor:
        # 提交所有任务
        futures = [executor.submit(create_batch, i) for i in range(CONCURRENT_REQUESTS)]
        
        # 收集结果
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            if result["success"]:
                print(f"  批次 {result['batch_index']}: 成功写入 {result['items_created']} 条")
            else:
                print(f"  批次 {result['batch_index']}: 失败 - {result.get('error', 'Unknown')}")
    
    total_time = time.time() - start_time
    
    # 统计结果
    success_count = sum(1 for r in results if r["success"])
    failed_count = len(results) - success_count
    total_items = sum(r.get("items_created", 0) for r in results if r["success"])
    
    print("\n" + "=" * 60)
    print("测试结果统计")
    print("=" * 60)
    print(f"总请求数: {len(results)}")
    print(f"成功: {success_count}")
    print(f"失败: {failed_count}")
    print(f"总写入数据: {total_items}")
    print(f"总耗时: {total_time:.2f} 秒")
    print(f"平均每批耗时: {total_time/CONCURRENT_REQUESTS:.2f} 秒")
    print(f"吞吐量: {total_items/total_time:.2f} 条/秒")
    print("=" * 60)
    
    # 验证写入后的数据
    print("\n[测试后] 验证数据库数据...")
    after_data = verify_data()
    print(f"库存总数: {after_data['total_count']}")
    print(f"新增数据: {after_data['total_count'] - before_data['total_count']}")
    print("\n按CAS号分布:")
    for cas, count in after_data['cas_stats'].items():
        print(f"  {cas}: {count} 条")
    
    return {
        "total_requests": len(results),
        "success_count": success_count,
        "failed_count": failed_count,
        "total_items": total_items,
        "total_time": total_time,
        "avg_time_per_batch": total_time / CONCURRENT_REQUESTS,
        "throughput": total_items / total_time if total_time > 0 else 0,
        "before_count": before_data['total_count'],
        "after_count": after_data['total_count']
    }


if __name__ == "__main__":
    result = run_concurrent_test()
    
    print("\n" + "=" * 60)
    print("测试完成!")
    print("=" * 60)
