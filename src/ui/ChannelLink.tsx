import { useMemo } from 'react'
import { Mail, MessageCircle } from 'lucide-react'
import { copyToClipboard } from '@/lib/clipboard'
import { LINK_LIMIT, detectPlatform, mailtoLink, openMessageLink, parseEmails, waLink } from '@/lib/messageLinks'
import type { ContactChannel } from '@/lib/useChannelPreference'
import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from '@/ui/Button'
import type { MessageEmail, MessageRecipient } from '@/ui/MessageActions'
import { useToast } from '@/ui/useToast'

/*
 * ChannelLink (round-2 R2-07, nav rec 12): the WhatsApp / Email choice everywhere a message is prepared. The remembered channel
 * (useChannelPreference) is the default and the other one is a quiet link, "Email instead" or "WhatsApp instead", so the choice
 * is never a two-option switch to make first. Moved here from src/features/rfqs/ChaseParts.tsx so Today, the payment reminder
 * and the goods chase use the same control as the RFQ screens.
 *
 *   <ChannelLink value={channel} onChange={setChannel} />
 *   <ChannelLink value={channel} onChange={setChannel}
 *     open={{ to: { name, phone, email }, text: draft.body, email: { subject, body }, onOpen: () => setOpened(true) }} />
 *
 * `open` adds the owner's "Open in WhatsApp" / "Open in email" button (DECISIONS 2026-10-20, item 1) for the channel now
 * chosen, built on src/lib/messageLinks like MessageActions: it fills the message into WhatsApp or the mail app and the
 * person presses Send there. It sends and stores nothing and never marks anything chased: `onOpen` lets the screen offer that.
 * A message too long for a link is copied first, and a toast says to paste it. With no usable number or address for the
 * chosen channel the button is not drawn (MessageActions explains why where the full row is shown).
 */
export interface ChannelOpen {
  to: MessageRecipient | null
  /** The WhatsApp message. */
  text: string
  /** The email version; default: `text` with no subject. */
  email?: MessageEmail
  onOpen?: (channel: ContactChannel) => void
  size?: ButtonProps['size']
  variant?: 'primary' | 'secondary'
}

export interface ChannelLinkProps {
  value: ContactChannel
  onChange: (v: ContactChannel) => void
  /** Adds the "Open in WhatsApp" / "Open in email" button before the link. */
  open?: ChannelOpen
  className?: string
}

export function ChannelLink({ value, onChange, open, className }: ChannelLinkProps) {
  const other = value === 'whatsapp' ? 'email' : 'whatsapp'
  const link = (
    <button
      type="button"
      onClick={() => onChange(other)}
      className={cn('rounded text-sm font-medium text-fg-2 underline underline-offset-2 hover:text-fg', !open && className)}
    >
      {other === 'email' ? 'Email instead' : 'WhatsApp instead'}
    </button>
  )
  if (!open) return link
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      <OpenInChannel channel={value} {...open} />
      {link}
    </span>
  )
}

function OpenInChannel({ channel, to, text, email, onOpen, size, variant = 'secondary' }: ChannelOpen & { channel: ContactChannel }) {
  const { toast } = useToast()
  const limit = useMemo(() => LINK_LIMIT[detectPlatform()], [])
  const body = email?.body ?? text
  const target = useMemo(
    () =>
      channel === 'whatsapp'
        ? waLink(to?.phone, text, { maxLength: limit })
        : mailtoLink({ to: parseEmails(to?.email), cc: email?.cc, subject: email?.subject, body }, { maxLength: limit }),
    [channel, to?.phone, to?.email, text, email?.cc, email?.subject, body, limit],
  )
  if (!target) return null

  const go = async () => {
    if (!target.filled) {
      // Too long for a link: copied first (inside the tap, before the new tab takes focus), then the empty chat opens.
      if (!(await copyToClipboard(channel === 'email' ? body : text))) {
        toast({ title: 'Could not copy the message', body: 'It is too long to fill in. Select the text and copy it by hand.', tone: 'danger' })
        return
      }
      toast({ title: 'Message copied', body: `It is too long to fill in. Paste it into ${channel === 'email' ? 'the email' : 'the chat'}.`, tone: 'success' })
    }
    openMessageLink(target.url)
    onOpen?.(channel)
  }

  return (
    <Button variant={variant} size={size} icon={channel === 'email' ? Mail : MessageCircle} onClick={() => void go()}>
      {channel === 'email' ? 'Open in email' : 'Open in WhatsApp'}
    </Button>
  )
}
