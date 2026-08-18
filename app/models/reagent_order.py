"""试剂订单模型。"""
from datetime import datetime

from app.core.constants import MAX_ORDER_QUANTITY
from app.core.time_utils import get_utc_now
from app.models.base import BaseResponse
from enum import Enum
from typing import Optional

from pydantic import ConfigDict, field_validator
from sqlalchemy import Column, Enum as SAEnum, Index, asc, desc
from sqlmodel import Field, SQLModel


class ReagentOrderStatus(str, Enum):
    """Reagent order status enumeration"""
    PENDING = "pending"       # 已申购
    APPROVED = "approved"     # 已批准（采购完成）
    ARRIVED = "arrived"       # 已到货但未入库
    STOCKED = "stocked"       # 已入库
    REJECTED = "rejected"    # 未通过


class ReagentOrderReason(str, Enum):
    """Order reason enumeration"""
    RUNNING_OUT = "running_out"      # 库存用完
    NOT_STOCKED = "not_stocked"    # 库里没有
    COMMON_PUBLIC = "common_public"  # 公用常用
    NOT_FOUND = "not_found"          # 没找到
    REORDER = "reorder"              # 追加订购
    HIGH_USAGE = "high_usage"        # 大量使用
    DEGRADED = "degraded"            # 变质
    NOT_ENOUGH = "not_enough"        # 不够用
    OTHERS = "others"                # 其他


