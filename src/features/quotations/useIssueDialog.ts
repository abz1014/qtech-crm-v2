import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useMediaQuery } from '@/lib/useMediaQuery'

/* The Issue quotation dialog is open while the address carries ?issue=1: the header button and the Quotations block open the same dialog without sharing state. */
export const ISSUE_PARAM = 'issue'

/** Marks the history entry this hook pushed, so closing can step back to the RFQ page instead of adding another entry. */
const PUSHED = 'issueDialogPushed'

/**
 * HW-9: on a desktop, opening pushes ?issue=1 as its own history entry, so the browser's Back closes the dialog and stays on
 * the RFQ page (it used to replace the entry, and Back left the page). What was typed survives in the dialog's draft
 * (issueDraft.ts). On phones and touch screens the Dialog already turns Back into "close" with its own entry
 * (useBackToClose), so there the address is still replaced, as before.
 */
export function useIssueDialog(): [boolean, (open: boolean) => void] {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const touch = useMediaQuery('(max-width: 767px), (pointer: coarse)')
  const open = params.get(ISSUE_PARAM) === '1'
  const set = (next: boolean) => {
    if (!next && open && (location.state as Record<string, unknown> | null)?.[PUSHED] === true) {
      navigate(-1)
      return
    }
    const p = new URLSearchParams(params)
    if (next) p.set(ISSUE_PARAM, '1')
    else p.delete(ISSUE_PARAM)
    if (next && !open && !touch) setParams(p, { state: { [PUSHED]: true } })
    else setParams(p, { replace: true })
  }
  return [open, set]
}
