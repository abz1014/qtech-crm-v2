import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { OPEN_REPLY_EVENT, type OpenReplyDetail } from '@/features/rfqs/replyFocus'

/** Which supplier's reply dialog is open (SupplierReplies.tsx), and the item whose price box gets the cursor. */
export interface OpenReply {
  inquiryId: string
  itemId?: string
}

/**
 * The open reply, and the two ways in from elsewhere: "Edit reply" in a price row's menu (OPEN_REPLY_EVENT) and Capture's "This is
 * a supplier's reply" (router state, read out by the dialog itself).
 */
export function useReplyDialog() {
  const [open, setOpen] = useState<OpenReply | null>(null)
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
