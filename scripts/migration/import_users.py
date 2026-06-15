"""
批量导入用户脚本
根据 user_mapping.csv 创建用户，密码为用户名
自动生成拼音字段 (full_name_pinyin) 用于排序
"""
import csv
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from sqlmodel import Session, select

from app.core.auth import get_password_hash
from app.database import engine
from app.models.user import User, UserRole
from app.services.pinyin_utils import compute_pinyin_fields


def import_users_from_csv(csv_path: str):
    """从 CSV 文件批量导入用户"""
    
    users_created = 0
    users_skipped = 0
    errors = []
    
    with Session(engine) as session:
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            # 跳过 BOM
            reader = csv.DictReader(f)
            records = list(reader)

        # 倒序导入，使最后一条记录ID为1
        records.reverse()
        print(f"已反转记录顺序，ID 将倒序分配，共 {len(records)} 条记录")

        for row in records:
                original_name = row.get('original_name', '').strip()
                username = row.get('username', '').strip()
                is_active_str = row.get('is_active', '').strip()

                if not username:
                    errors.append(f"跳过: 用户名为空 (原始名: {original_name})")
                    continue

                # 检查用户是否已存在
                statement = select(User).where(User.username == username)
                existing_user = session.exec(statement).first()

                if existing_user:
                    print(f"跳过: 用户 {username} 已存在")
                    users_skipped += 1
                    continue

                # 处理 is_active 字段 (1=激活, 0=未激活)
                is_active_val = True  # 默认激活
                if is_active_str in ['0', '0.0']:
                    is_active_val = False

                # 密码为用户名
                password = username

                # 生成拼音字段
                pinyin_fields = compute_pinyin_fields(full_name=original_name)

                # 创建用户
                user = User(
                    username=username,
                    password_hash=get_password_hash(password),
                    full_name=original_name,
                    full_name_pinyin=pinyin_fields.get("full_name_pinyin"),
                    full_name_pinyin_initials=pinyin_fields.get("full_name_pinyin_initials"),
                    role=UserRole.USER,  # 默认普通用户
                    is_active=is_active_val
                )
                
                session.add(user)
                session.commit()
                session.refresh(user)
                
                print(f"创建用户: {username} (全名: {original_name})")
                users_created += 1
    
    print("\n=== 导入完成 ===")
    print(f"成功创建: {users_created} 个用户")
    print(f"跳过(已存在): {users_skipped} 个用户")

    if errors:
        print("\n错误:")
        for error in errors:
            print(f"  - {error}")


if __name__ == "__main__":
    csv_path = PROJECT_ROOT / "scripts" / "local" / "migration" / "user_mapping.csv"
    print(f"从 {csv_path} 导入用户...")
    import_users_from_csv(csv_path)
