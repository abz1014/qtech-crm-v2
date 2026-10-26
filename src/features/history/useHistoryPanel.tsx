import { useState, type ReactNode } from 'react'
import { HistoryMenuItem } from '@/features/history/LastChanged'
import { LazyHistoryPanel } from '@/features/history/LazyHistoryPanel'
import type { HistoryTable } from '@/features/history/api'

/**
 * The History item of a record's More menu and the panel it opens, in one hook (W7):
 *   const history = useHistoryPanel({ table: 'orders', id: order.id, context: 'ORD-0038 · Indus Textile' })
 *   <MoreMenu>… {history.item} …</MoreMenu>   {history.node}
 * `ask` opens the panel from anywhere else (a phone button). The panel's code is downloaded the first time it opens.
 */
export function useHistoryPanel(o: { table: HistoryTable; id: string; context?: string; imported?: boolean }): { item: ReactNode; node: ReactNode; ask: () => void } {
  const [open, setOpen] = useState(false)
  const ask = () => setOpen(true)
  return {
    ask,
    item: <HistoryMenuItem onOpen={ask} />,
    node: <LazyHistoryPanel open={open} onOpenChange={setOpen} table={o.table} id={o.id} context={o.context} imported={o.imported} />,
  }
}
