"""
Image Service - Upload and Compression
Critical Rule #3: 
Images are stored in filesystem, database only stores URL/path
"""
import uuid
from pathlib import Path

from fastapi import UploadFile, HTTPException
from PIL import Image
import io

from app.core.config import settings, BASE_DIR, UPLOADS_DIR
from app.core.time_utils import get_utc_now


def _resolve_static_path(file_path: str) -> Path | None:
    """Resolve user-supplied file path safely under static directory only."""
    raw_path = (file_path or "").strip()
    if not raw_path:
        return None

    candidate = (BASE_DIR / raw_path.lstrip("/\\")).resolve()
    static_root = (BASE_DIR / "static").resolve()

    if candidate == static_root or static_root in candidate.parents:
        return candidate
    return None


def validate_image_type_and_get_bytes(file: UploadFile) -> tuple[bool, bytes]:
    """
    Validate uploaded file is an allowed image type and return file content.
    Also validates by reading file content to prevent malicious extension spoofing.
    
    Args:
        file: Uploaded file object
        
    Returns:
        Tuple of (is_valid, file_content_bytes)
    """
    if file.content_type not in settings.allowed_image_types:
        return False, b''
    
    # Ensure we read from the beginning and restore the pointer afterwards
    file.file.seek(0)
    content = file.file.read()
    file.file.seek(0)
    
    header = content[:16]
    is_valid = False
    
    if header.startswith(b'\xff\xd8\xff'):  # JPEG
        is_valid = file.content_type in ['image/jpeg', 'image/jpg']
    elif header.startswith(b'\x89PNG\r\n\x1a\n'):  # PNG
        is_valid = file.content_type == 'image/png'
    elif header.startswith(b'GIF87a') or header.startswith(b'GIF89a'):  # GIF
        is_valid = file.content_type == 'image/gif'
    elif header[:4] == b'RIFF' and header[8:12] == b'WEBP':  # WebP
        is_valid = file.content_type == 'image/webp'
    
    return is_valid, content


def validate_image_size_from_bytes(content: bytes, max_size_mb: float = 1.0) -> bool:
    """
    Validate file size from bytes content.
    
    Args:
        content: File content in bytes
        max_size_mb: Maximum size in MB (default 1MB)
        
    Returns:
        True if valid size, False otherwise
    """
    max_size_bytes = int(max_size_mb * 1024 * 1024)
    return len(content) <= max_size_bytes


def validate_image_type(file: UploadFile) -> bool:
    """
    Validate uploaded file is an allowed image type.
    Also validates by reading file content to prevent malicious extension spoofing.
    
    Args:
        file: Uploaded file object
        
    Returns:
        True if valid image type, False otherwise
    """
    if file.content_type not in settings.allowed_image_types:
        return False
    
    file.file.seek(0)
    header = file.file.read(16)
    file.file.seek(0)
    
    is_valid = False
    
    if header.startswith(b'\xff\xd8\xff'):  # JPEG
        is_valid = file.content_type in ['image/jpeg', 'image/jpg']
    elif header.startswith(b'\x89PNG\r\n\x1a\n'):  # PNG
        is_valid = file.content_type == 'image/png'
    elif header.startswith(b'GIF87a') or header.startswith(b'GIF89a'):  # GIF
        is_valid = file.content_type == 'image/gif'
    elif header[:4] == b'RIFF' and header[8:12] == b'WEBP':  # WebP
        is_valid = file.content_type == 'image/webp'
    
    return is_valid


def validate_image_size(file: UploadFile, max_size_mb: float = 1.0) -> bool:
    """
    Validate uploaded file size is within limits.
    
    Args:
        file: Uploaded file object
        max_size_mb: Maximum size in MB (default 1MB)
        
    Returns:
        True if valid size, False otherwise
    """
    max_size_bytes = int(max_size_mb * 1024 * 1024)
    
    file.file.seek(0, 2)  
    size = file.file.tell()
    file.file.seek(0)  
    
    return size <= max_size_bytes


def compress_image(
    image: Image.Image, 
    max_size_kb: int = None,
    max_width: int = None,
    max_height: int = None
) -> Image.Image:
    """
    Compress image to target size using Pillow.
    
    Critical: Ensure output is <100KB
    
    Args:
        image: PIL Image object
        max_size_kb: Target maximum size in KB (default from settings)
        max_width: Target maximum width (default from settings)
        max_height: Target maximum height (default from settings)
        
    Returns:
        Compressed PIL Image object
    """
    if max_size_kb is None:
        max_size_kb = settings.max_image_size_kb
    if max_width is None:
        max_width = settings.max_image_width
    if max_height is None:
        max_height = settings.max_image_height
    
    image.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
    
    if image.mode in ("RGBA", "P") and image.format != "JPEG":
        image = image.convert("RGB")
    
    quality = 85
    min_quality = 30
    
    output = io.BytesIO()
    
    while quality >= min_quality:
        output.seek(0)
        image.save(output, format="JPEG", quality=quality, optimize=True)
        size_kb = output.tell() / 1024
        
        if size_kb <= max_size_kb:
            break
        quality -= 5
    
    output.seek(0)
    return Image.open(output)


