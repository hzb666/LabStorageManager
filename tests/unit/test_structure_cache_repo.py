import unittest

from sqlmodel import Session, SQLModel, create_engine

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


class StructureCacheRepoTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_get_distinct_inventory_cas_numbers_normalizes_and_skips_special(self) -> None:
        self.db.add(
            Inventory(
                internal_code="58082-260420-001",
                cas_number="58－08–2",
                name="Caffeine",
                category=None,
                brand=None,
                storage_location=None,
            )
        )
        self.db.add(
            Inventory(
                internal_code="bio-260420-001",
                cas_number="生物试剂",
                name="Biological reagent",
                category=None,
                brand=None,
                storage_location=None,
            )
        )
        self.db.commit()

        self.assertEqual(
            ["58-08-2"],
            get_distinct_inventory_cas_numbers(self.db),
        )

    def test_upsert_structure_cache_protects_manual_record(self) -> None:
        manual = upsert_structure_cache(
            self.db,
            StructureCacheWrite(
                cas_number="58-08-2",
                status=CompoundStructureStatus.RESOLVED,
                source=CompoundStructureSource.MANUAL,
                smiles_canonical="CN",
                manually_verified=True,
            ),
        )
        self.db.commit()

        skipped = upsert_structure_cache(
            self.db,
            StructureCacheWrite(
                cas_number="58-08-2",
                status=CompoundStructureStatus.ERROR,
                error_message="network failed",
            ),
        )
        self.db.commit()

        self.assertEqual(manual.cas_number, skipped.cas_number)
        cached = get_structure_cache(self.db, "58-08-2")
        self.assertIsNotNone(cached)
        assert cached is not None
        self.assertEqual(CompoundStructureStatus.RESOLVED, cached.status)
        self.assertEqual(CompoundStructureSource.MANUAL, cached.source)
        self.assertTrue(cached.manually_verified)

    def test_count_structure_cache_by_status_includes_zero_counts(self) -> None:
        upsert_structure_cache(
            self.db,
            StructureCacheWrite(
                cas_number="58-08-2",
                status=CompoundStructureStatus.RESOLVED,
                source=CompoundStructureSource.PUBCHEM,
            ),
        )
        self.db.commit()

        counts = {
            row.status: row.count
            for row in count_structure_cache_by_status(self.db)
        }

        self.assertEqual(1, counts[CompoundStructureStatus.RESOLVED])
        self.assertEqual(0, counts[CompoundStructureStatus.AMBIGUOUS])


if __name__ == "__main__":
    unittest.main()
