import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { searchRfqs } from '@/features/rfqs/board/api'
import { qk } from '@/features/queryKeys'
import { queryClient } from '@/lib/queryClient'
import { rfqRef } from '@/lib/refs'
import { usePaletteSource } from '@/app/palette/usePalette'
import type { PaletteItem, PaletteSource } from '@/ui/paletteSources'

/*
 * Command-palette source for RFQs (R06): type an RFQ number ("177", "RFQ-0177"), the customer's own
 * reference, or part of the company's name. Goes through the shared query cache, like the companies
 * source, and drops a search that a newer keystroke has replaced.
 */
export function rfqsPaletteSource(): PaletteSource {
  return {
    id: 'rfqs',
    group: 'RFQs',
    order: 10,
    search: async (query, signal) => {
      const q = query.trim()
      if (q.length < 1) return []
      const hits = await queryClient.fetchQuery({ queryKey: qk.rfqs.search(q), queryFn: () => searchRfqs(q), staleTime: 30_000 })
      if (signal.aborted) return []
      return hits.map(
        (h): PaletteItem => ({
          id: `rfq-${h.id}`,
          label: `${rfqRef(h.number)} ${h.companyName}`.trim(),
          meta: [h.customerRef ? `Ref ${h.customerRef}` : null, h.closed ? 'Closed' : 'Open'].filter(Boolean).join(' · '),
          icon: FileText,
          href: `/rfqs/${h.id}`,
        }),
      )
    },
  }
}

export function useRfqsPaletteSource() {
  const source = useMemo(rfqsPaletteSource, [])
  usePaletteSource(source)
}
