from sqlalchemy.dialects import sqlite
from sqlalchemy import create_engine, literal
from sqlmodel import select

from app.models.chemical_name_map import ChemicalNameMap
from app.models.inventory import Inventory
from app.services.search_matchers import (
    TextMatchMode,
    build_applicant_id_subquery,
    build_chunked_in_clause,
    build_segmented_search_log_meta,
    build_text_same_field_segmented_clause,
    build_text_search_clause,
    split_exact_cas_search_terms,
    split_segmented_search_terms,
)


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


def test_split_segmented_search_terms_uses_ascii_space_only() -> None:
    assert split_segmented_search_terms(
        "三氟 磺酸钠",
        match_mode=TextMatchMode.CONTAINS,
    ) == ["三氟", "磺酸钠"]
    assert split_segmented_search_terms(
        "  三氟   磺酸钠  ",
        match_mode=TextMatchMode.CONTAINS,
    ) == ["三氟", "磺酸钠"]
    assert split_segmented_search_terms("三氟", match_mode=TextMatchMode.CONTAINS) == []
    assert split_segmented_search_terms(
        "64-17-5&&67-56-1",
        match_mode=TextMatchMode.CONTAINS,
    ) == []
    assert split_segmented_search_terms(
        "三氟 磺酸钠",
        match_mode=TextMatchMode.EXACT,
    ) == []
    assert split_segmented_search_terms(
        "三氟\u00a0磺酸钠",
        match_mode=TextMatchMode.CONTAINS,
    ) == []


def test_same_field_segmented_clause_ands_terms_inside_each_field_group() -> None:
    clause = build_text_same_field_segmented_clause(
        [
            [Inventory.name, Inventory.name_pinyin, Inventory.name_pinyin_initials],
            [Inventory.brand, Inventory.brand_pinyin, Inventory.brand_pinyin_initials],
        ],
        ["三氟", "磺酸钠"],
        fuzzy=False,
    )

    compiled = _compile_clause(clause)
    sql = str(compiled).lower()
    params = _compiled_param_values(compiled)

    assert " and " in sql
    assert " or " in sql
    assert sql.count("inventory.name") >= 2
    assert sql.count("inventory.brand") >= 2
    assert "%三氟%" in params
    assert "%磺酸钠%" in params


def test_same_field_segmented_clause_does_not_match_across_field_groups() -> None:
    clause = build_text_same_field_segmented_clause(
        [[literal("三氟乙酸钠")], [literal("磺酸钠")]],
        ["三氟", "磺酸钠"],
        fuzzy=False,
    )

    engine = create_engine("sqlite://")
    with engine.connect() as connection:
        result = connection.execute(select(literal(1)).where(clause)).scalar_one_or_none()

    assert result is None


def test_same_field_segmented_clause_matches_when_one_field_has_all_terms() -> None:
    clause = build_text_same_field_segmented_clause(
        [[literal("三氟甲烷亚磺酸钠")], [literal("三氟乙酸钠")]],
        ["三氟", "磺酸钠"],
        fuzzy=False,
    )

    engine = create_engine("sqlite://")
    with engine.connect() as connection:
        result = connection.execute(select(literal(1)).where(clause)).scalar_one()

    assert result == 1


def test_fuzzy_segmented_clause_normalizes_each_term_independently() -> None:
    clause = build_text_same_field_segmented_clause(
        [[Inventory.name]],
        ["N-boc", "胺"],
        fuzzy=True,
    )

    compiled = _compile_clause(clause)
    params = _compiled_param_values(compiled)

    assert "%Nboc%" in params
    assert "%胺%" in params
    assert "%Nboc胺%" not in params

    runtime_clause = build_text_same_field_segmented_clause(
        [[literal("N-boc 胺")]],
        ["Nboc", "胺"],
        fuzzy=True,
    )
    engine = create_engine("sqlite://")
    with engine.connect() as connection:
        result = connection.execute(select(literal(1)).where(runtime_clause)).scalar_one()

    assert result == 1


def test_multi_cas_search_terms_stay_independent_of_segmented_search() -> None:
    search = "64 - 17 - 5 && 67 - 56 - 1"
    terms = split_exact_cas_search_terms(search)

    assert terms == ["64-17-5", "67-56-1"]
    assert split_segmented_search_terms(search, match_mode=TextMatchMode.CONTAINS) == []

    compiled = _compile_clause(build_chunked_in_clause(Inventory.cas_number, terms))
    sql = str(compiled).lower()

    assert " in " in sql


def test_build_segmented_search_log_meta_records_terms_without_normalizing() -> None:
    meta = build_segmented_search_log_meta(["N-boc", "胺"], enabled=True)

    assert meta == {
        "search_operator": "segmented_and",
        "search_terms": ["N-boc", "胺"],
        "search_terms_count": 2,
        "search_splitter": "ascii_space",
        "same_field": True,
    }
