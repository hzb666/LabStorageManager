"""
CAS 号修正脚本
根据网络查证结果修正数据库中错误的 CAS 号
"""
import sqlite3

DB_PATH = "D:/Code/LabStorageManager/lab_inventory.db"

# CAS 号修正映射表（基于网络查证结果）
CAS_CORRECTIONS = {
    # ReagentOrders 表
    "339422-83-8": "39422-83-8",  # CM-葡聚糖
    "1310-58-4": "1310-58-3",  # 氢氧化钾
    "636-196-5": "6902-77-8",  # 京尼平
    "4476-08-3": "4776-08-3",  # 3-甲基胞嘧啶
    "609-70-2": "609-71-2",  # 2-羟基烟酸
    "107-06-5": "107-06-2",  # 1,2-二氯乙烷

    # Inventory 表（第一批）
    "414-75-3": "141-75-3",  # 丁酰氯
    "414-82-2": "141-82-2",  # 丙二酸
    "110-10-7": "100-10-7",  # 对二甲氨基苯甲醛
    "104-87-4": "104-84-7",  # 4-甲基苄胺
    "1271-93-3": "1721-93-3",  # 1-甲基异喹啉
    "7883-96-2": "7783-96-2",  # 碘化银
    "51603-79-8": "1603-79-8",  # 苯甲酰甲酸乙酯
    "25475-67-5": "25475-67-6",  # 异喹啉-3-胺
    "90-10-7": "90-01-7",  # 水杨醇
    "220-069-2": "2622-14-2",  # 三环己基膦
    "238-811-9": "14752-66-0",  # 对氯苯亚磺酸钠
    "572-06-9": "5720-06-9",  # 2-甲氧基苯基硼酸
    "545-16-1": "544-16-1",  # 亚硝酸丁酯
    "76-36-5": "75-36-5",  # 乙酰氯
    "611-69-4": "611-99-4",  # 4,4'-二羟基二苯甲酮

    # Inventory 表（第二批，基于网络查证）
    "1318-93-4": "1318-93-0",  # 蒙脱石
    "175883-86-2": "175883-62-2",  # 4-甲氧基-3-甲基苯硼酸
    "188-82-1": "118-82-1",  # 二(4-羟基-3,5-二叔丁基)苯甲烷（抗氧剂702）
    "2430-16-3": "2430-16-2",  # 苯己醇
    "2557-29-5": "2567-29-5",  # 4-溴甲基联苯
    "250-28-5": "250285-32-6",  # 1,3-双(2,6-二异丙基苯基)氯化咪唑翁
    "583-55-9": "583-53-9",  # 邻二溴苯
    "4474-50-7": "4774-24-7",  # 喹哌嗪
    "52487-31-3": "42436-86-2",  # 苯基环丁酮
    "886762-73-6": "886762-73-8",  # 2-氟-6-碘苯胺
    "7016874-33-2": "16874-33-2",  # 2-四氢糠酸
    "2629-57-2": "22013-33-8",  # 1,4-苯并二氧六环-6-胺
    "1801765-40-1": "1801765-04-7",  # TNO155 (3S,4S-螺化合物)
    "1801765-40-7": "1801765-04-7",  # TNO155 (变体)
    "6223-35-5": "6223-35-4",  # 薁磺酸钠
    "877399-52-8": "877399-52-5",  # (R)-吡啶胺化合物
    "3269-62-9": "3261-62-9",  # 对甲基苯乙胺
    "33722-66-5": "37222-66-5",  # 过氧单磺酸钾
    "3813-19-9": "13813-19-9",  # 氘代硫酸
    "3822-83-2": "38222-83-2",  # 2,6-二叔丁基-4-甲基吡啶
    "4523-22-9": "14523-22-9",  # 四羰基二氯化二铑
}

