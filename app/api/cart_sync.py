"""
Cart Sync API - 北大医学部购物车同步
支持耗材订单和试剂订单的自动匹配与导入
"""
import logging
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.consumable_order import ConsumableOrder, ConsumableOrderCreate, ConsumableOrderStatus
from app.models.reagent_order import ReagentOrder, ReagentOrderCreate, ReagentOrderStatus
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.spec_utils import parse_specification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cart-sync", tags=["CartSync"])


# ==================== Enums ====================
class OrderType(str, Enum):
    """订单类型"""
    CONSUMABLE = "consumable"  # 耗材订单
    REAGENT = "reagent"  # 试剂订单


class MatchType(str, Enum):
    """匹配类型"""
    EXACT = "exact"  # 精确匹配
    NONE = "none"  # 无匹配


# ==================== Request/Response Models ====================
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
    product_id: Optional[str] = None  # 学校系统产品ID
    detail_url: Optional[str] = None  # 详情页URL


class CartItemRequest(BaseModel):
    """同步请求"""
    items: List[CartItem]
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
    items: List[MatchedItem]


class CartImportRequest(BaseModel):
    """导入请求"""
    items: List[CartItem]
    order_type: OrderType = OrderType.CONSUMABLE


class CartImportResponse(BaseModel):
    """导入响应"""
    success: bool
    created: int
    errors: List[str] = []


def match_consumable_order(db: Session, item: CartItem) -> MatchedItem:
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
    if item.cas_number:
        cas_query = select(ReagentOrder).where(ReagentOrder.cas_number == item.cas_number)
        cas_match = db.exec(cas_query).first()
        if cas_match:
            return MatchedItem(cart_item=item, matched_id=cas_match.id, match_type=MatchType.EXACT, similarity=1.0)

    return MatchedItem(cart_item=item, matched_id=None, match_type=MatchType.NONE, similarity=0.0)


# ==================== API Routes ====================
@router.post("", response_model=CartSyncResponse)
async def sync_cart(
    request: CartItemRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """同步购物车数据并匹配现有订单"""
    if not request.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="购物车不能为空")

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


@router.post("/import", response_model=CartImportResponse)
async def import_cart(
    request: CartImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """导入购物车商品到系统"""
    if not request.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="购物车不能为空")

    created_count = 0
    errors = []

    for item in request.items:
        try:
            parsed = parse_specification(item.specification or "未知")

            if request.order_type == OrderType.CONSUMABLE:
                # 创建耗材订单
                db_order = ConsumableOrder(
                    name=item.name,
                    specification=item.specification or "未知",
                    initial_quantity=parsed.get("initial_quantity"),
                    unit=parsed.get("unit"),
                    quantity=item.quantity,
                    price=item.price,
                    brand=item.brand,
                    english_name=item.english_name or None,
                    alias=item.alias or item.cas_number or None,
                    category=None,
                    applicant_id=current_user.id,
                    status=ConsumableOrderStatus.PENDING,
                )
                pinyin_fields = compute_pinyin_fields(db_order.name)
                db_order.name_pinyin = pinyin_fields["name_pinyin"]
            else:
                # 创建试剂订单
                db_order = ReagentOrder(
                    name=item.name,
                    specification=item.specification or "未知",
                    initial_quantity=parsed.get("initial_quantity"),
                    unit=parsed.get("unit"),
                    quantity=item.quantity,
                    price=item.price if item.price and item.price > 0 else 0.01,
                    brand=item.brand,
                    english_name=item.english_name or None,
                    cas_number=item.cas_number or "unknown",
                    alias=item.alias or None,
                    applicant_id=current_user.id,
                    status=ReagentOrderStatus.PENDING,
                )

            db.add(db_order)
            db.commit()
            db.refresh(db_order)
            created_count += 1

        except Exception as e:
            logger.error(f"Failed to import cart item '{item.name}': {str(e)}")
            errors.append(f"{item.name}: {str(e)}")

    return CartImportResponse(success=len(errors) == 0, created=created_count, errors=errors)
