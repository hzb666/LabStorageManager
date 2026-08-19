"""Shared RDKit SMILES parsing helpers."""
from __future__ import annotations

import logging

from rdkit import Chem
from rdkit.Chem import rdmolops

logger = logging.getLogger(__name__)


def mol_from_smiles_quiet_h_removal(smiles: str | None):
    """Parse SMILES with RDKit default H removal semantics but no H-removal warnings."""
    if not smiles:
        return None

    try:
        parser_params = Chem.SmilesParserParams()
        parser_params.removeHs = False
        mol = Chem.MolFromSmiles(smiles, parser_params)
        if mol is None:
            return None

        remove_params = rdmolops.RemoveHsParameters()
        remove_params.showWarnings = False
        return rdmolops.RemoveHs(mol, remove_params)
    except Exception as exc:  # noqa: BLE001 - RDKit failures return an unsupported result.
        logger.warning("RDKit SMILES parsing failed: %s", type(exc).__name__)
        return None
