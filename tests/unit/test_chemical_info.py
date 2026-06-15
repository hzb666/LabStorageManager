from app.services import chemical_info


class _FakeResponse:
    def __init__(self, status_code: int, content: bytes) -> None:
        self.status_code = status_code
        self.content = content


def test_query_chinese_name_uses_current_chemblink_zh_routes(
    monkeypatch,
) -> None:
    calls: list[str] = []

    def fake_safe_get(url: str, timeout: float) -> _FakeResponse:
        calls.append(url)
        if "/zh/products/" in url or "/zh/moreProducts/" in url:
            return _FakeResponse(200, "<h1>乙醇<br>[CAS# 64-17-5]</h1>".encode("utf-8"))
        return _FakeResponse(301, b"")

    monkeypatch.setattr(chemical_info, "_safe_get", fake_safe_get)

    assert chemical_info.query_chinese_name("64-17-5") == "乙醇"
    assert calls == [
        "https://www.chemblink.com/zh/products/64-17-5C.htm",
        "https://www.chemblink.com/zh/moreProducts/more64-17-5C.htm",
    ]
