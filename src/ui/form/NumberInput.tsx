import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { formatAmount, parseAmount } from '@/lib/number'
import { controlClass, useControlProps } from '@/ui/form/fieldContext'
import { Adorned } from '@/ui/form/TextField'

/*
 * NumberInput (INVENTORY: U07 as TextField `numeric`; D08 section 01). Mono,
 * tabular, right aligned. The value is a number (or null when empty or not a
 * number), the text is whatever is being typed. While typing nothing is
 * reformatted; on blur the text is grouped in thousands (1,600,764; 278.40 with
 * `decimals={2}`). Focus selects the text so a pre-filled amount is one keystroke
 * to replace. Works with RHF's Controller: `<NumberInput {...field} />`.
 */
type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'prefix' | 'defaultValue'>

interface NumberInputProps extends Base {
  value: number | null | undefined
  onChange: (value: number | null) => void
  /** Fixed decimal places on blur (2 for rates). Default: up to 2, only when present. */
  decimals?: number
  prefix?: ReactNode
  suffix?: ReactNode
  /** Smallest allowed value; typing below it reports null so validation can speak. Not enforced by the browser. */
  min?: number
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onChange, onBlur, onFocus, decimals, prefix, suffix, className, min, ...rest },
  ref,
) {
  const a11y = useControlProps(rest)
  const [text, setText] = useState(() => formatAmount(value, decimals))
  const [focused, setFocused] = useState(false)

  // Follow outside changes (form reset, a pre-fill arriving) but never rewrite what is being typed.
  useEffect(() => {
    if (focused) return
    setText(formatAmount(value, decimals))
  }, [value, decimals, focused])

  return (
    <Adorned prefix={prefix} suffix={suffix}>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        {...rest}
        {...a11y}
        value={text}
        onFocus={e => {
          setFocused(true)
          setText(text.replace(/,/g, ''))
          const el = e.currentTarget
          requestAnimationFrame(() => el.select?.())
          onFocus?.(e)
        }}
        onChange={e => {
          const next = e.target.value
          setText(next)
          const n = parseAmount(next)
          onChange(n !== null && min !== undefined && n < min ? null : n)
        }}
        onBlur={e => {
          setFocused(false)
          const n = parseAmount(text)
          if (n !== null) setText(formatAmount(n, decimals))
          onBlur?.(e)
        }}
        className={cn(
          controlClass,
          'num text-right',
          prefix && 'rounded-l-none',
          suffix && 'rounded-r-none',
          (prefix || suffix) && 'w-auto',
          className,
        )}
      />
    </Adorned>
  )
})
