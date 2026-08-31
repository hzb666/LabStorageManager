"""
CAS 号查证脚本
通过化学物质名称搜索权威来源获取正确的 CAS 号
"""
import time

import requests

# 数据库路径
DB_PATH = "D:/Code/LabStorageManager/data/lab_storage.db"

# 化学物质名称映射表（从检测结果中提取）
CAS_CORRECTIONS = {
    # ReagentOrders 表中的错误
    "339422-83-8": "CM-葡聚糖",
    "6223-35-4": "5-异丙基-3,8-二甲基环戊并环庚烯-2-磺酸钠",
    "877399-52-5": "(R)-3-(1-(2,6-二氯-3-氟苯基)乙氧基)-5-(1-(哌啶-4-基)-1H-吡唑-4-基)吡啶-2-胺",
    "1310-58-3": "氢氧化钾（粉末）",
    "1801765-40-1": "(3S,4S)-8-(6-氨基-5-((2-氨基-3-氯吡啶基-4-基)硫代)吡嗪-2-基)-3-甲基-2-氧杂-8-氮杂螺[4.5]癸-4-胺",
    "636-196-5": "京尼平",
    "4476-08-3": "3-甲基胞嘧啶",
    "609-70-1": "2-羟基烟酸",
    "52487-31-7": "苯基环丁酮",
    "107-06-5": "1,2-二氯乙烷",

    # Inventory 表中的错误
    "414-75-3": "丁酰氯",
    "250-28-5": "1,3-双（2，6-二异丙基苯基）氯化咪唑翁",
    "2557-29-5": "4-溴甲基联苯",
    "583-55-1": "邻二溴苯",
    "1318-93-0": "蒙脱石，微晶高岭石",
    "414-82-4": "丙二酸",
    "110-10-7": "对二甲胺基苯甲醛",
    "104-87-0": "4-甲基苄胺",
    "1271-93-8": "1-甲基异喹啉",
    "188-82-9": "二(4-羟基-3,5-二叔丁基)苯甲烷",
    "7883-96-7": "碘化银",
    "51603-79-3": "苯甲酰基甲酸乙酯",
    "25475-67-6": "异喹啉-3-胺",
    "2430-16-3": "苯己醇",  # 需要验证
    "3813-19-2": "氘代硫酸",
    "3269-62-3": "对甲基苯乙胺",
    "4523-22-9": "四羰基二氯化二铑",  # 需要验证
    "33722-66-6": "过氧单磺酸钾",
    "90-10-7": "水杨醇",
    "220-069-2": "三环己基膦",
    "238-811-9": "对氯苯亚磺酸钠",
    "7016874-33-2": "2-四氢糠酸",  # 需要验证
    "2629-57-4": "1，4-苯并二氧六环-6-胺",
    "572-06-9": "2-甲氧基苯基硼酸",  # 需要验证
    "175883-86-0": "4-甲氧基-3-甲基苯硼酸",
    "3822-83-1": "2,6-二叔丁基-4-甲基吡啶",
    "4474-50-4": "喹哌嗪",  # 需要验证
    "545-16-1": "亚硝酸丁酯",
    "886762-73-6": "2-氟-6-碘苯胺",
    "611-69-4": "4,4'-二羟基二苯甲酮",
    "76-36-5": "乙酰氯",  # 这个 CAS 可能是错的，需要验证
}


def search_cas_by_name(name: str, timeout: float = 3.0) -> str | None:
    """
    通过化学物质名称搜索 CAS 号
    优先使用 Chemical Book API
    """
    if not name:
        return None

    # 清理名称
    clean_name = name.replace("（", "(").replace("）", ")").replace("，", ",").strip()

    # 尝试 Chemical Book API
    try:
        url = f"https://www.chemicalbook.com/Search.aspx?keyword={requests.utils.quote(clean_name)}"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        response = requests.get(url, headers=headers, timeout=timeout)
        if response.status_code == 200:
            content = response.text
            # 查找 CAS 号模式
            import re
            # 尝试匹配 CAS 号模式
            cas_pattern = r'CAS\s*[:#]?\s*(\d{2,7}-\d{2}-\d)'
            matches = re.findall(cas_pattern, content, re.IGNORECASE)
            if matches:
                return matches[0]
    except Exception as e:
        print(f"  搜索 {name} 时出错: {e}")

    return None


def search_cas_by_english(name: str, timeout: float = 3.0) -> str | None:
    """
    通过 PubChem 搜索 CAS 号
    """
    try:
        # 尝试使用 CID 搜索
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{requests.utils.quote(name)}/property/CAS/JSON"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        response = requests.get(url, headers=headers, timeout=timeout)
        if response.status_code == 200:
            data = response.json()
            properties = data.get('PropertyTable', {}).get('Properties', [])
            if properties and properties[0].get('CAS'):
                return properties[0]['CAS']
    except Exception as e:
        print(f"  PubChem 搜索 {name} 时出错: {e}")

    return None


def get_correct_cas(cas: str, name: str) -> str | None:
    """
    获取正确的 CAS 号
    """
    print(f"\n查证 CAS: {cas}")
    print(f"  名称: {name}")

    # 方法1: 直接计算校验码（如果前两位数字可能是对的）
    seq_num = cas.split('-')[0] + cas.split('-')[1]
    check = sum((i+1) * int(d) for i, d in enumerate(reversed(seq_num))) % 10
    print(f"  计算校验码: {check}")

    # 方法2: 搜索英文名称
    correct_cas = search_cas_by_english(name)
    if correct_cas:
        print(f"  PubChem 结果: {correct_cas}")
        return correct_cas

    # 方法3: 搜索 Chemical Book
    correct_cas = search_cas_by_name(name)
    if correct_cas:
        print(f"  ChemicalBook 结果: {correct_cas}")
        return correct_cas

    print("  未找到正确的 CAS 号")
    return None


