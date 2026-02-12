# TECH_STACK.md

## Frontend (Web Only)
* **Framework**: React 18 + Vite + TypeScript.
* **UI Library**: **Shadcn/UI** (基于 Tailwind，轻量美观).
* **Table Engine**: **TanStack Table v8** (必须使用，支持虚拟滚动以应对万级数据).
* **State**: Zustand (Session管理).
* **Forms**: React Hook Form + Zod (校验 CAS 格式).
* **Excel**: `xlsx` (SheetJS) 用于前端解析导入文件.

## Backend (API)
* **Framework**: **Python FastAPI**.
* **Database**: **SQLite** (必须开启 **WAL 模式** 以支持并发).
* **ORM**: **SQLModel** (结合 Pydantic 与 SQLAlchemy 的最佳实践).
* **Image Processing**: **Pillow (PIL)** (后端压缩图片).
* **Excel Processing**: **Pandas** + **Openpyxl** (后端导出数据).

## Infrastructure
* **Storage**: 本地文件系统 `/static/images` (严禁存数据库 Blob).
* **Deployment**: Docker Compose (App + Nginx).