# 公告路由。
"""
Announcement API Routes - System Announcements Management
"""
from typing import List, Optional, Annotated
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from sqlmodel import Session, select, func

from app.core.auth import AdminUser, get_current_user, require_admin
from app.core.config import settings
from app.core.constants import INVALID_FILENAME_PREFIX, INVALID_FILENAME_SEGMENTS, MAX_PAGE_SIZE
from app.core.request_utils import get_client_ip, get_request_id, get_request_is_cli
from app.core.time_utils import get_utc_now, utc_iso_str
from app.database import get_db
from app.models.announcement import (
    Announcement,
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementUpdate,
)
from app.models.user import User
from app.models.user_operation_log import UserOperationAction
from app.services.image_service import save_announcement_image, delete_file, get_directory_storage_info
from app.services.rate_limit import enforce_rate_limit
from app.services.user_operation_logger import log_user_operation
from app.services.user_utils import batch_get_user_names

router = APIRouter(prefix="/announcements", tags=["Announcements"])

logger = logging.getLogger(__name__)
# ==================== 辅助函数 ====================


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


def _delete_announcement_images(image_urls: list[str] | None) -> None:
    """Delete announcement image files, logging failures without blocking DB mutations."""
    for image_url in image_urls or []:
        try:
            delete_file(image_url, required_subdir="announcements")
        except Exception as e:
            logger.error("Failed to delete image %s: %s", image_url, e)


def _delete_removed_announcement_images(
    old_images: list[str] | None,
    new_images: list[str] | None,
) -> None:
    retained_images = set(new_images or [])
    removed_images = [image_url for image_url in old_images or [] if image_url not in retained_images]
    _delete_announcement_images(removed_images)


def _build_announcement_snapshot(announcement: Announcement) -> dict[str, object]:
    return {
        "id": announcement.id,
        "title": announcement.title,
        "is_pinned": announcement.is_pinned,
        "is_visible": announcement.is_visible,
        "image_count": len(announcement.images or []),
        "created_by": announcement.created_by,
        "created_at": utc_iso_str(announcement.created_at),
        "updated_at": utc_iso_str(announcement.updated_at),
    }


def _log_announcement_operation(
    db: Session,
    *,
    request: Request,
    current_user: User,
    action: UserOperationAction,
    detail: str,
    snapshot: dict[str, object],
) -> None:
    log_user_operation(
        db,
        action=action,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        detail=detail,
        snapshot=snapshot,
        is_cli=get_request_is_cli(request),
    )


# ==================== 公开接口 ====================


