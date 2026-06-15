from __future__ import annotations

import io
from pathlib import Path, PurePosixPath

import pytest
from fastapi import HTTPException
from PIL import Image

from app.services import image_service


class FakeUploadFile:
    def __init__(self, content: bytes, *, content_type: str, filename: str) -> None:
        self.file = io.BytesIO(content)
        self.content_type = content_type
        self.filename = filename


def test_read_upload_bytes_limited_rejects_oversized_stream() -> None:
    upload = FakeUploadFile(b"x" * 2048, content_type="image/png", filename="big.png")

    with pytest.raises(HTTPException) as exc_info:
        image_service.read_upload_bytes_limited(upload, max_size_mb=0.001)

    assert exc_info.value.status_code == 400
    assert "Image size exceeds" in str(exc_info.value.detail)
    assert upload.file.tell() == 0


def test_validate_image_rejects_content_type_header_mismatch() -> None:
    jpeg_content = _image_bytes("JPEG")
    upload = FakeUploadFile(jpeg_content, content_type="image/png", filename="fake.png")

    is_valid, content = image_service.validate_image_type_and_get_bytes(
        upload,
        max_size_mb=1,
    )

    assert is_valid is False
    assert content == jpeg_content


def test_announcement_upload_reencodes_to_jpeg(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(image_service, "BASE_DIR", tmp_path)
    upload = FakeUploadFile(_image_bytes("PNG"), content_type="image/png", filename="notice.png")

    url = image_service.save_announcement_image(upload)

    relative_path = PurePosixPath(url.lstrip("/"))
    saved_path = tmp_path.joinpath(*relative_path.parts)
    assert url.endswith(".jpg")
    assert saved_path.read_bytes().startswith(b"\xff\xd8\xff")


def _image_bytes(image_format: str) -> bytes:
    mode = "RGB" if image_format == "JPEG" else "RGBA"
    color = (255, 0, 0) if mode == "RGB" else (255, 0, 0, 128)
    image = Image.new(mode, (4, 4), color)
    output = io.BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()
