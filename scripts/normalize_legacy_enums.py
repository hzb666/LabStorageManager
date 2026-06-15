"""Manually normalize legacy enum values stored in the SQLite database."""

from scripts.normalize_legacy_enum_storage import normalize_legacy_enum_storage


def main() -> None:
    updated_rows = normalize_legacy_enum_storage()
    print(f"Normalized {updated_rows} legacy enum value(s).")


if __name__ == "__main__":
    main()
