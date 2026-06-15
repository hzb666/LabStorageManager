import unittest

from rdkit import Chem

from app.services.structure_index import (
    _get_substructure_matches,
    _is_exact_r_group_match,
    _parse_simple_r_exact_query,
)


class StructureIndexExactRGroupTest(unittest.TestCase):
    def test_exact_r_group_search_treats_dummy_atom_as_wildcard(self) -> None:
        query_mol, r_atom_indices = _parse_simple_r_exact_query(
            query="Nc1ccc([#0])cc1",
        )
        target_mol = Chem.MolFromSmiles("Nc1ccc(C)cc1")

        assert target_mol is not None
        matches = _get_substructure_matches(target_mol, query_mol, use_chirality=False)

        self.assertTrue(
            any(
                _is_exact_r_group_match(
                    target_mol,
                    query_mol,
                    match,
                    r_atom_indices,
                )
                for match in matches
            )
        )

    def test_exact_r_group_search_requires_substituent(self) -> None:
        query_mol, _ = _parse_simple_r_exact_query(query="Nc1ccc([#0])cc1")
        target_mol = Chem.MolFromSmiles("Nc1ccccc1")

        assert target_mol is not None
        matches = _get_substructure_matches(target_mol, query_mol, use_chirality=False)

        self.assertEqual(matches, ())

    def test_exact_r_group_search_normalizes_ketcher_r_smarts(self) -> None:
        query_mol, r_atom_indices = _parse_simple_r_exact_query(
            query="[#6]1-[#6]%91=[#6]-[#6]=[#6](-[#7])-[#6]=1.[*:1]-%91",
        )
        target_mol = Chem.MolFromSmiles("Nc1ccc(C)cc1")

        assert target_mol is not None
        matches = _get_substructure_matches(target_mol, query_mol, use_chirality=False)

        self.assertTrue(
            any(
                _is_exact_r_group_match(
                    target_mol,
                    query_mol,
                    match,
                    r_atom_indices,
                )
                for match in matches
            )
        )

    def test_exact_r_group_search_rejects_extra_fixed_substitution(self) -> None:
        query_mol, r_atom_indices = _parse_simple_r_exact_query(
            query="[#6]1-[#6]%91=[#6]-[#6]=[#6](-[#7])-[#6]=1.[*:1]-%91",
        )
        target_mol = Chem.MolFromSmiles("CC(=O)Nc1ccc(C)cc1")

        assert target_mol is not None
        matches = _get_substructure_matches(target_mol, query_mol, use_chirality=False)

        self.assertFalse(
            any(
                _is_exact_r_group_match(
                    target_mol,
                    query_mol,
                    match,
                    r_atom_indices,
                )
                for match in matches
            )
        )


if __name__ == "__main__":
    unittest.main()
