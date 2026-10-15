import type { ReactNode } from 'react'
import { Copy, Hourglass, Mail, Phone } from 'lucide-react'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
import { DateInput } from '@/ui/form/DateInput'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'

/*
 * The pieces every chase surface shares (g2-chase-texts, g2-today-b2): the message with its *bold* markers drawn faint,
 * the recipient row, the email Subject row with "Copy subject", the "Untick to leave one out" list, the editable
 * "Kindly confirm by" date and the hourglass banner that says where the item goes and when it returns.
 */

/** Text between asterisks is bold when pasted into WhatsApp: here the asterisks are drawn faint and the words bold. */
export function FormattedMessage({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g)
  return (
    <pre data-testid={testId} className={cn('whitespace-pre-wrap break-words font-sans text-sm text-fg', className)}>
      {parts.map((p, i) =>
        /^\*[^*\n]+\*$/.test(p) ? (
          <span key={i}>
            <span className="text-fg-muted">*</span>
            <b className="font-semibold">{p.slice(1, -1)}</b>
            <span className="text-fg-muted">*</span>
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </pre>
  )
}

export interface Recipient {
  name: string
  phone?: string | null
  email?: string | null
}

/** "To Mr. Tariq Mehmood   +92 300 555 0142" for WhatsApp, the address for email. `lead` is "To", or "WhatsApp to" / "Email to". */
export function RecipientRow({ channel, contact, lead = 'To', className }: { channel: 'whatsapp' | 'email'; contact: Recipient | null; lead?: string; className?: string }) {
  const email = channel === 'email'
  const detail = email ? contact?.email : contact?.phone
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm text-fg-2', className)}>
      <span className="inline-flex items-center gap-2">
        <Icon icon={email ? Mail : Phone} size="sm" className="text-fg-muted" />
        {contact ? `${lead} ${contact.name}` : 'No contact on record'}
      </span>
      {detail ? <span className="num">{detail}</span> : contact ? <span className="text-xs text-fg-muted">{email ? 'no email on file' : 'no phone on file'}</span> : null}
    </div>
  )
}

/** The email subject on its own row, with its own copy button, as drawn. */
export function SubjectRow({ subject, className }: { subject: string; className?: string }) {
  const { toast } = useToast()
  return (
    <div className={cn('grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2 text-sm', className)}>
      <span className="text-fg-muted">Subject</span>
      <span className="min-w-0 break-words">{subject}</span>
      <Button
        size="sm"
        variant="quiet"
        icon={Copy}
        onClick={async () => {
          const ok = await copyToClipboard(subject)
          toast(ok ? { title: 'Subject copied', tone: 'success' } : { title: 'Could not copy the subject', tone: 'danger' })
        }}
      >
        Copy subject
      </Button>
    </div>
  )
}

export interface TickRow {
  id: string
  label: ReactNode
  /** Small print under the label ("item 2 · 3 nos"). */
  sub?: ReactNode
  checked: boolean
  /** A row that is shown but cannot be ticked (an item this supplier already priced). */
  disabled?: boolean
  /** Right-hand note ("priced 25 Nov"). */
  note?: ReactNode
}

/** "Questions in this message / Untick to leave one out": every row ticked by default. */
export function TickList({ title, hint = 'Untick to leave one out', rows, onToggle }: { title: string; hint?: string; rows: readonly TickRow[]; onToggle: (id: string, on: boolean) => void }) {
  return (
    <section aria-label={title} className="grid gap-2 border-b px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-xs text-fg-muted">{hint}</span>
      </div>
      <ul className="grid gap-2">
        {rows.map(r => (
          <li key={r.id} className={cn('flex items-start justify-between gap-3', r.disabled && 'text-fg-muted')}>
            <Checkbox
              checked={r.checked}
              disabled={r.disabled}
              onCheckedChange={v => onToggle(r.id, v === true)}
              label={r.label}
              help={r.sub}
            />
            {r.note ? <span className="num shrink-0 text-xs text-fg-muted">{r.note}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** "Kindly confirm by [Mon 30 Nov]  One working day before the bid is due. You can change it." */
export function ReplyByField({ label, value, onChange, note }: { label: string; value: string; onChange: (v: string) => void; note: string }) {
  return (
    <div className="grid gap-1 border-b px-4 py-3 sm:grid-cols-[auto_12rem_minmax(0,1fr)] sm:items-center sm:gap-3">
      <span className="text-sm font-medium">{label}</span>
      <DateInput value={value} onChange={onChange} defaultToday={false} aria-label={label} />
      <span className="text-xs text-fg-muted">{note}</span>
    </div>
  )
}

/** The hourglass line under the text: what copying records and where the item goes. */
export function ChaseNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 px-4 py-2 text-xs text-fg-muted', className)}>
      <Icon icon={Hourglass} size="sm" className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  )
}

