import unittest

from rdkit import Chem

from app.services.rdkit_smiles import mol_from_smiles_quiet_h_removal


class RdkitSmilesTest(unittest.TestCase):
    def test_quiet_h_removal_keeps_default_canonical_smiles(self) -> None:
        cases = {
            "F[B-](F)(F)F.[H+]": "F[B-](F)(F)F.[H+]",
            "[H-].[Na+]": "[H-].[Na+]",
            (
                "[Cl-].[H-].[H]c1c([H])c([H])[c-]([H])c1[H]."
                "[H]c1c([H])c([H])[c-]([H])c1[H].[Zr+4]"
            ): "[Cl-].[H-].[Zr+4].c1cc[cH-]c1.c1cc[cH-]c1",
        }

        for smiles, expected in cases.items():
            with self.subTest(smiles=smiles):
                mol = mol_from_smiles_quiet_h_removal(smiles)

                self.assertIsNotNone(mol)
                self.assertEqual(expected, Chem.MolToSmiles(mol))


if __name__ == "__main__":
    unittest.main()
