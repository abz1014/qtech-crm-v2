import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { amountProblem, beyondPaisa, formatAmount, paisaProblem, parseAmount } from '@/lib/number'
import { controlClass, useControlProps, useFieldContext } from '@/ui/form/fieldContext'
import { Adorned } from '@/ui/form/TextField'

/*
 * NumberInput (INVENTORY: U07 as TextField `numeric`; D08 section 01). Mono,
 * tabular, right aligned. The value is a number (or null when empty or not a
 * number), the text is whatever is being typed. While typing nothing is
 * reformatted; on blur the text is grouped in thousands (1,600,764; 278.40 with
 * `decimals={2}`). A pre-filled amount keeps its grouping on focus and is
 * selected, so typing replaces it in one keystroke; the commas only go if the
 * person edits inside the number. Works with RHF's Controller: `<NumberInput {...field} />`.
 *
 * Leaving the box never hides digits: 0.125 stays 0.125 rather than showing as 0.13. An amount of money (`money`) is
 * kept to the paisa: 100.555 becomes 100.56 with a note that it was rounded, and 0.001 is refused (it is 0.00).
 * Inside a Field the reason text is refused goes on the Field's own error line, so the field says one thing only.
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
  /** An amount of money: kept to 2 decimals (rounded on blur, with a note), and below 0.01 refused with a reason. */
  money?: boolean
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onChange, onBlur, onFocus, decimals, prefix, suffix, className, min, money = false, ...rest },
  ref,
) {
  const a11y = useControlProps(rest)
  const fieldCtx = useFieldContext()
  const reportProblem = fieldCtx?.reportProblem
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
  // leaves the box, instead of being stored as some other number. It stays said until the text changes, so a submit
  // that puts focus back in the box (to fix it) does not hide the reason.
  const [left, setLeft] = useState(true)
  const problem = left ? (amountProblem(text) ?? (money ? paisaProblem(parseAmount(text)) : null)) : null
  const problemId = `${useId()}-problem`
  const noteId = `${useId()}-note`
  const [rounded, setRounded] = useState(false)
  // In a Field the reason goes on the Field's error line (one message, also in the form summary), else under the box.
  useEffect(() => {
    reportProblem?.(problem)
  }, [reportProblem, problem])
  useEffect(() => () => reportProblem?.(null), [reportProblem])
  const ownProblem = problem && !reportProblem ? problem : null
  const report = (n: number | null) => {
    const out = n !== null && min !== undefined && n < min ? null : n
    reported.current = { value: out, decimals }
    onChange(out)
  }

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
        {...(problem || rounded
          ? {
              'aria-invalid': problem ? true : a11y['aria-invalid'],
              'aria-describedby':
                [a11y['aria-describedby'], ownProblem ? problemId : null, rounded ? noteId : null].filter(Boolean).join(' ') || undefined,
            }
          : {})}
        value={text}
        onFocus={e => {
          setFocused(true)
          onFocus?.(e)
        }}
        onChange={e => {
          const next = e.target.value
          setText(next)
          setLeft(false)
          setRounded(false)
          report(parseAmount(next))
        }}
        onBlur={e => {
          setFocused(false)
          setLeft(true)
          const n = parseAmount(text)
          if (n !== null) {
            const extra = money ? beyondPaisa(n) : null
            if (extra?.rounded != null) {
              // 100.555 is stored as 100.56: show and report that, and say so
              setText(formatAmount(extra.rounded, decimals))
              setRounded(true)
              report(extra.rounded)
            } else if (!extra) {
              const shown = formatAmount(n, decimals)
              // never hide digits that were typed (0.125 is not 0.13); the grouping is only for reading
              if (parseAmount(shown) === n) setText(shown)
            }
          }
          onBlur?.(e)
        }}
        className={cn(
          controlClass,
          'num text-right',
          prefix && 'rounded-l-none',
          suffix && 'rounded-r-none',
          className,
        )}
      />
    </Adorned>
    {ownProblem ? (
      <p id={problemId} role="alert" className="mt-1 text-sm text-tone-danger-fg">
        {ownProblem}
      </p>
    ) : null}
    {rounded && !problem ? (
      <p id={noteId} className="text-xs text-fg-muted">
        Rounded to 2 decimals.
      </p>
    ) : null}
    </>
  )
})