def save_upload_file(file: UploadFile, subfolder: str = "general") -> str:
    """
    Save uploaded file to filesystem with UUID rename.
    
    Args:
        file: Uploaded file object
        subfolder: Subfolder within uploads directory
        
    Returns:
        Relative URL path for database storage
    """
    file_ext = Path(file.filename).suffix.lower() if file.filename else ".bin"
    unique_id = str(uuid.uuid4())[:8]
    timestamp = get_utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{unique_id}{file_ext}"
    
    save_dir = UPLOADS_DIR / subfolder
    save_dir.mkdir(parents=True, exist_ok=True)
    save_path = save_dir / filename
    
    content = file.file.read()
    with open(save_path, "wb") as f:
        f.write(content)
    
    return f"/static/uploads/{subfolder}/{filename}"


def delete_file(file_path: str) -> bool:
    """
    Delete file from filesystem.
    
    Args:
        file_path: Relative path from static directory
        
    Returns:
        True if deleted successfully, False otherwise
    """
    full_path = _resolve_static_path(file_path)
    if full_path is None:
        return False

    if full_path.exists() and full_path.is_file():
        full_path.unlink()
        return True
    return False


def get_file_size_kb(file_path: str) -> float:
    """
    Get file size in KB.

    Args:
        file_path: Relative path from static directory

    Returns:
        File size in KB
    """
    full_path = _resolve_static_path(file_path)
    if full_path is None:
        return 0.0

    if full_path.exists():
        return full_path.stat().st_size / 1024
    return 0.0


def get_directory_storage_info(subdir: str) -> dict:
    """
    Get storage usage information for a subdirectory.

    Args:
        subdir: Subdirectory name under static/ (e.g., 'announcements', 'avatars')

    Returns:
        Dictionary with used_bytes, used_mb, max_bytes, max_mb, usage_percent, image_count
    """
    static_dir = BASE_DIR / "static" / subdir
    max_mb = 50  
    max_bytes = int(max_mb * 1024 * 1024)

    if not static_dir.exists():
        return {
            "used_bytes": 0,
            "used_mb": 0,
            "max_bytes": max_bytes,
            "max_mb": max_mb,
            "usage_percent": 0,
            "image_count": 0,
        }

    used_bytes = 0
    image_count = 0

    for file_path in static_dir.iterdir():
        if file_path.is_file():
            used_bytes += file_path.stat().st_size
            image_count += 1

    return {
        "used_bytes": used_bytes,
        "used_mb": round(used_bytes / (1024 * 1024), 2),
        "max_bytes": max_bytes,
        "max_mb": max_mb,
        "usage_percent": round((used_bytes / max_bytes) * 100, 2) if max_bytes > 0 else 0,
        "image_count": image_count,
    }


def save_avatar(file: UploadFile, user_id: int) -> str:
    """
    Save user avatar image (compressed to <100KB, max 200x200).

    Args:
        file: Uploaded file object
        user_id: User ID for naming

    Returns:
        Relative URL path for database storage
    """
    is_valid, file_content = validate_image_type_and_get_bytes(file)

    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail="Invalid image type. Allowed: JPG, PNG, GIF, WebP"
        )

    if not validate_image_size_from_bytes(file_content, 5.0):
        raise HTTPException(
            status_code=400,
            detail="Image size exceeds 5MB limit"
        )

    avatars_dir = BASE_DIR / "static" / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)

    timestamp = get_utc_now().strftime("%Y%m%d_%H%M%S")
    unique_id = str(uuid.uuid4())[:8]
    filename = f"avatar_{user_id}_{timestamp}_{unique_id}.jpg"

    image = Image.open(io.BytesIO(file_content))
    compressed_image = compress_image(image, max_size_kb=100, max_width=200, max_height=200)

    save_path = avatars_dir / filename
    compressed_image.save(save_path, format="JPEG", quality=85, optimize=True)

    return f"/static/avatars/{filename}"


def save_announcement_image(file: UploadFile) -> str:
    """
    Validate and save an announcement image (No compression applied based on original logic).
    
    Args:
        file: Uploaded file object

    Returns:
        Relative URL path for database storage
    """
    is_valid, content = validate_image_type_and_get_bytes(file)
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail="Invalid image type. Allowed: JPG, PNG, GIF, WebP"
        )
        
    if not validate_image_size_from_bytes(content, max_size_mb=5.0):
        raise HTTPException(
            status_code=400,
            detail="Image size exceeds 5MB limit"
        )
        
    file_ext = Path(file.filename).suffix.lower() if file.filename else ".jpg"
    unique_id = str(uuid.uuid4())
    filename = f"{unique_id}{file_ext}"
    
    announcement_dir = BASE_DIR / "static" / "announcements"
    announcement_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = announcement_dir / filename
    file_path.write_bytes(content)
    
    return f"/static/announcements/{filename}"