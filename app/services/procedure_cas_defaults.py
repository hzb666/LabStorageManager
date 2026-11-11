"""Preferred registry numbers for confirmed common inorganic compound identities."""
from __future__ import annotations

# PubChem compound records: https://pubchem.ncbi.nlm.nih.gov/compound/<CID>
# Hydrates and isotopically labelled compounds have separate identities.
INORGANIC_CAS_BY_CID = {
    5234: "7647-14-5",       # Sodium chloride
    24436: "7757-82-6",      # Sodium sulfate, anhydrous
    24083: "7487-88-9",      # Magnesium sulfate, anhydrous
    25517: "12125-02-9",     # Ammonium chloride
    516892: "144-55-8",      # Sodium bicarbonate
    10340: "497-19-8",       # Sodium carbonate, anhydrous
    11430: "584-08-7",       # Potassium carbonate, anhydrous
    24477: "7772-98-7",      # Sodium thiosulfate, anhydrous
    5284359: "10043-52-4",   # Calcium chloride, anhydrous
}
_DEFAULT_CAS = frozenset(INORGANIC_CAS_BY_CID.values())


def prioritize_default_cas(cas_numbers: list[str], *, cid: int | None = None) -> list[str]:
    """Prefer a confirmed identity, retaining alternate numbers for inventory matching."""
    result = list(dict.fromkeys(cas_numbers))
    if cid is not None:
        preferred = INORGANIC_CAS_BY_CID.get(cid)
    else:
        # Local exact-name matches have no CID. Only prefer a default already present.
        matches = [cas for cas in result if cas in _DEFAULT_CAS]
        preferred = matches[0] if len(matches) == 1 else None
    if preferred:
        return [preferred, *(cas for cas in result if cas != preferred)]
    return result
