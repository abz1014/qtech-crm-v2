import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSeesPrices } from '@/app/session'
import { OPEN_REPLY_EVENT, type OpenReplyDetail } from '@/features/rfqs/replyFocus'

/** Which supplier's reply dialog is open (SupplierReplies.tsx), and the item whose price box gets the cursor. */
export interface OpenReply {
  inquiryId: string
  itemId?: string
}

/**
 * The open reply, and the two ways in from elsewhere: "Edit reply" in a price row's menu (OPEN_REPLY_EVENT) and Capture's "This is
 * a supplier's reply" (router state, read out by the dialog itself).
 *
 * A reply is prices (supplier_quote_lines.unit_price is required), so for an engineer (owner decision 2026-10-22: engineers see and
 * write no prices) the dialog never opens, whichever way in is used: `open` stays null and `show` does nothing.
 */
export function useReplyDialog() {
  const prices = useSeesPrices()
  const [state, setOpen] = useState<OpenReply | null>(null)
  const open = prices ? state : null
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<OpenReplyDetail>).detail
      setOpen({ inquiryId: d.inquiryId, itemId: d.itemId })
    }
    window.addEventListener(OPEN_REPLY_EVENT, on)
    return () => window.removeEventListener(OPEN_REPLY_EVENT, on)
  }, [])
  const location = useLocation()
  const handed = (location.state as { reply?: { inquiryId: string } } | null)?.reply?.inquiryId
  useEffect(() => {
    if (handed) setOpen(o => (o?.inquiryId === handed ? o : { inquiryId: handed }))
  }, [handed])
  const show = useCallback((inquiryId: string, itemId?: string) => setOpen({ inquiryId, itemId }), [])
  const close = useCallback(() => setOpen(null), [])
  return { open, show, close }
}
