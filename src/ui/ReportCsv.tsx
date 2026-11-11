import { useContext, useEffect } from 'react'
import { Download } from 'lucide-react'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/ui/Button'
import { ReportCsvContext } from '@/ui/reportCsvContext'

/*
 * Export CSV on a report (clarity lane L2): a secondary button (a report has no next step, so nothing is green). A report body
 * draws <ReportCsv /> straight after its summary, so the place is explicit and does not depend on what else the body draws first.
 * The frame draws it near the top only while no body has claimed the place (loading, error and empty states). Outside a frame, or
 * in a report with no CSV, it draws nothing.
 */
export function CsvButton({ csv, className }: { csv: (() => void) | null; className?: string }) {
  return (
    <div className={className ?? 'justify-self-start'}>
      <Button variant="secondary" icon={Download} onClick={() => csv?.()} disabled={!csv}>
        Export CSV
      </Button>
    </div>
  )
}

export function ReportCsv() {
  const ctx = useContext(ReportCsvContext)
  const claim = ctx?.claim
  useEffect(() => {
    claim?.(true)
    return () => claim?.(false)
  }, [claim])
  const wide = useMediaQuery('(min-width: 768px)')
  // from 768 up the frame draws the button on the select's row (clarity lane D0); this slot is the phone place
  if (!ctx || ctx.csv === undefined || wide) return null
  return <CsvButton csv={ctx.csv} />
}
