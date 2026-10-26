import { useMemo } from 'react'
import { Briefcase, Building2, FileText, List as ListIcon, Package, Plus, Receipt, ShoppingCart, UserRound, Wrench } from 'lucide-react'
import { usePaletteSource } from '@/app/palette/usePalette'
import { findJobs, type JobRow } from '@/features/jobs/api'
import { stageModel } from '@/features/jobs/lib/stages'
import { searchAll, type SearchHit, type SearchKind, type SearchRole } from '@/features/search/api'
import type { PaletteItem, PaletteSource } from '@/ui/paletteSources'

/*
 * The one search source of the command palette (R12, P02): companies, contacts (open the company), RFQ numbers and customer
 * references, orders (ORD number, customer PO for admin and sales), order items, supplier PO numbers ("PO-26-0017") and
 * invoice numbers (admin and sales: the database returns none to an engineer, see migration 0054). A burst of keystrokes becomes one request: the source waits DEBOUNCE_MS after the last keystroke, and the
 * palette cancels the signal on the next one, which drops both the wait and a request already in flight.
 * Each kind shows its best SHOWN_PER_KIND rows; when there are more, a last "See all N results" row opens that kind's own list
 * with the words in its search box (seeAllHref), so the palette never hides a match (rubric "Finding things").
 * Groups come from the database kind; an RFQ number ("177", "RFQ-0177") puts RFQs first, otherwise companies lead.
 * After the places come the Actions: "New RFQ for <company>" (the best company match, opens intake with it chosen) and
 * "Add <x> as a new company" when no company has exactly that name. Idle rows (Recent, Actions) live in PaletteHost.
 */
export const DEBOUNCE_MS = 150

const ROLE_META: Record<SearchRole, string> = { customer: 'Customer', supplier: 'Supplier', both: 'Customer and supplier', prospect: 'Prospect' }
const HEADING: Record<SearchKind, string> = {
  company: 'Companies',
  contact: 'Contacts',
  rfq: 'RFQs',
  order: 'Orders',
  item: 'Order items',
  po: 'Purchase orders',
  invoice: 'Invoices',
}
const ACTIONS = 'Actions'
const JOBS = 'Jobs'

/**
 * Jobs (redesign phase 5): the same jobs the Jobs page's search box finds, because both call features/jobs/api.ts findJobs (the
 * palette hands over the search_all answer it already has). A job that cannot be read never breaks the rest of the palette.
 */
function jobItem(j: JobRow): PaletteItem {
  const stands = stageModel({ stage: j.stage, stageDetail: j.stageDetail, kind: j.kind }).label
  return { id: `job-${j.key}`, group: JOBS, label: `Job ${j.key} · ${j.companyName}`, meta: [j.items, stands].filter(Boolean).join(' · ') || undefined, icon: Briefcase, href: `/jobs/${encodeURIComponent(j.key)}` }
}

/** Rows shown per kind; the search asks for up to FETCH_LIMIT (the database's cap, migration 0054) so it can say how many more there are. */
export const SHOWN_PER_KIND = 6
export const FETCH_LIMIT = 25
/** The longest text offered as a new company name: search_all ignores anything longer (migration 0054), so it could never say the company exists. */
export const NEW_COMPANY_MAX = 100
/** The list a "See all" row opens, by kind. */
const LIST_NAME: Record<SearchKind, string> = {
  company: 'Companies',
  contact: 'Companies',
  rfq: 'RFQs',
  order: 'Orders',
  item: 'Orders',
  po: 'Orders',
  invoice: 'Invoices & GST',
}

/**
 * "See all N results": the kind's own list with the words in its search box (?q=), across every owner, so nothing found here is
 * missing there. Contacts open the Companies list (it searches contact names); order items and supplier POs the Orders list.
 */
export function seeAllHref(kind: SearchKind, q: string): string {
  const qs = encodeURIComponent(q)
  if (kind === 'company' || kind === 'contact') return `/companies?q=${qs}`
  if (kind === 'rfq') return `/rfqs?owner=all&q=${qs}`
  if (kind === 'invoice') return `/money/gst-register?q=${qs}`
  return `/orders?owner=all&q=${qs}`
}

function seeAll(kind: SearchKind, q: string, count: number): PaletteItem {
  const n = count >= FETCH_LIMIT ? `${FETCH_LIMIT}+` : String(count)
  return { id: `see-all-${kind}`, group: HEADING[kind], label: `See all ${n} results`, meta: `In ${LIST_NAME[kind]}`, icon: ListIcon, href: seeAllHref(kind, q) }
}
const looksLikeRfqNumber = (q: string) => /^(rfq[-\s]*)?\d{1,15}$/i.test(q.trim())
const BASE: readonly SearchKind[] = ['company', 'contact', 'rfq', 'order', 'invoice', 'po', 'item']

