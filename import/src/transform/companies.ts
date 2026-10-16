import { digits, normName, str } from '../lib/text'
import type { Row } from '../lib/text'
import { legacyId } from '../lib/ids'
import type { NewRow } from '../types'
import type { Ctx } from './context'

// I02: companies, sites, contacts, brands, company_brands. Driven by the reviewed company_merge.csv and vendor_parse.csv.
// A company id comes from its normalised name (companies are matched by name), every other id from the old row id.

interface SiteDraft {
  id: string
  name: string
  address: string | null
}

interface Draft {
  id: string
  name: string
  country: string | null
  notes: string[]
  flags: Set<string>
  sources: { table: string; row: Row }[]
  sites: Map<string, SiteDraft>
  /** Old names that landed here, for the company_merges review list. */
  fromNames: Set<string>
}

interface BrandDraft {
  id: string
  name: string
  kind: 'brand' | 'family'
}

export interface CustomerRef {
  companyId: string
  siteId: string | null
}

export interface ContactInput {
  name: string | null
  phone: string | null
  email: string | null
}

/** Names that look like "X (via Y)", "X / Y" or "X (Distributor)" and so need the reviewed parse list. */
export function looksComposite(name: string): boolean {
  return /[()]|\bvia\b|\//i.test(name)
}

const LEGAL_SUFFIX = /\b(pvt|private|ltd|limited|llc|inc|co|company|corp|corporation|gmbh|plc|pte|sdn|bhd)\b\.?/g

/** A looser key used only to suggest possible duplicates to the owner (never to merge on its own). */
export function looseKey(name: string): string {
  return normName(name).replace(LEGAL_SUFFIX, '').replace(/[^a-z0-9]+/g, '')
}

export function contactInput(row: Row): ContactInput {
  return { name: str(row, 'contact_person'), phone: str(row, 'phone'), email: str(row, 'email') }
}

export class CompanyBook {
  private readonly drafts = new Map<string, Draft>()
  private readonly brands = new Map<string, BrandDraft>()
  private readonly companyBrands = new Set<string>()
  private readonly contactRows: NewRow[] = []
  private readonly contactKeys = new Map<string, string>()
  /** old client id -> where it went */
  readonly clients = new Map<string, CustomerRef>()
  /** old vendor id -> supplier company id */
  readonly vendors = new Map<string, string>()
  private readonly vendorRows: { oldId: string; oldName: string; company: string; brand: string | null; parsed: boolean; flagged: boolean }[] = []

  constructor(private readonly ctx: Ctx) {}

  // ------------------------------------------------------------------ companies and sites

  /** Get or create the company called `name` (matched by normalised name). */
  company(name: string, oldName?: string): Draft {
    const key = normName(name)
    let d = this.drafts.get(key)
    if (!d) {
      d = {
        id: legacyId('company', key),
        name: name.trim().replace(/\s+/g, ' '),
        country: null,
        notes: [],
        flags: new Set(),
        sources: [],
        sites: new Map(),
        fromNames: new Set(),
      }
      this.drafts.set(key, d)
    }
    if (oldName) d.fromNames.add(oldName)
    return d
  }

  private site(d: Draft, siteName: string, address: string | null): SiteDraft {
    const key = normName(siteName)
    let s = d.sites.get(key)
    if (!s) {
      s = { id: legacyId('site', `${normName(d.name)}|${key}`), name: siteName.trim().replace(/\s+/g, ' '), address: null }
      d.sites.set(key, s)
    }
    if (address && !s.address) s.address = address
    return s
  }

  private note(d: Draft, line: string | null): void {
    if (line && !d.notes.includes(line)) d.notes.push(line)
  }

  /** The company (and site) a customer-side name stands for, through company_merge.csv. */
  resolveCustomerName(oldName: string): { name: string; siteName: string | null; mapped: boolean } {
    const hit = this.ctx.maps.companyMerge.get(normName(oldName))
    return hit ? { name: hit.company, siteName: hit.site, mapped: true } : { name: oldName, siteName: null, mapped: false }
  }

  /** For free-text company names on RFQs and register rows: the company and site, creating the company if it is new. */
  byCustomerName(oldName: string): CustomerRef {
    const t = this.resolveCustomerName(oldName)
    const d = this.company(t.name, oldName)
    const site = t.siteName ? this.site(d, t.siteName, null) : null
    return { companyId: d.id, siteId: site?.id ?? null }
  }

  // ------------------------------------------------------------------ source tables

  addCustomer(table: 'clients' | 'prospects', row: Row): void {
    const oldId = String(row['id'])
    const oldName = str(row, 'company_name')
    if (oldName === null) {
      this.ctx.drop(table, oldId, '(no name)', 'company_name is empty')
      return
    }
    const t = this.resolveCustomerName(oldName)
    const existed = this.drafts.has(normName(t.name))
    const d = this.company(t.name, oldName)
    if (table === 'prospects' && !existed) d.flags.add('from_prospect')
    d.sources.push({ table, row })

    const address = str(row, 'address')
    const site = t.siteName ? this.site(d, t.siteName, address) : null
    if (!site) this.note(d, address ? `Address: ${address}` : null)
    this.note(d, str(row, 'industry') ? `Industry: ${str(row, 'industry')}` : null)
    this.note(d, str(row, 'lead_source') ? `Lead source: ${str(row, 'lead_source')}` : null)

    this.contact(d, site?.id ?? null, contactInput(row), `${table}:${oldId}`)
    if (table === 'clients') this.clients.set(oldId, { companyId: d.id, siteId: site?.id ?? null })
  }

