from app.api import search_completions
from app.models.user import User, UserRole


def test_inline_completion_returns_empty_for_ascii_space_query(monkeypatch) -> None:
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("segmented query should not request inline completion")

    monkeypatch.setattr(search_completions, "rebuild_completion_entity_index_if_stale", fail_if_called)
    monkeypatch.setattr(search_completions, "get_inline_completion", fail_if_called)

    response = search_completions.get_inline_completion_endpoint(
        endpoint="/inventory/",
        q="三氟 磺酸钠",
        db=object(),
        field="all",
        current_user=User(
            id=1,
            username="user1",
            full_name="User One",
            role=UserRole.USER,
            password_hash="hash",
        ),
    )

    assert response.completion is None
    assert response.suffix is None
    assert response.confidence == 0.0
