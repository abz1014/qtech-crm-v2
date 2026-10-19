import { useCallback, useState } from 'react'
import { useSession } from '@/app/session'

/** How a message is sent: the person copies it into WhatsApp or into an email. */
export type ContactChannel = 'whatsapp' | 'email'

/*
 * The person's last WhatsApp / Email choice (UX audit 2026-10-19), so a chase, a reminder or an enquiry opens on the
 * channel they used last time instead of always on WhatsApp. One localStorage entry per person on this device
 * (`qtech.channel.<person id>`, `qtech.channel.anon` signed out). Storage can be missing or throw (a private window,
 * blocked site data): every read and write is in try/catch, and the choice still applies, just not remembered.
 *
 *   const [channel, setChannel] = useChannelPreference()
 */
const DEFAULT: ContactChannel = 'whatsapp'

export const channelKey = (userId: string | null): string => `qtech.channel.${userId ?? 'anon'}`

const read = (key: string): ContactChannel | null => {
  try {
    const v = window.localStorage.getItem(key)
    return v === 'whatsapp' || v === 'email' ? v : null
  } catch {
    return null
  }
}

export function useChannelPreference(): [ContactChannel, (next: ContactChannel) => void] {
  const s = useSession()
  const key = channelKey(s.status === 'signed-in' ? s.user.id : null)
  const [state, setState] = useState<{ key: string; value: ContactChannel }>(() => ({ key, value: read(key) ?? DEFAULT }))
  // A different person on the same mounted screen: read their own choice.
  const value = state.key === key ? state.value : (read(key) ?? DEFAULT)
  const set = useCallback(
    (next: ContactChannel) => {
      setState({ key, value: next })
      try {
        window.localStorage.setItem(key, next)
      } catch {
        /* not remembered, still applied */
      }
    },
    [key],
  )
  return [value, set]
}