  addVendor(row: Row): void {
    const oldId = String(row['id'])
    const oldName = str(row, 'name')
    if (oldName === null) {
      this.ctx.drop('vendors', oldId, '(no name)', 'name is empty')
      return
    }
    const parse = this.ctx.maps.vendorParse.get(normName(oldName))
    const companyName = parse ? parse.company : oldName
    const d = this.company(companyName, oldName)
    d.sources.push({ table: 'vendors', row })
    const flagged = !parse && looksComposite(oldName)
    if (flagged) d.flags.add('name_unparsed')

    const country = parse?.country ?? str(row, 'country')
    if (country && !d.country) d.country = country
    if (parse) this.note(d, `Vendor name in the old system: ${oldName}`)

    let brandName: string | null = null
    if (parse?.brand) {
      brandName = parse.brand
      this.link(d.id, this.brand(parse.brand, 'brand').id)
    }

    // products_supplied: where a product matches a family we already know it becomes a family tag, the rest stays as a note.
    const products = (str(row, 'products_supplied') ?? '')
      .split(/[,;]/)
      .map(p => p.trim())
      .filter(Boolean)
    const leftover: string[] = []
    for (const p of products) {
      const fam = this.brands.get(normName(p))
      if (fam) this.link(d.id, fam.id)
      else leftover.push(p)
    }
    this.note(d, leftover.length ? `Products supplied: ${leftover.join(', ')}` : null)

    this.contact(d, null, contactInput(row), `vendors:${oldId}`)
    this.vendors.set(oldId, d.id)
    this.vendorRows.push({ oldId, oldName, company: d.name, brand: brandName, parsed: !!parse, flagged })
  }

  // ------------------------------------------------------------------ contacts and brands

  contact(d: { id: string }, siteId: string | null, input: ContactInput, sourceKey: string): string | null {
    const { name, phone, email } = input
    if (name === null && phone === null && email === null) return null
    const key = `${d.id}|${normName(name)}|${digits(phone)}|${(email ?? '').toLowerCase()}`
    const found = this.contactKeys.get(key)
    if (found) return found
    const id = legacyId('contact', sourceKey)
    this.contactKeys.set(key, id)
    this.contactRows.push({ id, company_id: d.id, site_id: siteId, name: name ?? 'Main contact', phone, email })
    return id
  }

  /** A contact written straight on an RFQ (contact_person, phone, email). */
  contactForRfq(ref: CustomerRef, row: Row, oldRfqId: string): string | null {
    return this.contact({ id: ref.companyId }, ref.siteId, contactInput(row), `rfqs:${oldRfqId}`)
  }

  brand(name: string, kind: 'brand' | 'family'): BrandDraft {
    const key = normName(name)
    let b = this.brands.get(key)
    if (!b) {
      b = { id: legacyId('brand', key), name: name.trim().replace(/\s+/g, ' '), kind }
      this.brands.set(key, b)
    }
    return b
  }

  /** product_type -> a family tag (the shortlist key). */
  family(name: string | null): string | null {
    if (name === null) return null
    return this.brand(name, 'family').id
  }

  private link(companyId: string, brandId: string): void {
    this.companyBrands.add(`${companyId}|${brandId}`)
  }

  // ------------------------------------------------------------------ output

  finish(): Record<'companies' | 'company_sites' | 'contacts' | 'brands' | 'company_brands', NewRow[]> {
    const drafts = [...this.drafts.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
    const companies: NewRow[] = []
    const sites: NewRow[] = []
    for (const d of drafts) {
      companies.push({
        id: d.id,
        name: d.name,
        country: d.country,
        notes: d.notes.length ? d.notes.join('\n') : null,
        legacy_flags: [...d.flags].sort(),
        legacy_source: { rows: d.sources },
      })
      for (const s of [...d.sites.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        sites.push({ id: s.id, company_id: d.id, name: s.name, address: s.address })
      }
    }

    // Review lists.
    for (const d of drafts) {
      const names = [...d.fromNames]
      const siteNames = [...d.sites.values()].map(s => s.name)
      if (names.length > 1 || names.some(n => normName(n) !== normName(d.name)) || siteNames.length) {
        this.ctx.addReview(
          'company_merges',
          'companies',
          d.id,
          d.name,
          `from ${names.map(n => `"${n}"`).join(' + ')}${siteNames.length ? `; sites: ${siteNames.join(', ')}` : ''}`,
        )
      }
    }
    const byLoose = new Map<string, Draft[]>()
    for (const d of drafts) {
      const k = looseKey(d.name)
      if (k) byLoose.set(k, [...(byLoose.get(k) ?? []), d])
    }
    for (const group of byLoose.values()) {
      if (group.length > 1) {
        this.ctx.addReview(
          'company_merges',
          'companies',
          group[0]!.id,
          group.map(g => g.name).join(' | '),
          'POSSIBLE DUPLICATE: these differ only in spelling or legal suffix. Add them to company_merge.csv if they are one company.',
        )
      }
    }
    for (const v of this.vendorRows) {
      if (v.parsed || v.flagged) {
        this.ctx.addReview(
          'vendor_parse',
          'vendors',
          v.oldId,
          v.oldName,
          v.parsed
            ? `parsed to company "${v.company}"${v.brand ? ` carrying brand "${v.brand}"` : ''}`
            : 'name_unparsed: looks like it holds a brand or a dealer; add a row to vendor_parse.csv or confirm it as it is',
        )
      }
    }

    return {
      companies,
      company_sites: sites,
      contacts: [...this.contactRows].sort((a, b) => (String(a['id']) < String(b['id']) ? -1 : 1)),
      brands: [...this.brands.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(b => ({ id: b.id, name: b.name, kind: b.kind })),
      company_brands: [...this.companyBrands]
        .sort()
        .map(k => {
          const [company_id, brand_id] = k.split('|') as [string, string]
          return { company_id, brand_id }
        }),
    }
  }
}
