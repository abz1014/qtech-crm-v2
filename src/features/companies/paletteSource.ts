import { useMemo } from 'react'
import { Building2, Plus } from 'lucide-react'
import { searchCompanies, type CompanyRole } from '@/features/companies/api'
import { qk } from '@/features/queryKeys'
import { queryClient } from '@/lib/queryClient'
import { usePaletteSource } from '@/app/palette/usePalette'
import type { PaletteItem, PaletteSource } from '@/ui/paletteSources'

/*
 * Command-palette source for companies (R02; R12 adds contacts, RFQ numbers and customer refs beside it).
 * Typing finds companies by name through the shared query cache, so a repeated search is instant and an
 * old search is dropped when a newer one starts (the palette hands in an AbortSignal). Idle, the palette
 * offers "New company", which opens the inline create dialog on the Companies screen.
 */
const ROLE_META: Record<CompanyRole, string> = { customer: 'Customer', supplier: 'Supplier', both: 'Customer and supplier', prospect: 'Prospect' }

export function companiesPaletteSource(): PaletteSource {
  return {
    id: 'companies',
    group: 'Companies',
    order: 20,
    idle: () => [
      { id: 'company-new', label: 'New company', meta: 'Action', icon: Plus, href: '/companies?new=1' } satisfies PaletteItem,
    ],
    search: async (query, signal) => {
      const q = query.trim()
      const items: PaletteItem[] = []
      if (q.length >= 1) {
        const hits = await queryClient.fetchQuery({
          queryKey: qk.companies.search(q),
          queryFn: () => searchCompanies(q),
          staleTime: 30_000,
        })
        if (signal.aborted) return []
        for (const h of hits) {
          items.push({
            id: `company-${h.id}`,
            label: h.name,
            meta: [h.role ? ROLE_META[h.role] : null, h.country].filter(Boolean).join(' · ') || undefined,
            icon: Building2,
            href: `/companies/${h.id}`,
          })
        }
        if (!hits.some(h => h.name.trim().toLowerCase() === q.toLowerCase())) {
          items.push({ id: 'company-new-typed', label: `Add “${q}” as a new company`, meta: 'Action', icon: Plus, href: `/companies?new=1&name=${encodeURIComponent(q)}` })
        }
      }
      return items
    },
  }
}

/** Register the companies source for as long as the caller is mounted (the app shell mounts it for the whole session). */
export function useCompaniesPaletteSource() {
  const source = useMemo(companiesPaletteSource, [])
  usePaletteSource(source)
}
