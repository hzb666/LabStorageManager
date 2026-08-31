import unittest
from unittest.mock import Mock, patch

from app.api import chem as chem_api
from app.models.compound_structure import CompoundStructureSource
from app.services.structure_index import StructureIndexSnapshot, StructureSearchHit
from app.services.structure_search_cache import (
    _cache_entries,
    _cache_lock,
    get_structure_search_cache_entry,
    put_structure_search_results,
)


class StructureSearchCacheTest(unittest.TestCase):
    def setUp(self) -> None:
        with _cache_lock:
            _cache_entries.clear()

    def tearDown(self) -> None:
        with _cache_lock:
            _cache_entries.clear()

    def test_search_snapshot_remains_available_after_index_changes(self) -> None:
        entry = put_structure_search_results(
            [
                StructureSearchHit(
                    cas_number="58-08-2",
                    smiles_canonical="CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
                    inchikey="RYYVLZVUVIJVGH-UHFFFAOYSA-N",
                    source=CompoundStructureSource.PUBCHEM,
                    similarity=1.0,
                    matched_atom_ratio=1.0,
                    atom_count_delta=0,
                )
            ],
            ttl_seconds=60,
        )

        db = Mock()
        snapshot = StructureIndexSnapshot(
            version=2,
            dirty=False,
            molecule_count=1,
            db_revision=2,
            applied_revision=2,
        )
        with patch.object(
            chem_api.structure_index,
            "rebuild",
            return_value=snapshot,
        ) as rebuild_mock:
            response = chem_api.rebuild_structure_index(db)

        cached = get_structure_search_cache_entry(entry.search_id)

        rebuild_mock.assert_called_once_with(db)
        self.assertEqual(snapshot.version, response.version)
        self.assertIsNotNone(cached)
        assert cached is not None
        self.assertEqual(("58-08-2",), cached.cas_numbers)
        self.assertFalse(hasattr(cached, "index_version"))


if __name__ == "__main__":
    unittest.main()
