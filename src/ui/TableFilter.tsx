import type { KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { TextField } from '@/ui/form/TextField'

/*
 * TableFilter (components-06 toolbar): the text filter that goes in a DataTable toolbar. 220px wide, a search glyph
 * inside the field. DataTable's `/` key focuses the field marked data-table-filter, and Esc here clears it (a second
 * Esc, with nothing left to clear, leaves the field).
 */
export function TableFilter({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string
  onChange: (next: string) => void
  /** Names the field ("Filter RFQs"). Also the placeholder unless one is given. */
  label: string
  placeholder?: string
  className?: string
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (value !== '') {
      e.preventDefault()
      onChange('')
    } else e.currentTarget.blur()
  }
  return (
    <div className={cn('relative w-[220px] max-sm:w-full', className)}>
      <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
      <TextField
        data-table-filter=""
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        className="pl-8"
      />
    </div>
  )
}
