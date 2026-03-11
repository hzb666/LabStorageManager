"""
化学物质信息查询 API
"""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status

from app.models.user import User
from app.core.auth import get_current_user
from app.services.chemical_info import query_chemical_info
from app.services.cas_utils import validate_and_normalize_cas

router = APIRouter(prefix="/chemical-info", tags=["Chemical Info"])


@router.get("/{cas_number}")
def get_chemical_info(
    cas_number: str,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    根据 CAS 号查询化学物质信息
    
    返回:
    - name: 中文名（从 chemblink.com 获取）
    - english_name: 英文名（从 PubChem API 获取）
    """
    # 先验证 CAS 号格式和校验位
    is_valid, error_msg, normalized_cas = validate_and_normalize_cas(cas_number)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg or "Invalid CAS number"
        )
    
    result = query_chemical_info(normalized_cas)
    
    return {
        "cas_number": normalized_cas,
        "name": result["name"],
        "english_name": result["english_name"],
    }
