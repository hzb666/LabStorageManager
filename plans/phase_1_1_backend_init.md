# Phase 1.1: 后端初始化 - 实施计划

## 目标
初始化 FastAPI + SQLModel + SQLite 项目，启用 WAL 模式，为后续功能开发奠定基础。

## 项目目录结构

```
LabStorageManager/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI 应用入口
│   ├── database.py             # SQLModel 引擎配置 (WAL 模式)
│   ├── core/
│   │   ├── __init__.py
│   │   └── config.py           # Settings 配置类
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py             # User 模型
│   │   ├── order.py            # Order 模型
│   │   └── inventory.py        # Inventory 模型
│   ├── api/
│   │   ├── __init__.py
│   │   ├── users.py            # 用户路由
│   │   ├── orders.py           # 订购路由
│   │   └── inventory.py        # 库存路由
│   └── services/
│       ├── __init__.py
│       ├── cas_utils.py        # CAS 号标准化工具
│       └── image_service.py    # 图片压缩服务
├── static/                      # 静态文件存储
├── uploads/                     # 上传文件临时存储
├── pyproject.toml
├── requirements.txt
└── .env                         # 环境变量
```

## 关键配置点

### 1. SQLite WAL 模式 (Critical Rule #1)

```python
# database.py
from sqlmodel import SQLModel, create_engine

sqlite_url = "sqlite:///./lab_inventory.db?mode=wal"
engine = create_engine(sqlite_url, echo=True)

def init_db():
    SQLModel.metadata.create_all(engine)
```

### 2. CAS 标准化 (Critical Rule #2)

```python
# services/cas_utils.py
def normalize_cas(cas: str) -> str:
    """清洗 CAS 号：去除空格，转大写"""
    return cas.replace(" ", "").upper()
```

### 3. 图片压缩 (Critical Rule #3)

```python
# services/image_service.py
from PIL import Image
import io

def compress_image(file: UploadFile) -> str:
    """压缩图片至 <100KB，返回文件路径"""
    image = Image.open(file)
    image.thumbnail((800, 800))
    # 压缩逻辑...
```

## 待创建文件清单

| 文件 | 描述 |
|------|------|
| `pyproject.toml` | Poetry 依赖配置 |
| `requirements.txt` | pip 依赖 (备选) |
| `app/__init__.py` | 包初始化 |
| `app/main.py` | FastAPI 应用 |
| `app/database.py` | 数据库引擎 + WAL |
| `app/core/__init__.py` | Core 包 |
| `app/core/config.py` | Settings |
| `app/models/__init__.py` | Models 包 |
| `app/models/user.py` | User 模型 |
| `app/models/order.py` | Order 模型 |
| `app/models/inventory.py` | Inventory 模型 |
| `app/api/__init__.py` | API 包 |
| `app/api/users.py` | 用户路由 |
| `app/api/orders.py` | 订购路由 |
| `app/api/inventory.py` | 库存路由 |
| `app/services/__init__.py` | Services 包 |
| `app/services/cas_utils.py` | CAS 工具 |
| `app/services/image_service.py` | 图片服务 |
| `static/` | 静态文件目录 |
| `uploads/` | 上传目录 |

## 依赖版本

- fastapi >= 0.109.0
- sqlmodel >= 0.0.14
- uvicorn >= 0.27.0
- python-multipart >= 0.0.6
- pillow >= 10.0.0
- python-jose[cryptography] >= 3.3.0
- passlib[bcrypt] >= 1.7.4
- python-dotenv >= 1.0.0

## 下一步

1. 确认计划后切换到 Code 模式实现
2. 实现后运行测试验证 WAL 模式
3. 更新 `Progress.txt` 和 `Lessons.md`

---

**计划版本**: 1.0  
**创建时间**: 2026-02-12
