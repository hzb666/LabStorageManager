"""
Announcement API Routes - System Announcements Management
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlmodel import Session, select

from app.core.auth import get_current_user, require_admin
from app.database import get_db
from app.models.announcement import (
    Announcement,
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementUpdate,
)
from app.models.user import User
from app.services import announcement_image_service

router = APIRouter(prefix="/announcements", tags=["Announcements"])


# ==================== Helper Functions ====================


def get_announcement_by_id(db: Session, announcement_id: int) -> Optional[Announcement]:
    """Get announcement by ID"""
    return db.get(Announcement, announcement_id)


# ==================== Public Endpoints ====================


@router.get("/public", response_model=List[AnnouncementResponse])
def get_public_announcements(
    db: Session = Depends(get_db),
):
    """
    Get public announcements - no login required
    Returns only pinned and visible announcements
    """
    statement = (
        select(Announcement)
        .where(Announcement.is_pinned == True)
        .where(Announcement.is_visible == True)
        .order_by(Announcement.created_at.desc())
    )
    announcements = db.exec(statement).all()
    return announcements


# ==================== Admin Endpoints ====================


@router.get("/", response_model=List[AnnouncementResponse])
def list_announcements(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
    return announcements


@router.post("/", response_model=AnnouncementResponse, status_code=status.HTTP_201_CREATED)
def create_announcement(
    announcement: AnnouncementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Create a new announcement (admin only)
    """
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

    return db_announcement


@router.get("/{announcement_id}", response_model=AnnouncementResponse)
def get_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
    return announcement


@router.put("/{announcement_id}", response_model=AnnouncementResponse)
def update_announcement(
    announcement_id: int,
    announcement_update: AnnouncementUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
    announcement.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(announcement)

    return announcement


@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
                announcement_image_service.delete_image(image_url)
            except Exception:
                # Log error but continue with deletion
                pass

    db.delete(announcement)
    db.commit()


@router.post("/{announcement_id}/toggle-pin", response_model=AnnouncementResponse)
def toggle_pin_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
    announcement.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(announcement)

    return announcement


@router.post("/{announcement_id}/toggle-visibility", response_model=AnnouncementResponse)
def toggle_visibility_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
    announcement.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(announcement)

    return announcement


@router.post("/upload-image")
async def upload_announcement_image(
    file: UploadFile,
    current_user: User = Depends(require_admin),
):
    """
    Upload announcement image (admin only)
    Returns the URL of the uploaded image
    """
    try:
        image_url = announcement_image_service.save_image(file)
        return {"url": image_url, "message": "Image uploaded successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload image: {str(e)}"
        )


@router.delete("/images/{filename}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement_image(
    filename: str,
    current_user: User = Depends(require_admin),
):
    """
    Delete announcement image (admin only)
    """
    # Construct the URL path
    url_path = f"/static/announcements/{filename}"

    try:
        deleted = announcement_image_service.delete_image(url_path)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Image not found"
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete image: {str(e)}"
        )


@router.get("/storage-info")
def get_storage_info(
    current_user: User = Depends(require_admin),
):
    """
    Get storage usage information for announcement images (admin only)
    """
    used_bytes, max_bytes = announcement_image_service.get_storage_usage()

    # Get count of image files
    images_dir = announcement_image_service.get_announcement_images_dir()
    image_count = 0
    if images_dir.exists():
        image_count = sum(1 for f in images_dir.iterdir() if f.is_file())

    return {
        "used_bytes": used_bytes,
        "used_mb": round(used_bytes / (1024 * 1024), 2),
        "max_bytes": max_bytes,
        "max_mb": round(max_bytes / (1024 * 1024), 2),
        "usage_percent": round((used_bytes / max_bytes) * 100, 2) if max_bytes > 0 else 0,
        "image_count": image_count,
    }
