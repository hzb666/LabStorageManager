# app/routers/announcements.py
"""
Announcement API Routes - System Announcements Management
"""
from typing import List, Optional, Annotated
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlmodel import Session, select, func

from app.core.auth import CurrentUser, require_admin
from app.core.config import settings
from app.core.time_utils import get_utc_now
from app.database import get_db
from app.models.announcement import (
    Announcement,
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementUpdate,
)
from app.models.user import User
from app.services.image_service import save_announcement_image, delete_file, get_directory_storage_info
from app.services.user_utils import batch_get_user_names

router = APIRouter(prefix="/announcements", tags=["Announcements"])

logger = logging.getLogger(__name__)
# ==================== Helper Functions ====================


def get_announcement_by_id(db: Session, announcement_id: int) -> Optional[Announcement]:
    """Get announcement by ID"""
    return db.get(Announcement, announcement_id)


def enrich_with_creator_name(announcement: Announcement, db: Session) -> AnnouncementResponse:
    """Enrich announcement response with creator's name"""
    resp = AnnouncementResponse.model_validate(announcement)
    if announcement.created_by:
        user = db.get(User, announcement.created_by)
        resp.created_by_name = user.full_name or user.username if user else None
    return resp


# ==================== Public Endpoints ====================


@router.get("/public", response_model=List[AnnouncementResponse])
def get_public_announcements(
    current_user: CurrentUser,  # 添加鉴权：要求登录
    db: Annotated[Session, Depends(get_db)],
):
    """
    Get public announcements - requires login
    Returns all visible announcements (both pinned and unpinned), sorted by pin status and creation date
    """
    statement = (
        select(Announcement)
        .where(Announcement.is_visible)
        .order_by(Announcement.is_pinned.desc())
        .order_by(Announcement.created_at.desc())
    )
    announcements = db.exec(statement).all()

    # 批量获取创建者姓名
    user_ids = {a.created_by for a in announcements if a.created_by}
    users_map = batch_get_user_names(db, user_ids)

    # 填充创建者姓名
    result = []
    for a in announcements:
        resp = AnnouncementResponse.model_validate(a)
        resp.created_by_name = users_map.get(a.created_by) if a.created_by else None
        result.append(resp)
    return result


@router.get("/storage-info")
def get_storage_info(
    current_user: Annotated[User, Depends(require_admin)],
):
    """
    Get storage usage information for announcement images (admin only)
    """
    storage_info = get_directory_storage_info("announcements")
    return storage_info


# ==================== Admin Endpoints ====================


