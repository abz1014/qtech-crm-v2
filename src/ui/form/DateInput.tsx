import { forwardRef, useEffect, type InputHTMLAttributes } from 'react'
import { businessToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { controlClass, useControlProps } from '@/ui/form/fieldContext'

/*
 * DateInput (INVENTORY: U07). A native date field: the browser's picker and its
 * keyboard editing (type the digits, arrow keys step, the calendar on phones),
 * set in mono. The value is a YYYY-MM-DD string in the business timezone
 * (Asia/Karachi), never a UTC date.
 *
 * FE-2: it defaults to today. When it mounts empty and `defaultToday` is on
 * (the default) it fills in today's business date and reports it, so a form that
 * only needs "today" needs no touch. Pair it with `source="Today"` on the Field.
 * Turn `defaultToday` off for a date that may truly be unknown (a due date).
 */
interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string | null | undefined
  onChange: (value: string) => void
  defaultToday?: boolean
}

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, defaultToday = true, className, ...rest },
  ref,
) {
  const a11y = useControlProps(rest)
  useEffect(() => {
    if (defaultToday && !value) onChange(businessToday())
    // only on mount: clearing the field afterwards is the person's choice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <input
      ref={ref}
      type="date"
      {...rest}
      {...a11y}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className={cn(controlClass, 'num', className)}
    />
  )
})
