import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { controlClass, useControlProps } from '@/ui/form/fieldContext'

/*
 * TextField and TextArea (INVENTORY: U07; D08 section 01). States: default, hover,
 * focus, filled, invalid (via the Field's error), disabled, read only. An optional
 * prefix/suffix adornment ("PKR per USD") sits attached inside the border.
 */
export interface Adornment {
  prefix?: ReactNode
  suffix?: ReactNode
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & Adornment

export function Adorned({ prefix, suffix, children, className }: Adornment & { children: ReactNode; className?: string }) {
  if (!prefix && !suffix) return <>{children}</>
  const cap = 'inline-flex shrink-0 items-center border-line-input bg-sunken px-3 text-sm text-fg-muted'
  return (
    <div className={cn('flex min-w-0 items-stretch [&_input]:min-w-0 [&_input]:flex-1', className)}>
      {prefix ? <span className={cn(cap, 'rounded-l border border-r-0')}>{prefix}</span> : null}
      {children}
      {suffix ? <span className={cn(cap, 'rounded-r border border-l-0')}>{suffix}</span> : null}
    </div>
  )
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { prefix, suffix, className, type = 'text', ...rest },
  ref,
) {
  const a11y = useControlProps(rest)
  const hasAdorn = Boolean(prefix || suffix)
  return (
    <Adorned prefix={prefix} suffix={suffix}>
      <input
        ref={ref}
        type={type}
        {...rest}
        {...a11y}
        className={cn(controlClass, prefix && 'rounded-l-none', suffix && 'rounded-r-none', hasAdorn && 'w-auto', className)}
      />
    </Adorned>
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, rows = 3, ...rest },
  ref,
) {
  const a11y = useControlProps(rest)
  return <textarea ref={ref} rows={rows} {...rest} {...a11y} className={cn(controlClass, 'h-auto min-h-[80px] resize-y py-2 leading-5', className)} />
})
