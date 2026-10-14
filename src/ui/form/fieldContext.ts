import { createContext, useContext, type AriaAttributes } from 'react'
import { cn } from '@/lib/utils'

// Field context, shared control chrome and the hook controls use to read them (kept apart from Field.tsx so that file only exports components).
export interface FieldContextValue {
  id: string
  invalid: boolean
  describedBy: string | undefined
}
export const FieldContext = createContext<FieldContextValue | null>(null)
export const useFieldContext = () => useContext(FieldContext)

/** Shared control chrome: 32 tall (40 on touch), hairline input edge, focus ring from the global rule. */
export const controlClass = cn(
  'h-control w-full min-w-0 rounded border border-line-input bg-surface px-3 text-sm text-fg',
  'transition-colors duration-fast ease-out placeholder:text-fg-muted hover:border-fg-muted',
  'focus-visible:border-fg focus-visible:outline-offset-1',
  'aria-[invalid=true]:border-tone-danger-fg',
  'disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-fg-disabled disabled:hover:border-line',
  'read-only:border-line-strong read-only:bg-sunken read-only:text-fg-2 read-only:hover:border-line-strong',
)

/** Props every control takes from the surrounding Field unless it was given its own. */
export function useControlProps(own: Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> & { id?: string }) {
  const f = useFieldContext()
  return {
    id: own.id ?? f?.id,
    'aria-invalid': own['aria-invalid'] ?? (f?.invalid ? true : undefined),
    'aria-describedby': own['aria-describedby'] ?? f?.describedBy,
  } as const
}
