import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { amountProblem, formatAmount, parseAmount } from '@/lib/number'
import { controlClass, useControlProps } from '@/ui/form/fieldContext'
import { Adorned } from '@/ui/form/TextField'

/*
 * NumberInput (INVENTORY: U07 as TextField `numeric`; D08 section 01). Mono,
 * tabular, right aligned. The value is a number (or null when empty or not a
 * number), the text is whatever is being typed. While typing nothing is
 * reformatted; on blur the text is grouped in thousands (1,600,764; 278.40 with
 * `decimals={2}`). A pre-filled amount keeps its grouping on focus and is
 * selected, so typing replaces it in one keystroke; the commas only go if the
 * person edits inside the number. Works with RHF's Controller: `<NumberInput {...field} />`.
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
  const inner = useRef<HTMLInputElement | null>(null)

  // Focus selects the whole amount, after the raw text is in place and before the next keystroke.
  useLayoutEffect(() => {
    if (focused) inner.current?.select()
  }, [focused])

  // Follow outside changes (form reset, a pre-fill arriving) but never rewrite what is being typed, and never
  // echo our own report back: text that reported null (junk, or below `min`) stays on screen after blur.
  const reported = useRef<{ value: number | null; decimals: number | undefined }>({ value: value ?? null, decimals })
  useEffect(() => {
    if (focused) return
    const v = value ?? null
    if (v === reported.current.value && decimals === reported.current.decimals) return
    reported.current = { value: v, decimals }
    setText(formatAmount(value, decimals))
  }, [value, decimals, focused])

  // HW-1: text that is not read as an amount ("12,3456", "PKR 1,200/-", 22 digits) is refused, and says why once the person
  // leaves the box, instead of being stored as some other number.
  const problem = focused ? null : amountProblem(text)
  const problemId = `${useId()}-problem`

  return (
    <>
    <Adorned prefix={prefix} suffix={suffix}>
      <input
        ref={node => {
          inner.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        {...rest}
        {...a11y}
        {...(problem
          ? { 'aria-invalid': true, 'aria-describedby': [a11y['aria-describedby'], problemId].filter(Boolean).join(' ') }
          : {})}
        value={text}
        onFocus={e => {
          setFocused(true)
          onFocus?.(e)
        }}
        onChange={e => {
          const next = e.target.value
          setText(next)
          const n = parseAmount(next)
          const out = n !== null && min !== undefined && n < min ? null : n
          reported.current = { value: out, decimals }
          onChange(out)
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
    {problem ? (
      <p id={problemId} role="alert" className="mt-1 text-sm text-tone-danger-fg">
        {problem}
      </p>
    ) : null}
    </>
  )
})
