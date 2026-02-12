# Lessons.md

## Phase 1.1 Lessons Learned

### 1. SQLModel Relationship foreign_keys Issue
**Problem**: SQLModel doesn't support `foreign_keys` parameter in `Relationship()` the same way SQLAlchemy does.

**Error**: `TypeError: Relationship() got an unexpected keyword argument 'foreign_keys'`

**Solution**: Simplified models by removing complex multi-FK relationships. Kept `borrower_id` and `last_borrower_id` as simple integer fields.

### 2. SQLModel Session execute() vs exec()
**Problem**: SQLModel Session uses `execute()` not `exec()`.

**Error**: `AttributeError: 'Session' object has no attribute 'exec'`

**Solution**: Use SQLAlchemy-style syntax:
- `db.execute(statement).scalar_one_or_none()` for single result
- `db.execute(statement).scalars().all()` for list results

### 3. Server Cache Issues
**Problem**: Old Python bytecode (.pyc) causing errors to persist after code fixes.

**Solution**: Delete `__pycache__` directories and restart uvicorn server.

---

**Date**: 2026-02-12
**Phase**: 1.1 Backend Initialization
