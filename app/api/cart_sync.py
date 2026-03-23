"""
Cart Sync API - 购物车同步
支持耗材订单和试剂订单的自动匹配与导入
"""
import logging
from enum import Enum
from typing import List, Optional, Annotated
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.database import get_db
from app.core.auth import get_current_user
from app.models.user import User, UserRole
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.reagent_order import ReagentOrder, ReagentOrderStatus
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.spec_utils import parse_specification
from app.services.cas_utils import BIOLOGICAL_REAGENT_CAS, normalize_cas

MIN_CART_ITEM_PRICE = 0.01

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
    unit: str = ""
    product_number: str = ""
    is_hazardous: bool = False
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
    items: List[CartItem] = Field(min_length=1, max_length=100)
    order_type: OrderType = OrderType.CONSUMABLE


class CartImportResponse(BaseModel):
    """导入响应"""
    success: bool
    created: int
    errors: List[str] = Field(default_factory=list)


def _clean_text(value: Optional[str]) -> str:
    return (value or "").strip()


def _safe_parse_specification(specification: str) -> tuple[Optional[float], Optional[str]]:
    spec = _clean_text(specification)
    if not spec:
        return None, None

    try:
        parsed_quantity, parsed_unit = parse_specification(spec)
        return parsed_quantity, parsed_unit
    except Exception:
        logger.info("Skip specification parsing due to unsupported format: %s", spec)
        return None, None


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


# ==================== API Routes ====================
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


@router.post("/import", response_model=CartImportResponse)
async def import_cart(
    request: CartImportRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)]
):
    """导入购物车商品到系统"""
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="公共账号不允许导入订单")

    created_count = 0
    errors: List[str] = []
    pending_orders: List[ConsumableOrder | ReagentOrder] = []

    for item in request.items:
        item_name = _clean_text(item.name) or "未知商品"
        try:
            item_specification = _clean_text(item.specification) or "未知"
            item_english_name = _clean_text(item.english_name)
            item_brand = _clean_text(item.brand)
            item_alias = _clean_text(item.alias)
            item_cas_number = normalize_cas(item.cas_number) or BIOLOGICAL_REAGENT_CAS
            item_product_number = _clean_text(item.product_number)
            parsed_quantity, parsed_unit = _safe_parse_specification(item_specification)

            if request.order_type == OrderType.CONSUMABLE:
                # 创建耗材订单
                db_order = ConsumableOrder(
                    name=item_name,
                    specification=item_specification,
                    unit=_clean_text(item.unit) or parsed_unit,
                    quantity=item.quantity,
                    price=item.price,
                    english_name=item_english_name or None,
                    product_number=item_product_number or None,
                    applicant_id=current_user.id,
                    status=ConsumableOrderStatus.PENDING,
                    **compute_pinyin_fields(name=item_name),
                )
            else:
                # 创建试剂订单
                db_order = ReagentOrder(
                    name=item_name,
                    specification=item_specification,
                    initial_quantity=parsed_quantity,
                    unit=parsed_unit,
                    quantity=item.quantity,
                    price=item.price if item.price and item.price > 0 else MIN_CART_ITEM_PRICE,
                    brand=item_brand or None,
                    english_name=item_english_name or None,
                    cas_number=item_cas_number,
                    alias=item_alias or None,
                    is_hazardous=item.is_hazardous,
                    applicant_id=current_user.id,
                    status=ReagentOrderStatus.PENDING,
                    **compute_pinyin_fields(name=item_name, brand=item_brand),
                )

            pending_orders.append(db_order)

        except Exception:
            logger.exception("Failed to parse/import cart item '%s'", item_name)
            errors.append(f"{item_name}: 导入失败，请检查商品数据")

    if pending_orders:
        try:
            for order in pending_orders:
                db.add(order)
            db.commit()
            created_count = len(pending_orders)
        except Exception:
            db.rollback()
            logger.exception("Failed to persist imported cart orders")
            errors.append("批量保存订单失败，请稍后重试")

    return CartImportResponse(success=len(errors) == 0, created=created_count, errors=errors)
