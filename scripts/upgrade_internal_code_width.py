"""
Upgrade script: Convert internal codes from width 2 to width 3 (01 -> 001, 02 -> 002, etc.)

Usage:
    python scripts/upgrade_internal_code_width.py --dry-run    # Preview changes
    python scripts/upgrade_internal_code_width.py --apply      # Apply changes
"""
import re
import argparse
from app.database import engine
from sqlmodel import Session, select
from app.models.inventory import Inventory
from sqlalchemy import update as sql_update


def upgrade_internal_code(old_code: str) -> str | None:
    """
    Convert internal code from width 2 to width 3 format.
    
    Examples:
        "64175-250113-01" -> "64175-250113-001"
        "64175-250113-99" -> "64175-250113-099"
        "64175-250113-001" -> "64175-250113-001" (already width 3)
        "64175-250113" -> None (invalid format)
    
    Args:
        old_code: Internal code in old format
    
    Returns:
        Upgraded code, or None if code format is invalid
    """
    # 匹配 CAS-日期-序号 格式。
    match = re.match(r"^(.+)-(\d{6})-(\d+)$", old_code)
    if not match:
        return None
    
    cas_code, date_str, seq_str = match.groups()
    
    # 序号转整数后再格式化，消除前导零干扰。
    try:
        seq_num = int(seq_str)
    except ValueError:
        return None
    
    # 已达到 3 位或更宽时直接返回。
    if len(seq_str) >= 3:
        return old_code
    
    # 序号补齐到 3 位。
    new_seq_str = str(seq_num).zfill(3)
    new_code = f"{cas_code}-{date_str}-{new_seq_str}"
    
    return new_code


def main():
    parser = argparse.ArgumentParser(description="Upgrade internal code width from 2 to 3")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes to database (default is dry-run)"
    )
    args = parser.parse_args()
    
    with Session(engine) as session:
        # 只读取内部编码和 ID，避开枚举反序列化问题。
        items_data = session.exec(
            select(Inventory.id, Inventory.internal_code)
        ).all()
        
        if not items_data:
            print("✓ No inventory items found")
            return
        
        # 分析当前编码。
        updates_needed = []
        already_upgraded = []
        invalid_codes = []
        
        for item_id, code in items_data:
            new_code = upgrade_internal_code(code)
            
            if new_code is None:
                invalid_codes.append((item_id, code))
            elif new_code == code:
                already_upgraded.append(code)
            else:
                updates_needed.append((item_id, code, new_code))
        
        # 打印汇总。
        print(f"📊 Internal Code Upgrade Summary:")
        print(f"   Total items: {len(items_data)}")
        print(f"   Need upgrade: {len(updates_needed)}")
        print(f"   Already width 3+: {len(already_upgraded)}")
        print(f"   Invalid format: {len(invalid_codes)}")
        
        if invalid_codes:
            print(f"\n⚠️  Invalid codes found:")
            for item_id, code in invalid_codes[:5]:
                print(f"   ID={item_id}: {code}")
            if len(invalid_codes) > 5:
                print(f"   ... and {len(invalid_codes) - 5} more")
        
        if not updates_needed:
            print("\n✓ No upgrades needed - all codes are already width 3 or higher")
            return
        
        # 展示升级示例。
        if updates_needed:
            print(f"\n📝 Sample upgrades (first 5):")
            for item_id, old_code, new_code in updates_needed[:5]:
                print(f"   {old_code} → {new_code}")
            if len(updates_needed) > 5:
                print(f"   ... and {len(updates_needed) - 5} more")
        
        # 执行更新或预览。
        if args.apply:
            print(f"\n🔄 Applying {len(updates_needed)} upgrades...")
            for item_id, old_code, new_code in updates_needed:
                # 使用原生 SQL update，避开枚举字段处理。
                stmt = sql_update(Inventory).where(Inventory.id == item_id).values(internal_code=new_code)
                session.exec(stmt)
            
            session.commit()
            print(f"✓ Successfully upgraded {len(updates_needed)} internal codes")
            print(f"✓ Database committed")
        else:
            print(f"\n💡 Dry-run mode. Use --apply to commit changes")


if __name__ == "__main__":
    main()
