import { useSearchParams } from 'react-router-dom'

const WON_PARAM = 'won'

/** The dialog is open while the address carries ?won=1, so the header button and the quotation card open the same dialog. */
export function useWonDialog(): [boolean, (open: boolean) => void] {
  const [params, setParams] = useSearchParams()
  const open = params.get(WON_PARAM) === '1'
  const set = (next: boolean) => {
    const p = new URLSearchParams(params)
    if (next) p.set(WON_PARAM, '1')
    else p.delete(WON_PARAM)
    setParams(p, { replace: true })
  }
  return [open, set]
}
