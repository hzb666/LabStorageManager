from collections.abc import Iterator

import pytest
from sqlmodel import SQLModel, Session, create_engine

import app.models  # noqa: F401
from app.models.compound_structure import (
    CompoundStructureSource,
    CompoundStructureStatus,
)
from app.models.inventory import Inventory
from app.services.structure_cache_repo import (
    StructureCacheWrite,
    count_structure_cache_by_status,
    get_distinct_inventory_cas_numbers,
    get_structure_cache,
    upsert_structure_cache,
)


@pytest.fixture()
def db_session() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_get_distinct_inventory_cas_numbers_normalizes_and_skips_special(
    db_session: Session,
) -> None:
    db_session.add(
        Inventory(
            internal_code="58082-260420-001",
            cas_number="58－08–2",
            name="Caffeine",
            category=None,
            brand=None,
            storage_location=None,
        )
    )
    db_session.add(
        Inventory(
            internal_code="bio-260420-001",
            cas_number="生物试剂",
            name="Biological reagent",
            category=None,
            brand=None,
            storage_location=None,
        )
    )
    db_session.commit()

    assert get_distinct_inventory_cas_numbers(db_session) == ["58-08-2"]


def test_upsert_structure_cache_protects_manual_record(db_session: Session) -> None:
    manual = upsert_structure_cache(
        db_session,
        StructureCacheWrite(
            cas_number="58-08-2",
            status=CompoundStructureStatus.RESOLVED,
            source=CompoundStructureSource.MANUAL,
            smiles_canonical="CN",
            manually_verified=True,
        ),
    )
    db_session.commit()

    skipped = upsert_structure_cache(
        db_session,
        StructureCacheWrite(
            cas_number="58-08-2",
            status=CompoundStructureStatus.ERROR,
            error_message="network failed",
        ),
    )
    db_session.commit()

    assert skipped.cas_number == manual.cas_number
    cached = get_structure_cache(db_session, "58-08-2")
    assert cached is not None
    assert cached.status == CompoundStructureStatus.RESOLVED
    assert cached.source == CompoundStructureSource.MANUAL
    assert cached.manually_verified is True


def test_count_structure_cache_by_status_includes_zero_counts(db_session: Session) -> None:
    upsert_structure_cache(
        db_session,
        StructureCacheWrite(
            cas_number="58-08-2",
            status=CompoundStructureStatus.RESOLVED,
            source=CompoundStructureSource.PUBCHEM,
        ),
    )
    db_session.commit()

    counts = {row.status: row.count for row in count_structure_cache_by_status(db_session)}

    assert counts[CompoundStructureStatus.RESOLVED] == 1
    assert counts[CompoundStructureStatus.AMBIGUOUS] == 0
