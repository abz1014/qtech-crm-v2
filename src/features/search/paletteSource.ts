import { useMemo } from 'react'
import { Building2, FileText, Plus, UserRound } from 'lucide-react'
import { usePaletteSource } from '@/app/palette/usePalette'
import { searchAll, type SearchHit, type SearchKind, type SearchRole } from '@/features/search/api'
import type { PaletteItem, PaletteSource } from '@/ui/paletteSources'

/*
 * The one search source of the command palette (R12): companies, contacts (open the company), RFQ numbers and customer
 * references. A burst of keystrokes becomes one request: the source waits DEBOUNCE_MS after the last keystroke, and the
 * palette cancels the signal on the next one, which drops both the wait and a request already in flight.
 * Groups come from the database kind; an RFQ number ("177", "RFQ-0177") puts RFQs first, otherwise companies lead.
 * Idle, the palette offers "New company" (the companies source of R02 is folded in here).
 */
export const DEBOUNCE_MS = 150

const ROLE_META: Record<SearchRole, string> = { customer: 'Customer', supplier: 'Supplier', both: 'Customer and supplier', prospect: 'Prospect' }
const HEADING: Record<SearchKind, string> = { company: 'Companies', contact: 'Contacts', rfq: 'RFQs' }
const looksLikeRfqNumber = (q: string) => /^(rfq[-\s]*)?\d{1,15}$/i.test(q.trim())

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
  return { id: `rfq-${h.id}`, group, label: h.label, meta: h.meta ?? undefined, icon: FileText, href: `/rfqs/${h.id}` }
}

export function searchPaletteSource(debounceMs = DEBOUNCE_MS): PaletteSource {
  return {
    id: 'search',
    group: 'Results',
    order: 10,
    idle: () => [{ id: 'company-new', group: 'Companies', label: 'New company', meta: 'Action', icon: Plus, href: '/companies?new=1' }],
    search: async (query, signal) => {
      const q = query.trim()
      if (!q) return []
      if (!(await pause(debounceMs, signal))) return []
      const hits = await searchAll(q, signal)
      if (signal.aborted) return []
      const order: SearchKind[] = looksLikeRfqNumber(q) ? ['rfq', 'company', 'contact'] : ['company', 'contact', 'rfq']
      const items = order.flatMap(kind =>
        hits
          .filter(h => h.kind === kind)
          .sort((a, b) => b.score - a.score)
          .map(toItem),
      )
      if (!hits.some(h => h.kind === 'company' && h.label.trim().toLowerCase() === q.toLowerCase())) {
        items.push({ id: 'company-new-typed', group: 'Companies', label: `Add “${q}” as a new company`, meta: 'Action', icon: Plus, href: `/companies?new=1&name=${encodeURIComponent(q)}` })
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