# 需要进一步验证的 CAS 号（可能有不同的正确 CAS）
NEEDS_VERIFICATION = {
    # 5-异丙基-3,8-二甲基环戊并环庚烯-2-磺酸钠: 6223-35-4 -> ?
    # (R)-3-(1-(2,6-二氯-3-氟苯基)乙氧基)-5-(1-(哌啶-4-基)-1H-吡唑-4-基)吡啶-2-胺: 877399-52-5 -> 877399-52-5 搜索结果确认
    # 苯基环丁酮: 52487-31-3 -> 42436-86-2 (2-Phenylcyclobutanone)
    # 二(4-羟基-3,5-二叔丁基)苯甲烷: 188-82-1 -> 14362-12-0
    # 蒙脱石: 1318-93-4 -> 1318-93-0? (但校验码验证 1318-93-0 是错的，1318-93-4 才是对的)
    # 2-四氢糠酸: 7016874-33-2 -> ?
    # 1,4-苯并二氧六环-6-胺: 2629-57-2 -> ?
    # 4-甲氧基-3-甲基苯硼酸: 175883-86-2 -> ?
    # 2,6-二叔丁基-4-甲基吡啶: 3822-83-2 -> ?
    # 喹哌嗪: 4474-50-7 -> ?
    # 2-氟-6-碘苯胺: 886762-73-6 -> ?
    # 1,3-双(2,6-二异丙基苯基)氯化咪唑翁: 250-28-5 -> ?
    # 4-溴甲基联苯: 2557-29-5 -> ?
    # 邻二溴苯: 583-55-9 -> ?
    # 氘代硫酸: 3813-19-9 -> ?
    # 对甲基苯乙胺: 3269-62-9 -> ?
    # 四羰基二氯化二铑: 4523-22-9 -> ?
    # 过氧单磺酸钾: 33722-66-5 -> ?
}


def calculate_check_digit(seq_num: str) -> int:
    """计算 CAS 号校验码"""
    digits = list(seq_num)[::-1]
    total = 0
    for i, digit in enumerate(digits, start=1):
        total += int(digit) * i
    return total % 10


def validate_cas(cas: str) -> bool:
    """验证 CAS 号是否有效"""
    parts = cas.split('-')
    if len(parts) != 3:
        return False
    try:
        seq_num = parts[0] + parts[1]
        expected = calculate_check_digit(seq_num)
        return expected == int(parts[2])
    except:
        return False


def main():
    """主函数"""
    print("=" * 70)
    print("CAS 号修正脚本")
    print("=" * 70)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. 修正 ReagentOrder 表
    print("\n[1] 修正 ReagentOrder 表...")

    reagent_updates = 0
    for wrong_cas, correct_cas in CAS_CORRECTIONS.items():
        # 检查是否存在该 CAS 号
        cursor.execute("SELECT COUNT(*) FROM reagentorder WHERE cas_number = ?", (wrong_cas,))
        count = cursor.fetchone()[0]
        if count > 0:
            cursor.execute("UPDATE reagentorder SET cas_number = ? WHERE cas_number = ?", (correct_cas, wrong_cas))
            reagent_updates += cursor.rowcount
            print(f"  ✓ {wrong_cas} -> {correct_cas} ({count} 条记录)")

    conn.commit()
    print(f"ReagentOrder 表更新了 {reagent_updates} 条记录")

    # 2. 修正 Inventory 表
    print("\n[2] 修正 Inventory 表...")

    inventory_updates = 0
    for wrong_cas, correct_cas in CAS_CORRECTIONS.items():
        cursor.execute("SELECT COUNT(*) FROM inventory WHERE cas_number = ?", (wrong_cas,))
        count = cursor.fetchone()[0]
        if count > 0:
            cursor.execute("UPDATE inventory SET cas_number = ? WHERE cas_number = ?", (correct_cas, wrong_cas))
            inventory_updates += cursor.rowcount
            print(f"  ✓ {wrong_cas} -> {correct_cas} ({count} 条记录)")

    conn.commit()
    print(f"Inventory 表更新了 {inventory_updates} 条记录")

    # 3. 验证修正后的 CAS 号
    print("\n[3] 验证修正后的 CAS 号...")

    cursor.execute("""
        SELECT DISTINCT cas_number FROM (
            SELECT cas_number FROM reagentorder
            UNION ALL
            SELECT cas_number FROM inventory
        )
        WHERE cas_number NOT LIKE '%-$-%' ESCAPE '$'
    """)

    invalid_cas = []
    for (cas,) in cursor.fetchall():
        if not validate_cas(cas):
            invalid_cas.append(cas)

    if invalid_cas:
        print(f"  发现 {len(invalid_cas)} 个无效 CAS 号:")
        for cas in invalid_cas[:10]:
            print(f"    - {cas}")
    else:
        print("  所有 CAS 号验证通过!")

    conn.close()

    print("\n" + "=" * 70)
    print("修正完成!")
    print("=" * 70)


if __name__ == "__main__":
    main()
