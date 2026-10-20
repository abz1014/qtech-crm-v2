import { useEffect, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { formatDay, formatShortDate } from '@/lib/formatDay'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { DateInput } from '@/ui/form/DateInput'
import { TextField } from '@/ui/form/TextField'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/*
 * Edit on tap (A3/O03): a stamped date or a short text reads as plain text, and tapping it opens a small editor. Nothing here is
 * required: the one-tap stamp buttons write the dates, and this is only for fixing one.
 */
const trigger =
  'num inline-flex min-h-[28px] items-center rounded border-b border-dashed border-line-strong px-[2px] text-left text-sm text-fg hover:bg-sunken disabled:cursor-default disabled:border-transparent disabled:hover:bg-transparent'

interface TapDateProps {
  value: string | null
  /** Names the date for assistive tech and the editor ("Placed date, Alpenmark Controls"). */
  label: string
  today: string
  onSave: (value: string | null) => void | Promise<void>
  disabled?: boolean
  /** Draw a labelled Button instead of the date text (the engineer's "Change planned date"). */
  button?: { text: string; icon: LucideIcon }
  /** Muted text for an empty date. */
  empty?: string
}

export function TapDate({ value, label, today, onSave, disabled, button, empty = '—' }: TapDateProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setDraft(value ?? '')
  }, [open, value])

  const save = async (next: string | null) => {
    setBusy(true)
    try {
      await onSave(next)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }
  const aria = `${label}: ${value ? formatDay(value) : 'not set'}. Edit`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {button ? (
          <Button icon={button.icon} disabled={disabled}>
            {button.text}
          </Button>
        ) : (
          <button type="button" className={cn(trigger, !value && 'text-fg-muted')} aria-label={aria} disabled={disabled}>
            {value ? formatShortDate(value, today) : empty}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[280px]" aria-label={label}>
        <div className="grid gap-3">
          <p className="text-sm font-medium">{label}</p>
          <DateInput value={draft} onChange={setDraft} defaultToday={false} aria-label={label} />
          <div className="flex flex-wrap justify-end gap-2">
            {value ? (
              <Button size="sm" onClick={() => void save(null)} disabled={busy}>
                Clear
              </Button>
            ) : null}
            <Button size="sm" variant="primary" onClick={() => void save(draft)} disabled={busy || !draft || draft === value} busy={busy} busyLabel="Saving">
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface TapTextProps {
  value: string | null
  label: string
  /** What an empty value reads as, and the tap target ("Add reference"). */
  empty: string
  render?: (value: string) => ReactNode
  onSave: (value: string | null) => void | Promise<void>
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function TapText({ value, label, empty, render, onSave, disabled, placeholder, className }: TapTextProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setDraft(value ?? '')
  }, [open, value])
  const save = async () => {
    setBusy(true)
    try {
      await onSave(draft.trim() || null)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }
  if (disabled) return <span className={className}>{value ? (render ? render(value) : value) : null}</span>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn('inline-flex min-h-[28px] items-center rounded text-left text-sm underline-offset-2 hover:underline', value ? 'text-fg' : 'text-primary', className)}>
          {/* the visible words stay inside the accessible name (WCAG 2.5.3): the label is added before them, not instead of them */}
          <span className="sr-only">{label}: </span>
          {value ? (render ? render(value) : value) : empty}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px]" aria-label={label}>
        <form
          className="grid gap-3"
          onSubmit={e => {
            e.preventDefault()
            void save()
          }}
        >
          <p className="text-sm font-medium">{label}</p>
          <TextField value={draft} onChange={e => setDraft(e.target.value)} placeholder={placeholder} aria-label={label} autoComplete="off" />
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="primary" busy={busy} busyLabel="Saving" disabled={busy || draft.trim() === (value ?? '')}>
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
