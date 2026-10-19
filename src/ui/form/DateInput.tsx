import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { CalendarDays } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDateText, parseDateText } from '@/lib/dateInput'
import { cn } from '@/lib/utils'
import { controlClass, useControlProps } from '@/ui/form/fieldContext'
import { Icon } from '@/ui/Icon'

/*
 * DateInput (INVENTORY: U07; g2-money record payment). A text field that shows
 * the date as "Fri 27 Nov 2026" (mono, so columns of dates line up) and accepts
 * it typed, day-first: 27 nov, 27/11, 27/11/2026, today, yesterday. The value is
 * YYYY-MM-DD in the business timezone (Asia/Karachi). Enter or leaving the field
 * reads what was typed; if it is not a date the text stays, the field is marked
 * invalid and the value is empty so the form's own "Choose a date" message speaks.
 *
 * The calendar button opens the browser's own date picker from a hidden native
 * date input (the best picker on a phone, nothing to rebuild); it is a
 * convenience, the typed path is the primary one.
 *
 * FE-2: defaults to today. When it mounts empty and `defaultToday` is on it
 * fills in today's business date and reports it. Seed the form's defaultValues
 * with businessToday() so the field is not "dirty" before anyone touches it.
 */
interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string | null | undefined
  onChange: (value: string) => void
  defaultToday?: boolean
}

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, defaultToday = true, className, onBlur, onFocus, onKeyDown, disabled, readOnly, ...rest },
  ref,
) {
  const a11y = useControlProps(rest)
  const picker = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(() => formatDateText(value))
  const [editing, setEditing] = useState(false)
  const [unreadable, setUnreadable] = useState(false)

  useEffect(() => {
    if (defaultToday && !value) onChange(businessToday())
    // only on mount: clearing the field afterwards is the person's choice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow outside changes (reset, a pre-fill arriving), never rewrite what is being typed. Unreadable text stays
  // on screen only until the value changes from outside (the '' this field reported for it is not a change).
  const reported = useRef(value ?? '')
  const report = (v: string) => {
    reported.current = v
    onChange(v)
  }
  useEffect(() => {
    if (editing) return
    const v = value ?? ''
    if (unreadable && v === reported.current) return
    reported.current = v
    setUnreadable(false)
    setText(formatDateText(value))
  }, [value, editing, unreadable])

  const commit = () => {
    const t = text.trim()
    if (t === '') {
      setUnreadable(false)
      report('')
      return
    }
    const parsed = parseDateText(t, businessToday())
    if (parsed) {
      setUnreadable(false)
      setText(formatDateText(parsed))
      report(parsed)
    } else {
      setUnreadable(true)
      report('')
    }
  }

  const openPicker = () => {
    const el = picker.current
    if (!el) return
    el.value = value ?? ''
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.click()
  }

  return (
    <div className="relative min-w-0">
      <input
        ref={ref}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="e.g. 27 nov, 27/11, today"
        {...rest}
        {...a11y}
        aria-invalid={unreadable ? true : a11y['aria-invalid']}
        disabled={disabled}
        readOnly={readOnly}
        value={text}
        onFocus={e => {
          setEditing(true)
          e.currentTarget.select()
          onFocus?.(e)
        }}
        onChange={e => {
          setText(e.target.value)
          setUnreadable(false)
        }}
        onKeyDown={e => {
          onKeyDown?.(e)
          // reading the text first means Enter submits the date that is on screen
          if (e.key === 'Enter') commit()
        }}
        onBlur={e => {
          setEditing(false)
          commit()
          onBlur?.(e)
        }}
        className={cn(controlClass, 'num pr-10', className)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Choose date from calendar"
        disabled={disabled || readOnly}
        onClick={openPicker}
        className="absolute right-[2px] top-1/2 grid size-[28px] -translate-y-1/2 place-items-center rounded text-fg-muted transition-colors duration-fast ease-out hover:bg-sunken hover:text-fg disabled:text-fg-disabled disabled:hover:bg-transparent"
      >
        <Icon icon={CalendarDays} />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-full h-0 w-0 opacity-0"
        onChange={e => {
          if (!e.target.value) return
          setUnreadable(false)
          setText(formatDateText(e.target.value))
          report(e.target.value)
        }}
      />
    </div>
  )
})
