from sqlalchemy.dialects import sqlite

from app.models.chemical_name_map import ChemicalNameMap
from app.models.inventory import Inventory
from app.services.search_matchers import build_applicant_id_subquery, build_text_search_clause


def _compile_clause(clause):
    return clause.compile(
        dialect=sqlite.dialect(),
        compile_kwargs={"render_postcompile": True},
    )


def _compiled_param_values(compiled) -> set[str]:
    return {
        value
        for value in compiled.params.values()
        if isinstance(value, str)
    }


def test_pinyin_field_uses_python_lowercase_like_without_sql_normalization() -> None:
    compiled = _compile_clause(
        build_text_search_clause(Inventory.name_pinyin_initials, "HX", fuzzy=False)
    )
    sql = str(compiled).lower()

    assert "name_pinyin_initials" in sql
    assert " like " in sql
    assert "lower(" not in sql
    assert "coalesce" not in sql
    assert "%hx%" in _compiled_param_values(compiled)


def test_initials_field_normalizes_fuzzy_term_in_python() -> None:
    compiled = _compile_clause(
        build_text_search_clause(ChemicalNameMap.alias_1_initials, "A-B C", fuzzy=True)
    )
    sql = str(compiled).lower()

    assert "alias_1_initials" in sql
    assert "lower(" not in sql
    assert "coalesce" not in sql
    assert "%abc%" in _compiled_param_values(compiled)


def test_regular_text_field_keeps_sql_normalization() -> None:
    compiled = _compile_clause(build_text_search_clause(Inventory.name, "HX", fuzzy=False))
    sql = str(compiled).lower()

    assert "name_pinyin" not in sql
    assert "lower(" in sql
    assert "coalesce" in sql
    assert "%HX%" in _compiled_param_values(compiled)


def test_applicant_exact_pinyin_match_uses_direct_lowercase_equality() -> None:
    compiled = _compile_clause(build_applicant_id_subquery("HX", fuzzy=False))
    sql = str(compiled).lower()

    assert "users.full_name_pinyin =" in sql
    assert "users.full_name_pinyin_initials =" in sql
    assert "coalesce(users.full_name_pinyin" not in sql
    assert "coalesce(users.full_name_pinyin_initials" not in sql
    assert "hx" in _compiled_param_values(compiled)