@router.get("/", response_model=List[AnnouncementResponse])
def list_announcements(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
    skip: int = 0,
    limit: int = 100,
):
    """
    Get all announcements (admin only)
    Returns all announcements sorted by is_pinned (desc) and created_at (desc)
    """
    statement = (
        select(Announcement)
        .order_by(Announcement.is_pinned.desc())
        .order_by(Announcement.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    announcements = db.exec(statement).all()

    # 批量获取创建者姓名
    user_ids = {a.created_by for a in announcements if a.created_by}
    users_map = batch_get_user_names(db, user_ids)

    # 填充创建者姓名
    result = []
    for a in announcements:
        resp = AnnouncementResponse.model_validate(a)
        resp.created_by_name = users_map.get(a.created_by) if a.created_by else None
        result.append(resp)
    return result


# 管理员公告数量限制（从配置读取）
MAX_TOTAL_ANNOUNCEMENTS = settings.max_total_announcements
MAX_VISIBLE_ANNOUNCEMENTS = settings.max_visible_announcements


@router.post("/", response_model=AnnouncementResponse, status_code=status.HTTP_201_CREATED)
def create_announcement(
    announcement: AnnouncementCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    """
    Create a new announcement (admin only)
    """
    # 检查总数量限制
    stmt = select(func.count()).where(Announcement.created_by == current_user.id)
    total_count = db.exec(stmt).one()
    if total_count >= MAX_TOTAL_ANNOUNCEMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"Max {MAX_TOTAL_ANNOUNCEMENTS} announcements allowed per admin"
        )

    # 检查显示数量限制（如果设为显示状态）
    if announcement.is_visible:
        stmt = select(func.count()).where(
            Announcement.created_by == current_user.id,
            Announcement.is_visible
        )
        visible_count = db.exec(stmt).one()
        if visible_count >= MAX_VISIBLE_ANNOUNCEMENTS:
            raise HTTPException(
                status_code=400,
                detail=f"Max {MAX_VISIBLE_ANNOUNCEMENTS} visible announcements allowed per admin"
            )

    db_announcement = Announcement(
        title=announcement.title,
        content=announcement.content,
        images=announcement.images,
        is_pinned=announcement.is_pinned,
        is_visible=announcement.is_visible,
        created_by=current_user.id,
    )

    db.add(db_announcement)
    db.commit()
    db.refresh(db_announcement)

    return enrich_with_creator_name(db_announcement, db)


@router.get("/{announcement_id}", response_model=AnnouncementResponse)
def get_announcement(
    announcement_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    """
    Get announcement by ID (admin only)
    """
    announcement = get_announcement_by_id(db, announcement_id)
    if not announcement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Announcement not found"
        )
    return enrich_with_creator_name(announcement, db)


@router.put("/{announcement_id}", response_model=AnnouncementResponse)
def update_announcement(
    announcement_id: int,
    announcement_update: AnnouncementUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    """
    Update announcement (admin only)
    """
    announcement = get_announcement_by_id(db, announcement_id)
    if not announcement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Announcement not found"
        )

    # Update fields
    update_data = announcement_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(announcement, field, value)

    # Update timestamp
    announcement.updated_at = get_utc_now()

    db.commit()
    db.refresh(announcement)

    return enrich_with_creator_name(announcement, db)


@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(
    announcement_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    """
    Delete announcement (admin only)
    Also deletes associated images
    """
    announcement = get_announcement_by_id(db, announcement_id)
    if not announcement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Announcement not found"
        )

    # Delete associated images
    if announcement.images:
        for image_url in announcement.images:
            try:
                delete_file(image_url)
            except Exception as e:
                logger.error("Failed to delete image %s: %s", image_url, e)

    db.delete(announcement)
    db.commit()


@router.post("/{announcement_id}/toggle-pin", response_model=AnnouncementResponse)
def toggle_pin_announcement(
    announcement_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    """
    Toggle pin status of announcement (admin only)
    """
    announcement = get_announcement_by_id(db, announcement_id)
    if not announcement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Announcement not found"
        )

    announcement.is_pinned = not announcement.is_pinned
    announcement.updated_at = get_utc_now()

    db.commit()
    db.refresh(announcement)

    return enrich_with_creator_name(announcement, db)


@router.post("/{announcement_id}/toggle-visibility", response_model=AnnouncementResponse)
def toggle_visibility_announcement(
    announcement_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    """
    Toggle visibility of announcement (admin only)
    """
    announcement = get_announcement_by_id(db, announcement_id)
    if not announcement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Announcement not found"
        )

    announcement.is_visible = not announcement.is_visible
    announcement.updated_at = get_utc_now()

    db.commit()
    db.refresh(announcement)

    return enrich_with_creator_name(announcement, db)


@router.post("/upload-image")
async def upload_announcement_image(
    file: UploadFile,
    current_user: Annotated[User, Depends(require_admin)],
):
    """
    Upload announcement image (admin only)
    Returns the URL of the uploaded image
    """
    # 检查存储容量配额
    storage_info = get_directory_storage_info("announcements")
    if storage_info["used_bytes"] >= storage_info["max_bytes"]:
        raise HTTPException(
            status_code=413,
            detail=f"Storage limit exceeded. Maximum storage: {storage_info['max_mb']}MB"
        )
        
    # 使用带有格式和大小校验的函数
    image_url = save_announcement_image(file)
    return {"url": image_url, "message": "Image uploaded successfully"}


@router.delete("/images/{filename}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement_image(
    filename: str,
    current_user: Annotated[User, Depends(require_admin)],
):
    """
    Delete announcement image (admin only)
    """
    # 修复路径穿越漏洞
    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename")

    # Construct the URL path
    url_path = f"/static/announcements/{filename}"

    deleted = delete_file(url_path)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found"
        )