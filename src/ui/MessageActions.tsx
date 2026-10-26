import { useId, useMemo, useState } from 'react'
import { Copy, Mail, MessageCircle } from 'lucide-react'
import { copyToClipboard } from '@/lib/clipboard'
import { LINK_LIMIT, detectPlatform, mailtoLink, openMessageLink, parseEmails, waLink, whatsappNumber, type NoWhatsAppReason } from '@/lib/messageLinks'
import { useChannelPreference, type ContactChannel } from '@/lib/useChannelPreference'
import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from '@/ui/Button'
import { useToast } from '@/ui/useToast'

/*
 * MessageActions (owner decision 2026-10-20, item 1): [Open in WhatsApp] [Open in email] [Copy] beside a prepared
 * message. Opening fills the message into WhatsApp or the mail app and the person presses Send there; this sends
 * nothing, stores nothing and never marks anything chased or reminded. That stays the screen's own explicit tap with
 * Undo: `onOpen` tells the screen a link was opened so it can offer it.
 *
 *   <MessageActions
 *     to={{ name: contact.name, phone: contact.phone, email: contact.email }}
 *     text={draft.whatsapp.body}
 *     email={{ subject: draft.email.subject, body: draft.email.body }}
 *     variant="primary"                                   // only where the screen's one primary is free
 *     copy={{ label: 'Copy and mark chased', onCopy: copyAndMark, busy }}
 *     onOpen={() => setOpened(true)}                      // then show the screen's "Mark chased" button
 *     channel={channel} onChannelChange={setChannel}      // share the screen's useChannelPreference
 *   />
 *
 * Order: the channel the person used last (useChannelPreference) first, buttons that work before ones that cannot,
 * Copy last. With variant="primary" the first button that works is the primary one. WhatsApp without a usable mobile
 * stays on screen, disabled, with the reason under it ("No mobile number saved for Ahmed Raza — add one"); Open in
 * email only appears when an address is saved. A message too long for a link (LINK_LIMIT) still opens the chat: it
 * is copied first and a toast says to paste it.
 */

export interface MessageRecipient {
  /** The person, or the company when no contact is saved. The reasons name them: "No mobile number saved for Ahmed Raza". */
  name: string
  /** The phone field as saved; it may hold several numbers (whatsappNumber picks one). */
  phone?: string | null
  /** The email field as saved; several addresses all go in To. */
  email?: string | null
}

export interface MessageEmail {
  subject?: string | null
  /** Default: the WhatsApp text. */
  body?: string | null
  cc?: string | readonly string[] | null
}

export interface MessageCopy {
  /** Default "Copy message". A screen whose copy also marks says so: "Copy and mark chased". */
  label?: string
  /** Replaces the plain copy (the last-used channel's text, then a toast): the screen's own copy-and-mark goes here. */
  onCopy?: () => void | Promise<void>
  busy?: boolean
  busyLabel?: string
  /** A fuller name where several sit in one list ("Copy answers for supplier Alpenmark"); it must contain the label. */
  'aria-label'?: string
}

export interface MessageActionsProps {
  /** Who the message is for; null when the record has no contact at all. */
  to: MessageRecipient | null
  /** The WhatsApp message. */
  text: string
  /** The email version. Omitted: Open in email sends `text` with no subject. */
  email?: MessageEmail
  /** 'primary' only where the screen's single primary is not already used. Default 'secondary'. */
  variant?: 'primary' | 'secondary'
  size?: ButtonProps['size']
  /** The Copy fallback; false hides it (the screen draws its own). */
  copy?: MessageCopy | false
  /** After a link opened. Never mark anything here: offer the separate "Mark chased" tap. */
  onOpen?: (channel: ContactChannel) => void
  /** Controlled channel, to share the screen's own useChannelPreference (two hook calls do not see each other's change). */
  channel?: ContactChannel
  onChannelChange?: (channel: ContactChannel) => void
  /** Makes the fix in a reason ("add one") a button: open the contact's edit dialog. */
  onFixContact?: () => void
  /** Buttons share the row's width (a phone action bar). */
  fill?: boolean
  className?: string
}

function reasonText(to: MessageRecipient | null, reason: NoWhatsAppReason): { lead: string; fix: string } {
  const who = to?.name.trim()
  if (!who) return { lead: 'No contact saved', fix: 'add one' }
  if (reason === 'landline') return { lead: `Only a landline saved for ${who}`, fix: 'add a mobile number' }
  if (reason === 'unreadable') return { lead: `The number saved for ${who} is not a mobile number`, fix: 'check it' }
  return { lead: `No mobile number saved for ${who}`, fix: 'add one' }
}

