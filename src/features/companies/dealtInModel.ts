// "Categories they deal in" on a supplier's page (C4): one row per product category the supplier has any history in or is tagged
// for, each with its evidence in words ("quoted 6 · ordered 2"). Pure: the panel draws it.
import type { CarriedBrand, SupplierCategoryEvidence } from '@/features/companies/api'

export interface DealtRow {
  familyId: string
  name: string
  /** "quoted 6 · ordered 2", "asked 3, no quote yet", or "no history yet" for a tag with nothing behind it. */
  evidence: string
  /** Carried as a tag (company_brands): set by hand here, or learned from a quote. */
  tagged: boolean
  quoted: number
  ordered: number
}

export function evidenceText(e: Pick<SupplierCategoryEvidence, 'asked' | 'quoted' | 'ordered'> | undefined): string {
  const parts: string[] = []
  if (e && e.quoted > 0) parts.push(`quoted ${e.quoted}`)
  if (e && e.ordered > 0) parts.push(`ordered ${e.ordered}`)
  if (parts.length > 0) return parts.join(' · ')
  if (e && e.asked > 0) return `asked ${e.asked}, no quote yet`
  return 'no history yet'
}

/** The rows: what they have quoted or been ordered from first (most orders, then most quotes), then asked-only, then tags alone. */
export function dealtRows(evidence: readonly SupplierCategoryEvidence[], carried: readonly CarriedBrand[]): DealtRow[] {
  const tags = new Map(carried.filter(b => b.kind === 'family').map(b => [b.brandId, b.name]))
  const byId = new Map(evidence.map(e => [e.familyId, e]))
  const ids = new Set([...byId.keys(), ...tags.keys()])
  const rows = [...ids].map<DealtRow>(id => {
    const e = byId.get(id)
    return { familyId: id, name: e?.name ?? tags.get(id) ?? 'A category', evidence: evidenceText(e), tagged: tags.has(id), quoted: e?.quoted ?? 0, ordered: e?.ordered ?? 0 }
  })
  const rank = (r: DealtRow, e: SupplierCategoryEvidence | undefined) => (r.quoted > 0 || r.ordered > 0 ? 0 : (e?.asked ?? 0) > 0 ? 1 : 2)
  return rows.sort((a, b) => rank(a, byId.get(a.familyId)) - rank(b, byId.get(b.familyId)) || b.ordered - a.ordered || b.quoted - a.quoted || a.name.localeCompare(b.name))
}
