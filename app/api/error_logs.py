"""
Error Logs API - 错误日志获取接口

提供API让前端获取后端错误日志（仅管理员可访问）
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import get_current_session
from app.models.user import User
from app.models.user_session import UserSession
from app.services.error_logger import get_error_logs_since, get_recent_error_logs

router = APIRouter()


def get_current_user(
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)]
) -> User:
    """获取当前登录用户"""
    user, _ = current
    return user


class ErrorLogsResponse(BaseModel):
    """错误日志响应"""
    logs: list[str]
    count: int


@router.get("/error-logs")
def get_error_logs(
    current_user: Annotated[User, Depends(get_current_user)],
    hours: Annotated[int, Query(ge=1, le=168)] = 24,  # 最多7天
    lines: Annotated[int, Query(ge=1, le=1000)] = 100,  # 最多1000行
) -> ErrorLogsResponse:
    """
    获取后端错误日志
    
    - **hours**: 获取最近多少小时内的日志（默认24小时，最大168小时=7天）
    - **lines**: 最多返回多少行日志（默认100行，最大1000行）
    
    需要管理员权限
    """
    # 检查管理员权限
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin permission required"
        )
    
    # 获取日志
    logs = get_error_logs_since(hours=hours) if hours else get_recent_error_logs(lines=lines)
    
    return ErrorLogsResponse(
        logs=logs,
        count=len(logs)
    )
