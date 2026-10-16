import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv } from './lib/csv'
import { clean, normName } from './lib/text'

// Reviewed lists the owner returns at I08. Names only: no phone numbers, e-mail addresses or amounts.
//   company_merge.csv        old_name,company,site
//   vendor_parse.csv         old_name,company,brand,country
//   expense_categories.csv   legacy_category,category
//   users.csv                old_name,new_name,owner_reliable
//   po_clashes.csv           customer_po_number,decision            (merge | po_shared)

export interface CompanyTarget {
  company: string
  site: string | null
}
export interface VendorTarget {
  company: string
  brand: string | null
  country: string | null
}
export interface UserTarget {
  /** The person's name in the new project; null means "left the company" (records are unattributed). */
  newName: string | null
  ownerReliable: boolean
}
export type PoDecision = 'merge' | 'po_shared'

export interface Mappings {
  companyMerge: Map<string, CompanyTarget>
  vendorParse: Map<string, VendorTarget>
  expenseCategories: Map<string, string>
  users: Map<string, UserTarget>
  poDecisions: Map<string, PoDecision>
}

/** Owner decision (DECISIONS.md, 2026-10-13): legacy PO 000001 Unit A and Unit B are one order with two invoices. */
export const BUILT_IN_PO_DECISIONS: [string, PoDecision][] = [['000001', 'merge']]

export function normPo(v: unknown): string {
  return (clean(v) ?? '').toUpperCase()
}

export function emptyMappings(): Mappings {
  return {
    companyMerge: new Map(),
    vendorParse: new Map(),
    expenseCategories: new Map(),
    users: new Map(),
    poDecisions: new Map(BUILT_IN_PO_DECISIONS),
  }
}

export interface MappingTexts {
  companyMerge?: string
  vendorParse?: string
  expenseCategories?: string
  users?: string
  poClashes?: string
}

export function parseMappings(t: MappingTexts): Mappings {
  const m = emptyMappings()

  for (const r of parseCsv(t.companyMerge ?? '')) {
    const key = normName(r['old_name'])
    const company = clean(r['company'])
    if (key && company) m.companyMerge.set(key, { company, site: clean(r['site']) })
  }
  for (const r of parseCsv(t.vendorParse ?? '')) {
    const key = normName(r['old_name'])
    const company = clean(r['company'])
    if (key && company) m.vendorParse.set(key, { company, brand: clean(r['brand']), country: clean(r['country']) })
  }
  for (const r of parseCsv(t.expenseCategories ?? '')) {
    const key = normName(r['legacy_category'])
    const category = clean(r['category'])
    if (key && category) m.expenseCategories.set(key, category)
  }
  for (const r of parseCsv(t.users ?? '')) {
    const key = normName(r['old_name'])
    if (!key) continue
    const reliable = (clean(r['owner_reliable']) ?? 'yes').toLowerCase()
    m.users.set(key, { newName: clean(r['new_name']), ownerReliable: !['no', 'false', '0', 'n'].includes(reliable) })
  }
  for (const r of parseCsv(t.poClashes ?? '')) {
    const po = normPo(r['customer_po_number'])
    const d = (clean(r['decision']) ?? '').toLowerCase()
    if (po && (d === 'merge' || d === 'po_shared')) m.poDecisions.set(po, d)
  }
  return m
}

function read(dir: string, file: string): string | undefined {
  const p = join(dir, file)
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined
}

/** Reads the reviewed lists from a folder. A missing file is an empty list (every name then imports as it is). */
export function loadMappings(dir: string): Mappings {
  return parseMappings({
    companyMerge: read(dir, 'company_merge.csv'),
    vendorParse: read(dir, 'vendor_parse.csv'),
    expenseCategories: read(dir, 'expense_categories.csv'),
    users: read(dir, 'users.csv'),
    poClashes: read(dir, 'po_clashes.csv'),
  })
}
