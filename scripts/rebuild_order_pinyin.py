"""Compatibility wrapper for rebuilding order pinyin fields.

Preferred entrypoint:
    python scripts/migration/rebuild_pinyin.py reagent_order
    python scripts/migration/rebuild_pinyin.py consumable_order
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.migration.rebuild_pinyin import rebuild_pinyin


def main() -> None:
    """Rebuild pinyin for both order tables."""
    rebuild_pinyin("reagent_order")
    rebuild_pinyin("consumable_order")


if __name__ == "__main__":
    main()