export function MessageActions({
  to,
  text,
  email,
  variant = 'secondary',
  size,
  copy = {},
  onOpen,
  channel: controlled,
  onChannelChange,
  onFixContact,
  fill = false,
  className,
}: MessageActionsProps) {
  const [remembered, remember] = useChannelPreference()
  const channel = controlled ?? remembered
  const { toast } = useToast()
  const [copying, setCopying] = useState(false)
  const ids = useId()
  const limit = useMemo(() => LINK_LIMIT[detectPlatform()], [])

  const mailBody = email?.body ?? text
  const number = useMemo(() => whatsappNumber(to?.phone), [to?.phone])
  const addresses = useMemo(() => parseEmails(to?.email), [to?.email])
  const wa = useMemo(() => waLink(to?.phone, text, { maxLength: limit }), [to?.phone, text, limit])
  const mail = useMemo(
    () => mailtoLink({ to: addresses, cc: email?.cc, subject: email?.subject, body: mailBody }, { maxLength: limit }),
    [addresses, email?.cc, email?.subject, mailBody, limit],
  )

  const choose = (c: ContactChannel) => {
    if (onChannelChange) onChannelChange(c)
    else remember(c)
  }

  const open = async (c: ContactChannel) => {
    const link = c === 'whatsapp' ? wa : mail
    if (!link) return
    choose(c)
    if (!link.filled) {
      // Too long for a link: copied first (inside the tap, before the new tab takes focus), then the empty chat opens.
      if (!(await copyToClipboard(c === 'email' ? mailBody : text))) {
        toast({ title: 'Could not copy the message', body: 'It is too long to fill in. Select the text and copy it by hand.', tone: 'danger' })
        return
      }
      toast({ title: 'Message copied', body: `It is too long to fill in. Paste it into ${c === 'email' ? 'the email' : 'the chat'}.`, tone: 'success' })
    }
    openMessageLink(link.url)
    onOpen?.(c)
  }

  const plainCopy = async () => {
    setCopying(true)
    try {
      const ok = await copyToClipboard(channel === 'email' ? mailBody : text)
      toast(
        ok
          ? { title: 'Copied', body: `Paste it into ${channel === 'email' ? 'your email' : 'WhatsApp'}.`, tone: 'success' }
          : { title: 'Could not copy the message', body: 'Select the text and copy it by hand.', tone: 'danger' },
      )
    } finally {
      setCopying(false)
    }
  }

  const who = to?.name.trim() || 'them'
  const whatsapp = { key: 'whatsapp' as const, works: wa !== null }
  const byEmail = mail ? [{ key: 'email' as const, works: true }] : []
  // Last-used channel first; then the ones that work before the one that cannot (sort is stable).
  const slots = (channel === 'email' ? [...byEmail, whatsapp] : [whatsapp, ...byEmail]).sort((a, b) => Number(b.works) - Number(a.works))
  const primary = variant === 'primary' ? (slots.find(s => s.works)?.key ?? (copy === false ? null : 'copy')) : null
  const reason = number.ok ? null : reasonText(to, number.reason)
  const tooLong = ' The message is too long to fill in: it is copied for you to paste.'
  const look = (key: ContactChannel | 'copy'): ButtonProps['variant'] => (key === primary ? 'primary' : 'secondary')
  // A long label wraps inside the box instead of running past it (a 320 px phone, a narrow card): the button grows, never clips.
  const width = cn('max-w-full !h-auto min-h-touch whitespace-normal py-2 text-left leading-snug', fill && 'flex-1')

  return (
    <div className={cn('grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-2', className)}>
      <div role="group" aria-label={to?.name.trim() ? `Send to ${to.name.trim()}` : 'Send the message'} className="flex flex-wrap items-center gap-2">
        {slots.map(s =>
          s.key === 'whatsapp' ? (
            <Button
              key="whatsapp"
              variant={look('whatsapp')}
              size={size}
              icon={MessageCircle}
              disabled={!s.works}
              aria-describedby={s.works ? `${ids}-wa` : `${ids}-why`}
              onClick={() => void open('whatsapp')}
              className={width}
            >
              Open in WhatsApp
            </Button>
          ) : (
            <Button key="email" variant={look('email')} size={size} icon={Mail} aria-describedby={`${ids}-mail`} onClick={() => void open('email')} className={width}>
              Open in email
            </Button>
          ),
        )}
        {copy === false ? null : (
          <Button
            variant={look('copy')}
            size={size}
            icon={Copy}
            busy={copy.busy ?? copying}
            busyLabel={copy.busyLabel}
            aria-label={copy['aria-label']}
            onClick={() => void (copy.onCopy ? copy.onCopy() : plainCopy())}
            className={width}
          >
            {copy.label ?? 'Copy message'}
          </Button>
        )}
      </div>
      {number.ok ? (
        <span id={`${ids}-wa`} className="sr-only">
          Opens WhatsApp with the message filled in, to {who} on {number.display}. You press Send there.
          {wa && !wa.filled ? tooLong : ''}
        </span>
      ) : null}
      {mail ? (
        <span id={`${ids}-mail`} className="sr-only">
          Opens your email app with the message filled in, to {addresses.join(', ')}. You press Send there.
          {mail.filled ? '' : tooLong}
        </span>
      ) : null}
      {reason ? (
        <p id={`${ids}-why`} className="text-sm text-fg-muted">
          {reason.lead} —{' '}
          {onFixContact ? (
            <button type="button" onClick={onFixContact} className="font-medium text-fg underline underline-offset-2 hover:text-primary">
              {reason.fix}
            </button>
          ) : (
            reason.fix
          )}
        </p>
      ) : null}
    </div>
  )
}
