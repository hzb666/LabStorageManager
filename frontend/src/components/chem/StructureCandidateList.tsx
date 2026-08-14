import { CheckCircle2 } from 'lucide-react'

import type { PubChemCandidate } from '@/api/structureSearchApi'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'

const PUBCHEM_COMPOUND_URL = 'https://pubchem.ncbi.nlm.nih.gov/compound'
const PUBCHEM_IMAGE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid'
const CANDIDATE_PREVIEW_WIDTH = 180
const CANDIDATE_PREVIEW_HEIGHT = 120

function getCandidateCid(candidate: PubChemCandidate): number | null {
  return typeof candidate.cid === 'number' ? candidate.cid : null
}

function getCandidateSmiles(candidate: PubChemCandidate): string | null {
  return candidate.smiles_canonical?.trim() || candidate.smiles_isomeric?.trim() || null
}

function getPubChemImageUrl(cid: number): string {
  return `${PUBCHEM_IMAGE_URL}/${cid}/PNG?image_size=large`
}

function CandidatePreview({ candidate }: Readonly<{ candidate: PubChemCandidate }>) {
  const cid = getCandidateCid(candidate)
  const smiles = getCandidateSmiles(candidate)
  if (smiles) {
    return (
      <MoleculeStructure
        casNumber={cid ? `CID:${cid}` : smiles}
        smiles={smiles}
        width={CANDIDATE_PREVIEW_WIDTH}
        height={CANDIDATE_PREVIEW_HEIGHT}
      />
    )
  }
  if (!cid) return null
  return (
    <div
      className="flex items-center justify-center rounded-md bg-white dark:bg-[#121212]"
      style={{ width: CANDIDATE_PREVIEW_WIDTH, height: CANDIDATE_PREVIEW_HEIGHT }}
    >
      <img
        src={getPubChemImageUrl(cid)}
        alt={`PubChem CID ${cid} 结构`}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="max-h-full max-w-full object-contain dark:[filter:invert(0.93)_hue-rotate(180deg)]"
      />
    </div>
  )
}

function CandidateBadges({ candidate }: Readonly<{ candidate: PubChemCandidate }>) {
  return (
    <div className="flex flex-wrap gap-1 text-xs">
      {candidate.has_exact_cas_synonym && (
        <span className="rounded border border-green-300 bg-green-100 px-1.5 py-0.5 text-green-800">
          CAS 匹配
        </span>
      )}
      {candidate.matched_by_substance_name && (
        <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-amber-800">
          Substance 映射
        </span>
      )}
      {candidate.sid_count ? (
        <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-slate-700">
          SID {candidate.sid_count}
        </span>
      ) : null}
    </div>
  )
}

function CandidateMeta({ candidate }: Readonly<{ candidate: PubChemCandidate }>) {
  const cid = getCandidateCid(candidate)
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {cid ? (
          <a
            href={`${PUBCHEM_COMPOUND_URL}/${cid}`}
            target="_blank"
            rel="noreferrer"
            className="font-normal text-primary hover:underline"
          >
            CID {cid}
          </a>
        ) : (
          <span className="font-normal">未知 CID</span>
        )}
        {candidate.molecular_formula && (
          <span className="text-muted-foreground">{candidate.molecular_formula}</span>
        )}
      </div>
      {candidate.iupac_name && (
        <div className="line-clamp-2 text-muted-foreground">{candidate.iupac_name}</div>
      )}
      {candidate.inchikey && (
        <div className="truncate font-mono text-xs text-muted-foreground">
          {candidate.inchikey}
        </div>
      )}
      <CandidateBadges candidate={candidate} />
    </div>
  )
}

function StructureCandidateCard({
  candidate,
  disabled,
  onConfirm,
}: Readonly<{
  candidate: PubChemCandidate
  disabled: boolean
  onConfirm: (cid: number) => void
}>) {
  const cid = getCandidateCid(candidate)
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2">
      <CandidatePreview candidate={candidate} />
      <CandidateMeta candidate={candidate} />
      {cid && (
        <LoadingButton
          type="button"
          variant="modern"
          size="sm"
          isLoading={disabled}
          loadingText="确认中..."
          onClick={() => onConfirm(cid)}
        >
          <CheckCircle2 className="size-4" />
          确认 CID {cid}
        </LoadingButton>
      )}
    </div>
  )
}

export function StructureCandidateList({
  candidates,
  disabled,
  onConfirm,
}: Readonly<{
  candidates: PubChemCandidate[]
  disabled: boolean
  onConfirm: (cid: number) => void
}>) {
  const visibleCandidates = candidates.filter((candidate) => getCandidateCid(candidate) !== null)
  if (visibleCandidates.length === 0) return null
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {visibleCandidates.map((candidate) => (
        <StructureCandidateCard
          key={candidate.cid}
          candidate={candidate}
          disabled={disabled}
          onConfirm={onConfirm}
        />
      ))}
    </div>
  )
}

export default StructureCandidateList
