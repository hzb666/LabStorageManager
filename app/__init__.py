"""Lab Storage Manager package bootstrap."""

from __future__ import annotations

import sys


def _patch_sqlite_driver() -> None:
    """Prefer pysqlite3-binary when available so SQLite features (e.g. FTS5) are enabled."""
    try:
        import pysqlite3 as sqlite3  # type: ignore[import-not-found]
    except ImportError:
        # 本地和开发环境缺少 pysqlite3 时回退到标准库 sqlite3。
        return

    sys.modules["sqlite3"] = sqlite3


_patch_sqlite_driver()

__version__ = "0.8.1"