/** The kinds in the order the person most likely means: a typed number or prefix puts what it names first. */
export function kindOrder(q: string): SearchKind[] {
  const t = q.trim()
  const first: SearchKind[] = /^po[-\s]*\d/i.test(t) ? ['po'] : /^ord/i.test(t) ? ['order'] : /^inv/i.test(t) ? ['invoice'] : /^rfq/i.test(t) || looksLikeRfqNumber(t) ? ['rfq', 'order'] : []
  return [...first, ...BASE.filter(k => !first.includes(k))]
}

/** Resolves true after `ms`, or false at once if the signal aborts first. */
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve(false)
    const done = (ok: boolean) => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(ok)
    }
    const onAbort = () => done(false)
    const timer = window.setTimeout(() => done(true), ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function toItem(h: SearchHit): PaletteItem {
  const group = HEADING[h.kind]
  if (h.kind === 'company') {
    return {
      id: `company-${h.id}`,
      group,
      label: h.label,
      meta: [h.role ? ROLE_META[h.role] : null, h.meta].filter(Boolean).join(' · ') || undefined,
      icon: Building2,
      href: `/companies/${h.id}`,
    }
  }
  if (h.kind === 'contact') {
    return { id: `contact-${h.id}`, group, label: h.label, meta: h.meta ?? undefined, icon: UserRound, href: h.companyId ? `/companies/${h.companyId}` : undefined }
  }
  if (h.kind === 'order') return { id: `order-${h.id}`, group, label: h.label, meta: h.meta ?? undefined, icon: Package, href: `/orders/${h.id}` }
  if (h.kind === 'item') return { id: `item-${h.id}`, group, label: h.label, meta: h.meta ?? undefined, icon: Wrench, href: h.orderId ? `/orders/${h.orderId}` : undefined }
  if (h.kind === 'po') return { id: `po-${h.id}`, group, label: h.label, meta: h.meta ?? undefined, icon: ShoppingCart, href: h.orderId ? `/orders/${h.orderId}` : undefined }
  if (h.kind === 'invoice') return { id: `invoice-${h.id}`, group, label: h.label, meta: h.meta ?? undefined, icon: Receipt, href: `/money/gst-register?invoice=${encodeURIComponent(h.id)}` }
  return { id: `rfq-${h.id}`, group, label: h.label, meta: h.meta ?? undefined, icon: FileText, href: `/rfqs/${h.id}` }
}

export function searchPaletteSource(debounceMs = DEBOUNCE_MS): PaletteSource {
  return {
    id: 'search',
    group: 'Results',
    order: 10,
    search: async (query, signal) => {
      // Doubled spaces inside the text are one space, as the database search treats them (migration 0084).
      const q = query.trim().replace(/\s+/g, ' ')
      if (!q) return []
      if (!(await pause(debounceMs, signal))) return []
      const hits = await searchAll(q, signal, FETCH_LIMIT)
      if (signal.aborted) return []
      const jobs = await findJobs(q, signal, hits).catch(() => [] as JobRow[])
      if (signal.aborted) return []
      const jobItems: PaletteItem[] = [
        ...jobs.slice(0, SHOWN_PER_KIND).map(jobItem),
        ...(jobs.length > SHOWN_PER_KIND ? [{ id: 'see-all-jobs', group: JOBS, label: `See all ${jobs.length >= 200 ? '200+' : jobs.length} results`, meta: 'In Jobs', icon: ListIcon, href: `/jobs?q=${encodeURIComponent(q)}` }] : []),
      ]
      const items = kindOrder(q).flatMap(kind => {
        const ofKind = hits.filter(h => h.kind === kind).sort((a, b) => b.score - a.score)
        const shown = ofKind.slice(0, SHOWN_PER_KIND).map(toItem)
        return ofKind.length > SHOWN_PER_KIND ? [...shown, seeAll(kind, q, ofKind.length)] : shown
      })
      // A typed job number ("139", "Job 139", "O-45") puts the job first; otherwise the jobs follow the places.
      if (/^(job[-\s]*)?(o[-\s]*)?\d{1,9}$/i.test(q)) items.unshift(...jobItems)
      else items.push(...jobItems)
      const topCompany = hits.filter(h => h.kind === 'company').sort((a, b) => b.score - a.score)[0]
      if (topCompany) {
        items.push({ id: `rfq-new-${topCompany.id}`, group: ACTIONS, label: `New RFQ for ${topCompany.label}`, meta: 'Go to intake', icon: Plus, href: `/rfqs/new?company=${encodeURIComponent(topCompany.id)}` })
      }
      if (q.length <= NEW_COMPANY_MAX && !hits.some(h => h.kind === 'company' && h.label.trim().toLowerCase() === q.toLowerCase())) {
        items.push({ id: 'company-new-typed', group: ACTIONS, label: `Add “${q}” as a new company`, meta: 'Action', icon: Plus, href: `/companies?new=1&name=${encodeURIComponent(q)}` })
      }
      return items
    },
  }
}

/** Register the search source for as long as the caller is mounted (the app shell mounts it for the whole session). */
export function useSearchPaletteSource() {
  const source = useMemo(() => searchPaletteSource(), [])
  usePaletteSource(source)
}
