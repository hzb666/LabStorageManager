# 全局模型基类。
from datetime import datetime

from pydantic import ConfigDict
from sqlmodel import SQLModel

from app.core.time_utils import utc_iso_str


class BaseResponse(SQLModel):
    """全局 Response 基类 - 所有 API 响应都继承此类，自动处理 datetime 为 UTC + Z"""
    model_config = ConfigDict(from_attributes=True, json_encoders={datetime: utc_iso_str})
