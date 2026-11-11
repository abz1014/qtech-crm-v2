import { useContext, useEffect } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/ui/Button'
import { ReportCsvContext } from '@/ui/reportCsvContext'

/*
 * Export CSV on a report (clarity lane L2): a secondary button (a report has no next step, so nothing is green). A report body
 * draws <ReportCsv /> straight after its summary, so the place is explicit and does not depend on what else the body draws first.
 * The frame draws it near the top only while no body has claimed the place (loading, error and empty states). Outside a frame, or
 * in a report with no CSV, it draws nothing.
 */
export function CsvButton({ csv }: { csv: (() => void) | null }) {
  return (
    <div className="justify-self-start">
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
  if (!ctx || ctx.csv === undefined) return null
  return <CsvButton csv={ctx.csv} />
}
