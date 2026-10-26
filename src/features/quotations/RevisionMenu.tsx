import { Ellipsis } from 'lucide-react'
import { Button } from '@/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { useHistoryPanel } from '@/features/history/useHistoryPanel'

/*
 * The "…" on a quotation revision's row: History (W7). Row-level menus are a small icon button named "More for {name}".
 */
export function RevisionMenu({ quotationId, label, context }: { quotationId: string; label: string; context: string }) {
  const history = useHistoryPanel({ table: 'quotations', id: quotationId, context })
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="quiet" icon={Ellipsis} aria-label={`More for ${label}`} aria-haspopup="menu" />
        </PopoverTrigger>
        <PopoverContent variant="menu" align="end" aria-label={`More for ${label}`}>
          {history.item}
        </PopoverContent>
      </Popover>
      {history.node}
    </>
  )
}
