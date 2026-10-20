import { useId, type ReactNode } from 'react'
import { CircleAlert, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FieldContext } from '@/ui/form/fieldContext'
import { Icon } from '@/ui/Icon'

/*
 * Field (INVENTORY: U07; D08 section 04). Label, requirement hint, control, help,
 * error line and, for a pre-filled value, where that value came from.
 *
 * FE-2: a pre-filled value says where it came from, in the same place every time
 * ("Today", "from PO-26-0009", "Balance due on ORD-0038"). Once the person types
 * over it the note becomes "Typed by you" so nobody mistakes a guess for a record.
 *
 * Controls (TextField, NumberInput, Select, ...) read their id, aria-invalid and
 * aria-describedby from the surrounding Field, so a label always names its control.
 */
/** Where a pre-filled value came from. `plain` drops the glyph (for "Today"). */
export type FieldSource = string | { label: string; plain?: boolean }

interface FieldProps {
  label: ReactNode
  /** "Required" or "Optional" after the label. Leave off when every field is required and the form says so once. */
  requirement?: 'required' | 'optional'
  help?: ReactNode
  /** The message for this field only. A string, or a node when it carries a link ("Open it"). */
  error?: ReactNode
  source?: FieldSource
  /** The person has changed a pre-filled value: the note reads "Typed by you". */
  edited?: boolean
  /** Share a row with other fields: the field label sits above the control and shrinks to fit. */
  className?: string
  children: ReactNode
  id?: string
}

export function Field({ label, requirement, help, error, source, edited = false, className, children, id: idProp }: FieldProps) {
  const auto = useId()
  const id = idProp ?? auto
  const helpId = help ? `${id}-help` : undefined
  const errId = error ? `${id}-err` : undefined
  const srcId = source ? `${id}-src` : undefined
  const describedBy = [errId, srcId, helpId].filter(Boolean).join(' ') || undefined
  return (
    <FieldContext.Provider value={{ id, invalid: Boolean(error), describedBy, required: requirement === 'required' }}>
      <div className={cn('grid min-w-0 content-start gap-[6px]', className)}>
        <div className="flex items-baseline gap-2">
          <label htmlFor={id} className="text-sm font-medium text-fg">
            {label}
          </label>
          {requirement ? (
            <span className="text-xs font-regular text-fg-muted">{requirement === 'required' ? 'Required' : 'Optional'}</span>
          ) : null}
        </div>
        {children}
        {error ? (
          <p id={errId} className="flex items-start gap-[6px] text-xs font-medium text-tone-danger-fg">
            <Icon icon={CircleAlert} size="sm" className="mt-[calc((var(--lh-xs)-14px)/2)]" />
            <span className="min-w-0 text-pretty">{error}</span>
          </p>
        ) : null}
        {source ? <SourceNote id={srcId} source={source} edited={edited} /> : null}
        {help ? (
          <p id={helpId} className="text-xs text-fg-muted">
            {help}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

/** "from PO-26-0009", "Today", "Balance due on ORD-0038": the origin of a pre-filled value. */
export function SourceNote({ source, edited = false, id }: { source: FieldSource; edited?: boolean; id?: string }) {
  const { label, plain } = typeof source === 'string' ? { label: source, plain: false } : source
  const shown = edited ? 'Typed by you' : label
  return (
    <span id={id} data-source={edited ? 'typed' : 'prefill'} className="inline-flex items-center gap-[5px] text-xs text-fg-2">
      {edited || plain ? null : <Icon icon={History} size="chip" className="text-fg-muted" />}
      {shown}
    </span>
  )
}
