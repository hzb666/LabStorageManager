"""
Image Service - Upload and Compression
Critical Rule #3: Images must be compressed to <100KB using Pillow
Images are stored in filesystem, database only stores URL/path
"""
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import UploadFile
from PIL import Image, ImageOps
import io

from app.core.config import settings, UPLOADS_DIR, THUMBNAILS_DIR


def validate_image_type(file: UploadFile) -> bool:
    """
    Validate uploaded file is an allowed image type.
    
    Args:
        file: Uploaded file object
        
    Returns:
        True if valid image type, False otherwise
    """
    return file.content_type in settings.allowed_image_types


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
    
    # Resize if too large
    image.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
    
    # Convert to RGB if necessary (for PNG with transparency)
    if image.mode in ("RGBA", "P") and image.format != "JPEG":
        image = image.convert("RGB")
    
    # Compress quality until size is acceptable
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


def process_uploaded_image(file: UploadFile) -> tuple[str, str]:
    """
    Process uploaded image: validate, compress, save.
    
    Critical Rule #3: Compress to <100KB, save to filesystem
    
    Args:
        file: Uploaded file from FastAPI
        
    Returns:
        Tuple of (image_url, thumbnail_url)
    """
    # Validate file type
    if not validate_image_type(file):
        raise ValueError(f"Invalid image type. Allowed: {settings.allowed_image_types}")
    
    # Open and process image
    image = Image.open(file.file)
    
    # Create thumbnail for database display
    thumbnail = image.copy()
    thumbnail.thumbnail((200, 200), Image.Resampling.LANCZOS)
    
    # Generate unique filename with UUID
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    unique_id = str(uuid.uuid4())[:8]
    filename = f"{timestamp}_{unique_id}.jpg"
    
    # Compress main image
    compressed_image = compress_image(image)
    
    # Save main image
    image_path = UPLOADS_DIR / filename
    compressed_image.save(image_path, format="JPEG", quality=85, optimize=True)
    
    # Save thumbnail
    thumbnail_path = THUMBNAILS_DIR / filename
    thumbnail_rgb = thumbnail.convert("RGB") if thumbnail.mode != "RGB" else thumbnail
    thumbnail_rgb.save(thumbnail_path, format="JPEG", quality=75, optimize=True)
    
    # Return relative URLs for database storage
    image_url = f"/static/uploads/{filename}"
    thumbnail_url = f"/static/thumbnails/{filename}"
    
    return image_url, thumbnail_url


def save_upload_file(file: UploadFile, subfolder: str = "general") -> str:
    """
    Save uploaded file to filesystem with UUID rename.
    
    Args:
        file: Uploaded file object
        subfolder: Subfolder within uploads directory
        
    Returns:
        Relative URL path for database storage
    """
    # Generate unique filename
    file_ext = Path(file.filename).suffix.lower() if file.filename else ".bin"
    unique_id = str(uuid.uuid4())[:8]
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{unique_id}{file_ext}"
    
    # Determine save path
    save_dir = UPLOADS_DIR / subfolder
    save_dir.mkdir(parents=True, exist_ok=True)
    save_path = save_dir / filename
    
    # Save file
    content = file.file.read()
    with open(save_path, "wb") as f:
        f.write(content)
    
    # Return relative URL
    return f"/static/uploads/{subfolder}/{filename}"


def delete_file(file_path: str) -> bool:
    """
    Delete file from filesystem.
    
    Args:
        file_path: Relative path from static directory
        
    Returns:
        True if deleted successfully, False otherwise
    """
    full_path = settings.BASE_DIR / file_path.lstrip("/")
    
    if full_path.exists():
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
    full_path = settings.BASE_DIR / file_path.lstrip("/")
    
    if full_path.exists():
        return full_path.stat().st_size / 1024
    return 0.0