@router.get("/public", response_model=List[AnnouncementResponse], dependencies=[Depends(get_current_user)])
def get_public_announcements(
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


@router.get("/storage-info", dependencies=[Depends(require_admin)])
def get_storage_info():
    """
    Get storage usage information for announcement images (admin only)
    """
    storage_info = get_directory_storage_info("announcements")
    return storage_info


# ==================== 管理员接口 ====================


@router.get("/", response_model=List[AnnouncementResponse], dependencies=[Depends(require_admin)])
def list_announcements(
    db: Annotated[Session, Depends(get_db)],
    skip: int = 0,
    limit: int = MAX_PAGE_SIZE,
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
    request: Request,
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
    db.flush()
    _log_announcement_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.CREATE_ANNOUNCEMENT,
        detail=f"公告={db_announcement.title}",
        snapshot=_build_announcement_snapshot(db_announcement),
    )
    db.commit()
    db.refresh(db_announcement)

    return enrich_with_creator_name(db_announcement, db)


@router.get("/{announcement_id}", response_model=AnnouncementResponse, dependencies=[Depends(require_admin)])
def get_announcement(
    announcement_id: int,
    db: Annotated[Session, Depends(get_db)],
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
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: AdminUser,
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

    # 更新字段。
    old_images = list(announcement.images or [])
    before_snapshot = _build_announcement_snapshot(announcement)
    update_data = announcement_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(announcement, field, value)

    # 更新时间戳。
    announcement.updated_at = get_utc_now()

    db.flush()
    _log_announcement_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.UPDATE_ANNOUNCEMENT,
        detail=f"公告={announcement.title}",
        snapshot={
            "before": before_snapshot,
            "after": _build_announcement_snapshot(announcement),
        },
    )
    db.commit()
    db.refresh(announcement)

    if "images" in update_data:
        _delete_removed_announcement_images(old_images, announcement.images)

    return enrich_with_creator_name(announcement, db)


@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(
    announcement_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: AdminUser,
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

    # 删除关联图片。
    before_snapshot = _build_announcement_snapshot(announcement)
    _delete_announcement_images(announcement.images)

    db.delete(announcement)
    _log_announcement_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.DELETE_ANNOUNCEMENT,
        detail=f"公告={announcement.title}",
        snapshot={
            "before": before_snapshot,
            "after": {},
        },
    )
    db.commit()


@router.post("/{announcement_id}/toggle-pin", response_model=AnnouncementResponse)
def toggle_pin_announcement(
    announcement_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: AdminUser,
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

    before_snapshot = _build_announcement_snapshot(announcement)
    announcement.is_pinned = not announcement.is_pinned
    announcement.updated_at = get_utc_now()

    db.flush()
    _log_announcement_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.UPDATE_ANNOUNCEMENT_PIN,
        detail=f"公告={announcement.title} 置顶={announcement.is_pinned}",
        snapshot={
            "before": before_snapshot,
            "after": _build_announcement_snapshot(announcement),
        },
    )
    db.commit()
    db.refresh(announcement)

    return enrich_with_creator_name(announcement, db)


@router.post("/{announcement_id}/toggle-visibility", response_model=AnnouncementResponse)
def toggle_visibility_announcement(
    announcement_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: AdminUser,
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

    before_snapshot = _build_announcement_snapshot(announcement)
    announcement.is_visible = not announcement.is_visible
    announcement.updated_at = get_utc_now()

    db.flush()
    _log_announcement_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.UPDATE_ANNOUNCEMENT_VISIBILITY,
        detail=f"公告={announcement.title} 可见={announcement.is_visible}",
        snapshot={
            "before": before_snapshot,
            "after": _build_announcement_snapshot(announcement),
        },
    )
    db.commit()
    db.refresh(announcement)

    return enrich_with_creator_name(announcement, db)


@router.post("/upload-image")
async def upload_announcement_image(
    file: UploadFile,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: AdminUser,
):
    """
    Upload announcement image (admin only)
    Returns the URL of the uploaded image
    """
    client_ip = get_client_ip(request)
    enforce_rate_limit(
        scope="upload_announcement_image",
        identifier=client_ip,
        limit=settings.upload_rate_limit_count,
        window_seconds=settings.upload_rate_limit_window_seconds,
    )

    # 检查存储容量配额
    storage_info = get_directory_storage_info("announcements")
    if storage_info["used_bytes"] >= storage_info["max_bytes"]:
        raise HTTPException(
            status_code=413,
            detail=f"Storage limit exceeded. Maximum storage: {storage_info['max_mb']}MB"
        )
        
    # 使用带有格式和大小校验的函数
    image_url = save_announcement_image(file)
    _log_announcement_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.UPLOAD_ANNOUNCEMENT_IMAGE,
        detail=f"图片={image_url}",
        snapshot={"image_url": image_url},
    )
    db.commit()
    return {"url": image_url, "message": "Image uploaded successfully"}


@router.delete("/images/{filename}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement_image(
    filename: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: AdminUser,
):
    """
    Delete announcement image (admin only)
    """
    # 修复路径穿越漏洞
    if any(segment in filename for segment in INVALID_FILENAME_SEGMENTS) or filename.startswith(INVALID_FILENAME_PREFIX):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename")

    deleted = delete_file(filename, required_subdir="announcements")
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found"
        )
    _log_announcement_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.DELETE_ANNOUNCEMENT_IMAGE,
        detail=f"图片={filename}",
        snapshot={"filename": filename},
    )
    db.commit()
