# 图片上传、压缩与静态文件删除。
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath

from fastapi import UploadFile, HTTPException
from PIL import Image
import io

from app.core.config import settings, BASE_DIR, UPLOADS_DIR
from app.core.constants import (
    ANNOUNCEMENT_IMAGE_MAX_MB,
    AVATAR_MAX_HEIGHT,
    AVATAR_MAX_SIZE_MB,
    AVATAR_MAX_WIDTH,
    DEFAULT_IMAGE_MAX_MB,
    DIRECTORY_STORAGE_MAX_MB,
    IMAGE_QUALITY_DEFAULT,
    IMAGE_QUALITY_MIN,
    TIMESTAMP_FILENAME_FORMAT,
    UPLOAD_FILENAME_UUID_PREFIX_LEN,
)
from app.core.time_utils import get_utc_now


def _resolve_static_path(file_path: str, required_subdir: str | None = None) -> Path | None:
    # 用户传入的是 URL/相对路径，不允许跳出 static 根目录。
    relative_path = _sanitize_static_relative_path(file_path)
    if relative_path is None:
        return None

    static_root = (BASE_DIR / "static").resolve()
    allowed_root = static_root
    if required_subdir:
        required_relative = _sanitize_static_relative_path(required_subdir)
        if required_relative is None:
            return None
        allowed_root = (static_root / required_relative).resolve()
        try:
            allowed_root.relative_to(static_root)
        except ValueError:
            return None

        required_parts = required_relative.parts
        if relative_path.parts[:len(required_parts)] == required_parts:
            relative_path = Path(*relative_path.parts[len(required_parts):])
            if not relative_path.parts:
                return None

    candidate = (allowed_root / relative_path).resolve()

    try:
        candidate.relative_to(allowed_root)
    except ValueError:
        return None

    return candidate


def _sanitize_static_relative_path(file_path: str) -> Path | None:
    raw_path = (file_path or "").strip()
    if not raw_path:
        return None

    normalized = raw_path.split("?", maxsplit=1)[0].split("#", maxsplit=1)[0].strip()
    if not normalized:
        return None

    windows_path = PureWindowsPath(normalized)
    if windows_path.drive or normalized.startswith(("\\\\", "//")):
        return None

    normalized = normalized.replace("\\", "/").lstrip("/")
    if normalized.startswith("static/"):
        normalized = normalized[len("static/"):]
    if not normalized:
        return None

    relative_path = PurePosixPath(normalized)
    if relative_path.is_absolute() or any(part in {"", ".", ".."} for part in relative_path.parts):
        return None

    return Path(*relative_path.parts)


def validate_image_type_and_get_bytes(file: UploadFile) -> tuple[bool, bytes]:
    if file.content_type not in settings.allowed_image_types:
        return False, b''
    
    # 读取后要把文件指针复位，避免后续保存拿到空内容。
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


def validate_image_size_from_bytes(content: bytes, max_size_mb: float = DEFAULT_IMAGE_MAX_MB) -> bool:
    max_size_bytes = int(max_size_mb * 1024 * 1024)
    return len(content) <= max_size_bytes


def validate_image_type(file: UploadFile) -> bool:
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


def validate_image_size(file: UploadFile, max_size_mb: float = DEFAULT_IMAGE_MAX_MB) -> bool:
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
    # 头像压缩优先满足体积约束，其次再保留更多画质。
    if max_size_kb is None:
        max_size_kb = settings.max_image_size_kb
    if max_width is None:
        max_width = settings.max_image_width
    if max_height is None:
        max_height = settings.max_image_height
    
    image.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
    
    if image.mode in ("RGBA", "P") and image.format != "JPEG":
        image = image.convert("RGB")
    
    quality = IMAGE_QUALITY_DEFAULT
    min_quality = IMAGE_QUALITY_MIN
    
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
    file_ext = Path(file.filename).suffix.lower() if file.filename else ".bin"
    unique_id = str(uuid.uuid4())[:UPLOAD_FILENAME_UUID_PREFIX_LEN]
    timestamp = get_utc_now().strftime(TIMESTAMP_FILENAME_FORMAT)
    filename = f"{timestamp}_{unique_id}{file_ext}"
    
    save_dir = UPLOADS_DIR / subfolder
    save_dir.mkdir(parents=True, exist_ok=True)
    save_path = save_dir / filename
    
    content = file.file.read()
    with open(save_path, "wb") as f:
        f.write(content)
    
    return f"/static/uploads/{subfolder}/{filename}"


def delete_file(file_path: str, required_subdir: str | None = None) -> bool:
    full_path = _resolve_static_path(file_path, required_subdir=required_subdir)
    if full_path is None:
        return False

    if full_path.exists() and full_path.is_file():
        full_path.unlink()
        return True
    return False


def get_file_size_kb(file_path: str) -> float:
    full_path = _resolve_static_path(file_path)
    if full_path is None:
        return 0.0

    if full_path.exists():
        return full_path.stat().st_size / 1024
    return 0.0


def get_directory_storage_info(subdir: str) -> dict:
    static_dir = BASE_DIR / "static" / subdir
    max_mb = DIRECTORY_STORAGE_MAX_MB
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
    is_valid, file_content = validate_image_type_and_get_bytes(file)

    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail="Invalid image type. Allowed: JPG, PNG, GIF, WebP"
        )

    if not validate_image_size_from_bytes(file_content, AVATAR_MAX_SIZE_MB):
        raise HTTPException(
            status_code=400,
            detail="Image size exceeds 5MB limit"
        )

    avatars_dir = BASE_DIR / "static" / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)

    timestamp = get_utc_now().strftime(TIMESTAMP_FILENAME_FORMAT)
    unique_id = str(uuid.uuid4())[:UPLOAD_FILENAME_UUID_PREFIX_LEN]
    filename = f"avatar_{user_id}_{timestamp}_{unique_id}.jpg"

    image = Image.open(io.BytesIO(file_content))
    compressed_image = compress_image(image, max_size_kb=settings.max_image_size_kb, max_width=AVATAR_MAX_WIDTH, max_height=AVATAR_MAX_HEIGHT)

    save_path = avatars_dir / filename
    compressed_image.save(save_path, format="JPEG", quality=IMAGE_QUALITY_DEFAULT, optimize=True)

    return f"/static/avatars/{filename}"


def save_announcement_image(file: UploadFile) -> str:
    is_valid, content = validate_image_type_and_get_bytes(file)
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail="Invalid image type. Allowed: JPG, PNG, GIF, WebP"
        )
        
    if not validate_image_size_from_bytes(content, max_size_mb=ANNOUNCEMENT_IMAGE_MAX_MB):
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
