"""
Announcement Image Service - Upload and manage announcement images
Images are stored in filesystem, database only stores URL/path
"""
import uuid
from pathlib import Path
from typing import List, Tuple

from fastapi import UploadFile, HTTPException
from PIL import Image

from app.core.config import settings


# Configuration constants
ANNOUNCEMENT_IMAGES_DIR = Path("static/announcements")
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB
MAX_TOTAL_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def get_announcement_images_dir() -> Path:
    """
    Get the announcement images directory path.

    Returns:
        Path to the announcement images directory
    """
    return settings.BASE_DIR / ANNOUNCEMENT_IMAGES_DIR


def ensure_images_dir() -> Path:
    """
    Ensure the announcement images directory exists.

    Returns:
        Path to the announcement images directory
    """
    images_dir = get_announcement_images_dir()
    images_dir.mkdir(parents=True, exist_ok=True)
    return images_dir


def get_storage_usage() -> Tuple[int, int]:
    """
    Get current storage usage for announcement images.

    Returns:
        Tuple of (used_bytes, max_bytes)
    """
    images_dir = get_announcement_images_dir()
    max_bytes = MAX_TOTAL_SIZE

    if not images_dir.exists():
        return 0, max_bytes

    used_bytes = 0
    for file_path in images_dir.iterdir():
        if file_path.is_file():
            used_bytes += file_path.stat().st_size

    return used_bytes, max_bytes


def validate_image(file: UploadFile) -> None:
    """
    Validate uploaded image file (size, extension, and content).

    Args:
        file: Uploaded file object

    Raises:
        HTTPException: If validation fails
    """
    # Check file extension
    file_ext = Path(file.filename).suffix.lower() if file.filename else ""
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file extension. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Check file size (need to read content to get size)
    file.file.seek(0, 2)  # Seek to end
    file_size = file.file.tell()
    file.file.seek(0)  # Seek back to beginning

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File size exceeds maximum allowed size of {MAX_FILE_SIZE / (1024 * 1024)}MB"
        )

    if file_size == 0:
        raise HTTPException(
            status_code=400,
            detail="File is empty"
        )

    # Validate image content using PIL
    try:
        file.file.seek(0)
        img = Image.open(file.file)
        img.verify()  # Verify it's a valid image
        file.file.seek(0)  # Reset file pointer after verify
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid image file content"
        )


def save_image(file: UploadFile) -> str:
    """
    Save uploaded image and return URL.

    Args:
        file: Uploaded file object

    Returns:
        Relative URL path for database storage

    Raises:
        HTTPException: If validation fails or storage limit exceeded
    """
    # Validate file
    validate_image(file)

    # Check total storage limit
    used_bytes, max_bytes = get_storage_usage()
    if used_bytes >= max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Storage limit exceeded. Maximum storage: {max_bytes / (1024 * 1024)}MB"
        )

    # Ensure directory exists
    images_dir = ensure_images_dir()

    # Generate unique filename
    file_ext = Path(file.filename).suffix.lower() if file.filename else ".jpg"
    unique_id = str(uuid.uuid4())
    filename = f"{unique_id}{file_ext}"

    # Save file
    file_path = images_dir / filename
    content = file.file.read()
    file_path.write_bytes(content)

    # Return relative URL
    return f"/static/announcements/{filename}"


def delete_image(url: str) -> bool:
    """
    Delete a single image from storage.

    Args:
        url: Relative URL path of the image

    Returns:
        True if deleted successfully, False otherwise
    """
    if not url:
        return False

    # Extract filename from URL
    filename = url.split("/")[-1]

    # Validate filename to prevent path traversal
    if not filename or ".." in filename or filename.startswith("/"):
        return False

    file_path = get_announcement_images_dir() / filename

    if file_path.exists():
        file_path.unlink()
        return True
    return False


def delete_images(urls: List[str]) -> List[str]:
    """
    Delete multiple images from storage.

    Args:
        urls: List of relative URL paths of the images

    Returns:
        List of URLs that failed to delete
    """
    failed_urls = []

    for url in urls:
        if not delete_image(url):
            failed_urls.append(url)

    return failed_urls
