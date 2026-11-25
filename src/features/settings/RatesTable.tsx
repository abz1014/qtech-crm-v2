import { useMemo } from 'react'
import { useFxLatest } from '@/features/rfqs/hooks'
import { buildRateRows } from '@/features/fx/ratesModel'
import { RateTable } from '@/features/fx/RateTable'

/*
 * Settings home's exchange rates: the same table as Settings > Exchange rates (src/features/fx/RateTable.tsx, screen review
 * 2026-11-24 item 21), read-only. The age reads the same bands as the price comparison (fresh up to 7 days, stale 8 to 30,
 * unusable over 30), straight from v_fx_latest, so an old rate looks old everywhere.
 */
export function RatesTable() {
  const q = useFxLatest()
  const rows = useMemo(() => buildRateRows(q.data ?? []), [q.data])
  return (
    <RateTable
      rows={rows}
      loading={q.isLoading}
      error={
        q.isError
          ? { title: 'Could not load the exchange rates', message: 'Nothing has changed. Check your connection, then try again.', onRetry: () => void q.refetch() }
          : null
      }
      empty={<p className="px-6 py-10 text-center text-sm text-fg-muted">No rates yet. They arrive every night, or enter one where a price needs it.</p>}
    />
  )
}
