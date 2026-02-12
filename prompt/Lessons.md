# Lessons.md

## Phase 1.1 Lessons Learned

### 1. SQLModel Relationship foreign_keys Issue
**Problem**: SQLModel doesn't support `foreign_keys` parameter in `Relationship()` the same way SQLAlchemy does.

**Error**: `TypeError: Relationship() got an unexpected keyword argument 'foreign_keys'`

**Solution**: 
- Simplified models by removing complex multi-FK relationships
- Kept `borrower_id` and `last_borrower_id` as simple integer fields
- For Phase 1.1, we don't need bidirectional relationships
- Can add back with proper SQLModel syntax later if needed

**When to apply**: When using SQLModel with multiple FKs to the same table, use simple integer fields first. If relationship is needed, use SQLModel's simpler relationship syntax.

### 2. Unicode Encoding in Windows
**Problem**: Python scripts on Windows with GBK encoding may fail when printing Unicode characters like checkmarks.

**Solution**: Use ASCII characters in debug output or handle encoding explicitly.

### 3. Dependencies Installation
**Problem**: Missing `pydantic-settings` module when running application.

**Solution**: Install all dependencies from requirements.txt or pyproject.toml before running.

---

**Date**: 2026-02-12
**Phase**: 1.1 Backend Initialization
