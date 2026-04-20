"""RDKit-based structure normalization helpers."""
from __future__ import annotations

from dataclasses import dataclass

from rdkit import Chem
from rdkit.Chem import rdDepictor

try:
    from rdkit.Chem import inchi
except Exception:  # pragma: no cover
    inchi = None

from app.models.compound_structure import CompoundStructureStatus


@dataclass(frozen=True)
class NormalizedStructure:
    """Normalized molecule fields derived from RDKit."""

    status: CompoundStructureStatus
    smiles_canonical: str | None = None
    smiles_isomeric: str | None = None
    molblock: str | None = None
    inchikey: str | None = None
    error_message: str | None = None


def _first_sdf_record(sdf: str | None) -> str | None:
    if not sdf:
        return None
    return sdf.split("$$$$", 1)[0].strip() or None


def _mol_from_molblock(molblock: str | None):
    if not molblock:
        return None
    try:
        return Chem.MolFromMolBlock(molblock, sanitize=True, removeHs=False)
    except Exception:
        return None


def _mol_from_smiles(smiles: str | None):
    if not smiles:
        return None
    try:
        return Chem.MolFromSmiles(smiles)
    except Exception:
        return None


def _calculate_inchikey(mol, fallback_inchikey: str | None) -> str | None:
    if fallback_inchikey:
        return fallback_inchikey
    if inchi is None:
        return None
    calculated = inchi.MolToInchiKey(mol)
    return calculated or None


def normalize_structure_from_mol(mol, *, inchikey: str | None = None) -> NormalizedStructure:
    """Generate canonical SMILES, isomeric SMILES, MolBlock, and InChIKey."""
    if mol is None:
        return NormalizedStructure(
            status=CompoundStructureStatus.UNSUPPORTED,
            error_message="RDKit could not parse structure",
        )

    try:
        smiles_isomeric = Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)
        smiles_canonical = Chem.MolToSmiles(mol, canonical=True, isomericSmiles=False)

        mol_for_block = Chem.Mol(mol)
        rdDepictor.Compute2DCoords(mol_for_block)
        molblock = Chem.MolToMolBlock(mol_for_block)

        return NormalizedStructure(
            status=CompoundStructureStatus.RESOLVED,
            smiles_canonical=smiles_canonical,
            smiles_isomeric=smiles_isomeric,
            molblock=molblock,
            inchikey=_calculate_inchikey(mol, inchikey),
        )
    except Exception as exc:
        return NormalizedStructure(
            status=CompoundStructureStatus.UNSUPPORTED,
            error_message=str(exc),
        )


def normalize_structure_from_pubchem(
    *,
    canonical_smiles: str | None,
    isomeric_smiles: str | None,
    inchikey: str | None,
    sdf: str | None,
) -> NormalizedStructure:
    """Normalize PubChem SDF/SMILES payloads into cacheable molecule fields."""
    mol = _mol_from_molblock(_first_sdf_record(sdf))
    if mol is None:
        mol = _mol_from_smiles(isomeric_smiles)
    if mol is None:
        mol = _mol_from_smiles(canonical_smiles)
    return normalize_structure_from_mol(mol, inchikey=inchikey)


def normalize_structure_from_molblock(
    molblock: str,
    *,
    inchikey: str | None = None,
) -> NormalizedStructure:
    """Normalize a manually supplied MolBlock."""
    return normalize_structure_from_mol(_mol_from_molblock(molblock), inchikey=inchikey)


def normalize_structure_from_smiles(
    smiles: str,
    *,
    inchikey: str | None = None,
) -> NormalizedStructure:
    """Normalize a manually supplied SMILES string."""
    return normalize_structure_from_mol(_mol_from_smiles(smiles), inchikey=inchikey)
