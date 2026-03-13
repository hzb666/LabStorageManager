# Base Models - Global base classes for all models
from datetime import datetime
from pydantic import ConfigDict
from sqlmodel import SQLModel


class BaseResponse(SQLModel):
    """全局 Response 基类 - 所有 API 响应都继承此类，自动处理 datetime 为 UTC + Z"""
    model_config = ConfigDict(from_attributes=True, json_encoders={datetime: lambda v: v.isoformat() + 'Z'})
