"""
Cart Sync API - 购物车同步
支持耗材订单和试剂订单的自动匹配
"""
from enum import Enum
from typing import Optional, Annotated

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.database import get_db
from app.core.auth import get_current_user
from app.models.reagent_order import ReagentOrder
from app.services.cas_utils import normalize_cas

router = APIRouter(prefix="/cart-sync", tags=["CartSync"])


# ==================== 枚举 ====================
class OrderType(str, Enum):
    """订单类型"""
    CONSUMABLE = "consumable"  # 耗材订单
    REAGENT = "reagent"  # 试剂订单


class MatchType(str, Enum):
    """匹配类型"""
    EXACT = "exact"  # 精确匹配
    NONE = "none"  # 无匹配


# ==================== 请求与响应模型 ====================
class CartItem(BaseModel):
    """购物车商品"""
    name: str
    specification: str = ""
    quantity: int = 1
    price: Optional[float] = None
    brand: str = ""
    cas_number: str = ""
    english_name: str = ""
    alias: str = ""
    unit: str = ""
    product_number: str = ""
    is_hazardous: bool = False
    product_id: Optional[str] = None  # 学校系统产品ID
    detail_url: Optional[str] = None  # 详情页URL


class CartItemRequest(BaseModel):
    """同步请求"""
    items: list[CartItem]
    order_type: OrderType = OrderType.CONSUMABLE


class MatchedItem(BaseModel):
    """匹配结果项"""
    cart_item: CartItem
    matched_id: Optional[int] = None
    match_type: MatchType = MatchType.NONE
    similarity: float = 0.0


class CartSyncResponse(BaseModel):
    """同步响应"""
    total: int
    matched: int
    unmatched: int
    items: list[MatchedItem]


def match_consumable_order(_db: Session, item: CartItem) -> MatchedItem:
    """耗材订单不需要匹配，直接创建新订单"""
    return MatchedItem(cart_item=item, matched_id=None, match_type=MatchType.NONE, similarity=0.0)


def match_reagent_order(db: Session, item: CartItem) -> MatchedItem:
    """匹配试剂订单 - 仅通过名称精确匹配或CAS号匹配"""
    # 精确匹配 - 按名称
    query = select(ReagentOrder).where(ReagentOrder.name == item.name)
    exact_match = db.exec(query).first()

    if exact_match:
        return MatchedItem(cart_item=item, matched_id=exact_match.id, match_type=MatchType.EXACT, similarity=1.0)

    # CAS号匹配
    normalized_cas = normalize_cas(item.cas_number)
    if normalized_cas:
        cas_query = select(ReagentOrder).where(ReagentOrder.cas_number == normalized_cas)
        cas_match = db.exec(cas_query).first()
        if cas_match:
            return MatchedItem(cart_item=item, matched_id=cas_match.id, match_type=MatchType.EXACT, similarity=1.0)

    return MatchedItem(cart_item=item, matched_id=None, match_type=MatchType.NONE, similarity=0.0)


# ==================== API 路由 ====================
@router.post("", response_model=CartSyncResponse, dependencies=[Depends(get_current_user)])
async def sync_cart(
    request: CartItemRequest,
    db: Annotated[Session, Depends(get_db)]
):
    """同步购物车数据并匹配现有订单"""
    if not request.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart is empty")

    matched_items = []
    unmatched_count = 0

    for item in request.items:
        if request.order_type == OrderType.CONSUMABLE:
            matched = match_consumable_order(db, item)
        else:
            matched = match_reagent_order(db, item)

        matched_items.append(matched)
        if matched.match_type == MatchType.NONE:
            unmatched_count += 1

    matched_count = len(matched_items) - unmatched_count

    return CartSyncResponse(
        total=len(request.items),
        matched=matched_count,
        unmatched=unmatched_count,
        items=matched_items
    )