def main():
    """主函数"""

    print("=" * 60)
    print("CAS 号查证工具")
    print("=" * 60)

    # 需要查证的 CAS 号列表
    cases = [
        # ReagentOrders 表
        ("424", "CM-葡聚糖", "339422-83-8"),
        ("839", "5-异丙基-3,8-二甲基环戊并环庚烯-2-磺酸钠", "6223-35-4"),
        ("1353", "(R)-3-(1-(2,6-二氯-3-氟苯基)乙氧基)-5-(1-(哌啶-4-基)-1H-吡唑-4-基)吡啶-2-胺", "877399-52-5"),
        ("1803", "氢氧化钾（粉末）", "1310-58-3"),
        ("4260", "(3S,4S)-8-(6-氨基-5-((2-氨基-3-氯吡啶基-4-基)硫代)吡嗪-2-基)-3-甲基-2-氧杂-8-氮杂螺[4.5]癸-4-胺", "1801765-40-1"),
        ("4771", "京尼平", "636-196-5"),
        ("6152", "3-甲基胞嘧啶", "4476-08-3"),
        ("6351", "2-羟基烟酸", "609-70-2"),
        ("6852", "苯基环丁酮", "52487-31-3"),
        ("6877", "1,2-二氯乙烷", "107-06-5"),

        # Inventory 表
        ("110", "丁酰氯", "414-75-3"),
        ("176", "1,3-双（2，6-二异丙基苯基）氯化咪唑翁", "250-28-5"),
        ("294", "4-溴甲基联苯", "2557-29-5"),
        ("406", "邻二溴苯", "583-55-9"),
        ("504", "蒙脱石，微晶高岭石", "1318-93-4"),
        ("604", "丙二酸", "414-82-2"),
        ("689", "对二甲胺基苯甲醛", "110-10-7"),
        ("863", "4-甲基苄胺", "104-87-4"),
        ("1085", "1-甲基异喹啉", "1271-93-3"),
        ("1119", "二(4-羟基-3,5-二叔丁基)苯甲烷", "188-82-1"),
        ("1340", "碘化银", "7883-96-2"),
        ("1471", "苯甲酰基甲酸乙酯", "51603-79-8"),
        ("2855", "异喹啉-3-胺", "25475-67-5"),
        ("2959", "苯己醇", "2430-16-3"),
        ("3107", "氘代硫酸", "3813-19-9"),
        ("3287", "对甲基苯乙胺", "3269-62-9"),
        ("3461", "四羰基二氯化二铑", "4523-22-9"),
        ("3769", "过氧单磺酸钾", "33722-66-5"),
        ("3928", "水杨醇", "90-10-7"),
        ("4096", "三环己基膦", "220-069-2"),
        ("4311", "对氯苯亚磺酸钠", "238-811-9"),
        ("4711", "2-四氢糠酸", "7016874-33-2"),
        ("4956", "1，4-苯并二氧六环-6-胺", "2629-57-2"),
        ("5100", "2-甲氧基苯基硼酸", "572-06-9"),
        ("6872", "4-甲氧基-3-甲基苯硼酸", "175883-86-2"),
        ("7117", "2,6-二叔丁基-4-甲基吡啶", "3822-83-2"),
        ("7347", "喹哌嗪", "4474-50-7"),
        ("7723", "亚硝酸丁酯", "545-16-1"),
        ("8227", "2-氟-6-碘苯胺", "886762-73-6"),
        ("8276", "4,4'-二羟基二苯甲酮", "611-69-4"),
        ("8860", "乙酰氯", "76-36-5"),
    ]

    results = []

    for db_id, name, wrong_cas in cases:
        correct_cas = get_correct_cas(wrong_cas, name)
        results.append({
            'db_id': db_id,
            'name': name,
            'wrong_cas': wrong_cas,
            'correct_cas': correct_cas
        })
        time.sleep(0.5)  # 避免请求过快

    # 输出结果
    print("\n" + "=" * 60)
    print("查证结果汇总")
    print("=" * 60)

    for r in results:
        status = "✓" if r['correct_cas'] else "✗"
        print(f"{status} ID={r['db_id']}: {r['name']}")
        print(f"   错误 CAS: {r['wrong_cas']}")
        print(f"   正确 CAS: {r['correct_cas'] or '未查到'}")
        print()

    # 生成 SQL 更新语句
    print("\n" + "=" * 60)
    print("SQL 更新语句")
    print("=" * 60)

    # ReagentOrders 表更新
    reagent_updates = [(r['wrong_cas'], r['correct_cas']) for r in results[:10] if r['correct_cas']]
    if reagent_updates:
        print("\n-- ReagentOrders 表:")
        for wrong, correct in reagent_updates:
            print(f"UPDATE reagent_orders SET cas = '{correct}' WHERE cas = '{wrong}';")

    # Inventory 表更新
    inventory_updates = [(r['wrong_cas'], r['correct_cas']) for r in results[10:] if r['correct_cas']]
    if inventory_updates:
        print("\n-- Inventory 表:")
        for wrong, correct in inventory_updates:
            print(f"UPDATE inventory SET cas = '{correct}' WHERE cas = '{wrong}';")


if __name__ == "__main__":
    main()
