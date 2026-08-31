"""
CAS 号修正脚本 - XLSX 版本
将 xlsx 文件中错误的 CAS 号替换为正确的
"""
import argparse
import sys

import pandas as pd

# CAS 号修正映射表（与 fix_cas_numbers.py 保持一致）
CAS_CORRECTIONS = {
    # ReagentOrders 表错误
    "339422-83-8": "39422-83-8",  # CM-葡聚糖
    "1310-58-4": "1310-58-3",  # 氢氧化钾
    "636-196-5": "6902-77-8",  # 京尼平
    "4476-08-3": "4776-08-3",  # 3-甲基胞嘧啶
    "609-70-2": "609-71-2",  # 2-羟基烟酸
    "107-06-5": "107-06-2",  # 1,2-二氯乙烷
    "52487-31-3": "42436-86-2",  # 苯基环丁酮
    "6223-35-5": "6223-35-4",  # 薁磺酸钠
    "1801765-40-1": "1801765-04-7",  # TNO155
    "1801765-40-7": "1801765-04-7",  # TNO155 (变体)
    "877399-52-8": "877399-52-5",  # (R)-吡啶胺化合物

    # Inventory 表错误
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
    "1318-93-4": "1318-93-0",  # 蒙脱石
    "175883-86-2": "175883-62-2",  # 4-甲氧基-3-甲基苯硼酸
    "188-82-1": "118-82-1",  # 二(4-羟基-3,5-二叔丁基)苯甲烷
    "2430-16-3": "2430-16-2",  # 苯己醇
    "2557-29-5": "2567-29-5",  # 4-溴甲基联苯
    "250-28-5": "250285-32-6",  # 氯化咪唑翁
    "583-55-9": "583-53-9",  # 邻二溴苯
    "4474-50-7": "4774-24-7",  # 喹哌嗪
    "886762-73-6": "886762-73-8",  # 2-氟-6-碘苯胺
    "7016874-33-2": "16874-33-2",  # 2-四氢糠酸
    "2629-57-2": "22013-33-8",  # 1,4-苯并二氧六环-6-胺
    "3269-62-9": "3261-62-9",  # 对甲基苯乙胺
    "33722-66-5": "37222-66-5",  # 过氧单磺酸钾
    "3813-19-9": "13813-19-9",  # 氘代硫酸
    "3822-83-2": "38222-83-2",  # 2,6-二叔丁基-4-甲基吡啶
    "4523-22-9": "14523-22-9",  # 四羰基二氯化二铑
}


def fix_cas_in_dataframe(df: pd.DataFrame) -> tuple:
    """修正 DataFrame 中的 CAS 号，返回修正数量和详情"""
    corrections_made = []
    total_corrections = 0

    # 查找可能包含 CAS 号的列
    cas_columns = []
    for col in df.columns:
        col_lower = str(col).lower()
        if 'cas' in col_lower:
            cas_columns.append(col)

    if not cas_columns:
        print("警告：未找到包含 CAS 号的列")
        return 0, []

    print(f"找到 CAS 列: {cas_columns}")

    for col in cas_columns:
        corrections_in_col = 0
        for idx, value in df[col].items():
            # 处理 NaN 和空值
            if pd.isna(value) or value is None:
                continue

            cas_str = str(value).strip()

            if cas_str in CAS_CORRECTIONS:
                correct_cas = CAS_CORRECTIONS[cas_str]
                df.at[idx, col] = correct_cas
                corrections_made.append({
                    'row': idx + 2,  # Excel 行号（1-indexed + 表头）
                    'column': col,
                    'wrong_cas': cas_str,
                    'correct_cas': correct_cas
                })
                corrections_in_col += 1
                total_corrections += 1

        if corrections_in_col > 0:
            print(f"  列 '{col}' 修正了 {corrections_in_col} 个 CAS 号")

    return total_corrections, corrections_made


def main():
    parser = argparse.ArgumentParser(description='修正 xlsx 文件中的错误 CAS 号')
    parser.add_argument('input_file', help='输入 xlsx 文件路径')
    parser.add_argument('-o', '--output', help='输出文件路径（默认覆盖原文件）')
    parser.add_argument('--dry-run', action='store_true', help='仅显示将要修正的内容，不实际修改')
    args = parser.parse_args()

    input_file = args.input_file
    output_file = args.output if args.output else input_file

    print("=" * 70)
    print("CAS 号修正脚本 (XLSX)")
    print("=" * 70)

    # 读取 xlsx
    print(f"\n读取文件: {input_file}")
    try:
        df = pd.read_excel(input_file, dtype=str)
    except Exception as e:
        print(f"读取文件失败: {e}")
        sys.exit(1)

    print(f"总行数: {len(df)}")
    print(f"列名: {df.columns.tolist()}")

    # 修正 CAS 号
    total_corrections, corrections_made = fix_cas_in_dataframe(df)

    print(f"\n共修正了 {total_corrections} 个 CAS 号")

    if corrections_made:
        print("\n修正详情:")
        print("-" * 70)
        for c in corrections_made:
            print(f"  行 {c['row']}, 列 '{c['column']}': {c['wrong_cas']} -> {c['correct_cas']}")
        print("-" * 70)

    # 保存或预览
    if args.dry_run:
        print("\n[Dry Run] 未实际修改文件")
    else:
        try:
            # 保存为 xlsx
            df.to_excel(output_file, index=False)
            print(f"\n已保存到: {output_file}")
        except Exception as e:
            print(f"保存文件失败: {e}")
            sys.exit(1)

    print("\n" + "=" * 70)
    print("完成!")
    print("=" * 70)


if __name__ == "__main__":
    main()
