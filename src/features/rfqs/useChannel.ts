import { useCallback, useState } from 'react'
import type { EnquiryVariant } from '@/features/rfqs/lib/enquiryDraft'

/*
 * The person's WhatsApp or Email choice, remembered on this device so every message on the RFQ screens starts on it (UX audit
 * 2026-10-19, recommendation 12). The other channel is one "Email instead" / "WhatsApp instead" link away.
 */
const KEY = 'qtech.channel'

function read(): EnquiryVariant {
  try {
    return localStorage.getItem(KEY) === 'email' ? 'email' : 'whatsapp'
  } catch {
    return 'whatsapp'
  }
}

export function useChannel(): [EnquiryVariant, (v: EnquiryVariant) => void] {
  const [channel, setChannel] = useState<EnquiryVariant>(read)
  const set = useCallback((v: EnquiryVariant) => {
    setChannel(v)
    try {
      localStorage.setItem(KEY, v)
    } catch {
      /* private window: the choice lasts for this visit only */
    }
  }, [])
  return [channel, set]
}

export const otherChannel = (v: EnquiryVariant): EnquiryVariant => (v === 'whatsapp' ? 'email' : 'whatsapp')
export const channelName = (v: EnquiryVariant) => (v === 'whatsapp' ? 'WhatsApp' : 'Email')
