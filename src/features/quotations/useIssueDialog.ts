import { useSearchParams } from 'react-router-dom'

/* The Issue quotation dialog is open while the address carries ?issue=1: the header button and the Quotations block open the same dialog without sharing state. */
export const ISSUE_PARAM = 'issue'

export function useIssueDialog(): [boolean, (open: boolean) => void] {
  const [params, setParams] = useSearchParams()
  const open = params.get(ISSUE_PARAM) === '1'
  const set = (next: boolean) => {
    const p = new URLSearchParams(params)
    if (next) p.set(ISSUE_PARAM, '1')
    else p.delete(ISSUE_PARAM)
    setParams(p, { replace: true })
  }
  return [open, set]
}

