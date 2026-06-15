from sqlalchemy import inspect
from app.database import engine
from sqlmodel import SQLModel
import json

ins = inspect(engine)
report = {}
for table_name, table in SQLModel.metadata.tables.items():
    if not ins.has_table(table_name):
        report[table_name] = {"missing_table": True}
        continue
    expected = {idx.name: [c.name for c in idx.columns] for idx in table.indexes if idx.name}
    actual = {
        idx["name"]: (idx.get("column_names") or [])
        for idx in ins.get_indexes(table_name)
        if idx.get("name")
    }
    missing = sorted(set(expected) - set(actual))
    extra = sorted(
        [n for n in (set(actual) - set(expected)) if not n.startswith("sqlite_autoindex_")]
    )
    mismatch = []
    for n in sorted(set(expected) & set(actual)):
        if expected[n] != actual[n]:
            mismatch.append({"index": n, "expected": expected[n], "actual": actual[n]})
    report[table_name] = {
        "missing_indexes": missing,
        "extra_indexes": extra,
        "mismatch_indexes": mismatch,
        "expected_count": len(expected),
        "actual_count": len(actual),
    }
summary = {
    "tables": len(report),
    "tables_with_issues": sum(
        1
        for v in report.values()
        if (
            v.get("missing_table")
            or v.get("missing_indexes")
            or v.get("extra_indexes")
            or v.get("mismatch_indexes")
        )
    ),
}
print("SUMMARY=")
print(json.dumps(summary, ensure_ascii=False, indent=2))
print("DETAIL=")
print(json.dumps(report, ensure_ascii=False, indent=2))
