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

## Phase 1.2 Lessons Learned

### 4. FastAPI Route Order - /me vs /{user_id}
**Problem**: FastAPI matched `/{user_id}` before `/me` endpoint, causing "me" to be parsed as user_id integer.

**Error**: `Input should be a valid integer, unable to parse string as an integer`

**Solution**: 
1. Ensure `/me` endpoint is defined BEFORE `/{user_id}` in the router
2. Remove duplicate `/me` endpoints
3. Restart server completely (not just reload) when route order changes

### 5. JWT Token Expiration
**Problem**: Old JWT tokens from previous server runs become invalid.

**Solution**: Get fresh token after server restart.

---

**Date**: 2026-02-13
**Phase**: 1.2 User Auth (JWT)
