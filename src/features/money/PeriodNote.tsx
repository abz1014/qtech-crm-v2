import { useLocation } from 'react-router-dom'
import { fixedPeriodNote, readFixedPeriod } from '@/features/money/monthParam'

/** The small note a Money month page shows after it put a link's month right (monthParam.ts). Nothing otherwise. */
export function PeriodNote() {
  const { state } = useLocation()
  const f = readFixedPeriod(state)
  if (!f) return null
  return (
    <p role="status" className="text-sm text-fg-2" data-testid="period-note">
      {fixedPeriodNote(f)}
    </p>
  )
}