class ReagentOrderBase(SQLModel):
    """Base reagent order model with common fields"""
    # CAS 号，试剂的关键字段
    cas_number: str = Field(max_length=50)
    # 中文名称，带查询索引和拼音排序字段
    name: str = Field(max_length=200)
    # 英文名称
    english_name: Optional[str] = Field(None, max_length=200)
    # 别名，如 "酒精, Ethanol"
    alias: Optional[str] = Field(None, max_length=200)
    # 分类：到货/入库阶段补充后复制到库存
    category: Optional[str] = Field(max_length=100)
    # 品牌，带查询索引和拼音排序字段
    brand: Optional[str] = Field(max_length=100)
    # 纯度或等级，如 95%、AR、HPLC
    purity: Optional[str] = Field(None, max_length=20)
    # 数据库模型：允许 NULL 以兼容旧数据
    initial_quantity: Optional[float] = Field(default=None)
    # 单位，如 "ml"、"g"、"L"
    unit: Optional[str] = Field(None, max_length=20)
    # 订购数量（瓶数）
    quantity: int = Field(gt=0)
    # 单价
    price: float = Field(ge=0)
    # 订购原因；数据库允许为空，但前端创建时必须传入
    order_reason: Optional[ReagentOrderReason] = Field(
        default=None,
        sa_column=Column(
            SAEnum(
                ReagentOrderReason,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=True,
        ),
    )
    # 危险品标记
    is_hazardous: bool = False
    # 备注
    notes: Optional[str] = Field(None, max_length=500)


class ReagentOrder(ReagentOrderBase, table=True):
    """Reagent Order database model"""
    __tablename__ = "reagent_order"
    __table_args__ = (
        Index("ix_reagent_order_cas_number_created_at_id", asc("cas_number"), desc("created_at"), desc("id")),
        Index(
            "ix_reagent_order_cas_number_desc_created_at_id",
            desc("cas_number"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_reagent_order_name_created_at_id", asc("name"), desc("created_at"), desc("id")),
        Index("ix_reagent_order_brand_created_at_id", asc("brand"), desc("created_at"), desc("id")),
        Index("ix_reagent_order_name_pinyin_created_at_id", asc("name_pinyin"), desc("created_at"), desc("id")),
        Index(
            "ix_reagent_order_name_pinyin_desc_created_at_id",
            desc("name_pinyin"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_reagent_order_name_pinyin_initials_created_at_id", asc("name_pinyin_initials"), desc("created_at"), desc("id")),
        Index("ix_reagent_order_brand_pinyin_created_at_id", asc("brand_pinyin"), desc("created_at"), desc("id")),
        Index(
            "ix_reagent_order_brand_pinyin_desc_created_at_id",
            desc("brand_pinyin"),
            desc("created_at"),
            desc("id"),
        ),
        Index("ix_reagent_order_brand_pinyin_initials_created_at_id", asc("brand_pinyin_initials"), desc("created_at"), desc("id")),
        Index("ix_reagent_order_created_at_id", desc("created_at"), desc("id")),
        Index("ix_reagent_order_created_at_asc_id_desc", asc("created_at"), desc("id")),
        Index("ix_reagent_order_status_created_at_id", asc("status"), desc("created_at"), desc("id")),
        Index("ix_reagent_order_applicant_created_at_id", asc("applicant_id"), desc("created_at"), desc("id")),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    applicant_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    status: ReagentOrderStatus = Field(
        default=ReagentOrderStatus.PENDING,
        sa_column=Column(
            SAEnum(
                ReagentOrderStatus,
                native_enum=False,
                create_constraint=False,
                values_callable=lambda enum_cls: [item.value for item in enum_cls],
                validate_strings=True,
            ),
            nullable=False,
            default=ReagentOrderStatus.PENDING.value,
        ),
    )
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now}
    )

    # 名称和品牌拼音字段（预计算，使用数据库索引加速搜索/排序）
    name_pinyin: Optional[str] = Field(default=None, max_length=200)
    name_pinyin_initials: Optional[str] = Field(default=None, max_length=200)
    brand_pinyin: Optional[str] = Field(default=None, max_length=200)
    brand_pinyin_initials: Optional[str] = Field(default=None, max_length=200)


class ReagentOrderCreate(SQLModel):
    """DTO for creating a new reagent order

    前端传入 specification (规格字符串)，后端解析为 initial_quantity + unit
    """
    model_config = ConfigDict(extra="forbid")

    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = Field(default=None, max_length=200)
    alias: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, max_length=100)
    brand: str = Field(max_length=100)
    purity: Optional[str] = Field(default=None, max_length=20)
    specification: str = Field(max_length=100)  # 前端传入规格字符串，如 "500mL"
    quantity: int = Field(gt=0, le=MAX_ORDER_QUANTITY)  # 数量限制：1-99
    price: float = Field(gt=0)  # 价格必填，必须大于0
    order_reason: ReagentOrderReason  # 必填，前端只能选择枚举值
    is_hazardous: bool = False
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("cas_number", "name", "brand", "specification")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field must not be empty")
        return stripped


class ReagentOrderUpdate(SQLModel):
    """DTO for updating reagent order information"""
    model_config = ConfigDict(extra="forbid")

    cas_number: Optional[str] = Field(default=None, max_length=50)
    name: Optional[str] = Field(default=None, max_length=200)
    english_name: Optional[str] = Field(default=None, max_length=200)
    alias: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, max_length=100)
    brand: Optional[str] = Field(default=None, max_length=100)
    purity: Optional[str] = Field(default=None, max_length=20)
    specification: Optional[str] = Field(default=None, max_length=100)
    initial_quantity: Optional[float] = Field(default=None, gt=0)
    unit: Optional[str] = Field(default=None, max_length=20)
    quantity: Optional[int] = Field(default=None, gt=0, le=MAX_ORDER_QUANTITY)
    price: Optional[float] = Field(default=None, gt=0)
    order_reason: Optional[ReagentOrderReason] = None
    is_hazardous: Optional[bool] = None
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("cas_number", "name", "specification", mode="before")
    @classmethod
    def strip_supplied_required_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            raise ValueError("Field must not be empty")
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field must not be empty")
        return stripped

    @field_validator("quantity", "price", mode="before")
    @classmethod
    def reject_null_required_number(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            raise ValueError("Field must not be empty")
        return value


class ReagentOrderResponse(BaseResponse):
    """DTO for reagent order API responses"""
    id: int
    cas_number: str
    name: str
    english_name: Optional[str]
    alias: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    purity: Optional[str]
    initial_quantity: Optional[float]
    unit: Optional[str]
    quantity: int
    price: Optional[float]
    order_reason: Optional[ReagentOrderReason]
    is_hazardous: bool
    notes: Optional[str]
    applicant_id: Optional[int]
    status: ReagentOrderStatus
    created_at: datetime
    updated_at: datetime
    approved_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    arrived_at: Optional[datetime] = None
    stocked_at: Optional[datetime] = None
