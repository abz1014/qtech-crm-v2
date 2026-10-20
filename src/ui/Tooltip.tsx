import { useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { Kbd } from '@/ui/Kbd'

/*
 * Tooltip (INVENTORY: U03; D08 section 10). Short, optional, never the only place
 * something is said. Ink tone, shadow-pop, no arrow, 260px max. Opens after 400 ms
 * of hover or at once on keyboard focus; closes on Esc, blur or leaving.
 * Phones have no hover: put the text on screen instead.
 */
interface TooltipProps {
  /** One short sentence or label. */
  content: ReactNode
  /** Two-line form: a semibold title above `content`. */
  title?: ReactNode
  /** Shortcut keys shown after the label ("C", or ["⌘", "↵"]). */
  shortcut?: string | string[]
  /** The element that is described. A single element that takes a ref. */
  children: ReactElement
  /** Wrap a disabled control so the tooltip (and keyboard focus) still reach it: a disabled button never fires hover. */
  forDisabled?: boolean
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ content, title, shortcut, children, forDisabled = false, side = 'bottom' }: TooltipProps) {
  const keys = shortcut === undefined ? [] : Array.isArray(shortcut) ? shortcut : [shortcut]
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={150}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          {forDisabled ? (
            <span tabIndex={0} className="inline-flex rounded">
              {children}
            </span>
          ) : (
            children
          )}
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-50 max-w-[300px] animate-fade-in rounded bg-tone-ink-bg px-[10px] py-[6px] text-xs text-tone-ink-fg shadow-pop"
          >
            {title ? (
              <div className="grid gap-[2px]">
                <b className="font-semibold">{title}</b>
                <span className="text-pretty">{content}</span>
                {keys.length ? <KeyRow keys={keys} /> : null}
              </div>
            ) : (
              <span className="flex items-center gap-2 font-medium text-pretty">
                {content}
                {keys.length ? <KeyRow keys={keys} /> : null}
              </span>
            )}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}

function KeyRow({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-1">
      {keys.map(k => (
        <Kbd key={k} size="inline" className="border-tone-ink-fg/30 bg-transparent text-tone-ink-fg">
          {k}
        </Kbd>
      ))}
    </span>
  )
}

/*
 * TruncateTip (components-10 "Long label, revealed"; DataTable cells with a fixed width): text that truncates with an
 * ellipsis and shows the full text in a tooltip on hover, but only when it is actually cut off. The tooltip text is the
 * element's own text, so pass plain text as children. The full text is also what a screen reader reads (nothing is removed).
 */
export function TruncateTip({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={150}>
      <RadixTooltip.Root
        open={open}
        onOpenChange={next => {
          const el = ref.current
          if (next && el && el.scrollWidth > el.clientWidth) {
            setText(el.textContent ?? '')
            setOpen(true)
          } else setOpen(false)
        }}
      >
        <RadixTooltip.Trigger asChild>
          <span ref={ref} data-truncate="" style={style} className={cn('block truncate', className)}>
            {children}
          </span>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="bottom"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 max-w-[300px] animate-fade-in rounded bg-tone-ink-bg px-[10px] py-[6px] text-xs font-medium text-tone-ink-fg shadow-pop"
          >
            {text}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
