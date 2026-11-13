import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * Button (docs/design/INVENTORY.md; D08 section 01; Forest .qb-btn). Variants primary, secondary, quiet, danger. Sizes read
 * the density tokens, so they follow the text size and the pointer: lg 48 (56 on touch), md 40 (48 on touch), sm 36 (48 on
 * touch), touch 44 (phone chrome).
 * States: default, hover, pressed (scale .98), focus (global ring), disabled, busy.
 * Forest: bold labels, 12 px corners (rounded-control). Primary is the forest green fill; secondary a white tile with a strong
 * edge; quiet the ghost (green words, a brand-100 tint on hover); danger an outline in the late red, filled with its tint on
 * hover. On a forest surface (data-surface="navy": the next-step band, the top bar) the green button gets a 2 px white ring,
 * because green on the forest alone is under 3:1 (WCAG 1.4.11 wants 3:1 for its edge).
 */
const button = cva(
  [
    'group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border',
    'font-bold leading-none transition-[background-color,border-color,color,transform] duration-fast ease-out',
    'active:scale-press disabled:cursor-not-allowed disabled:active:transform-none',
  ],
  {
    variants: {
      variant: {
        primary: [
          'border-primary bg-primary text-primary-foreground [[data-surface=navy]_&]:shadow-on-navy',
          'hover:border-primary-hover hover:bg-primary-hover active:border-primary-active active:bg-primary-active',
          'disabled:border-transparent disabled:bg-deep disabled:text-fg-disabled',
        ],
        secondary: [
          'border-line-strong bg-surface text-fg',
          'hover:bg-selected active:bg-selected',
          'disabled:border-transparent disabled:bg-deep disabled:text-fg-disabled',
        ],
        quiet: [
          // Forest ghost: the green words are the affordance (--primary-text, re-inked to white on the forest), a tint on hover.
          'border-transparent bg-transparent text-primary',
          'hover:bg-selected active:bg-selected',
          'disabled:bg-transparent disabled:text-fg-disabled',
        ],
        danger: [
          // On the forest the surface is re-inked dark, so the outline sits on its own tint there (red on the forest is unreadable).
          'border-tone-danger-fg bg-surface text-tone-danger-fg [[data-surface=navy]_&]:bg-tone-danger-bg',
          'hover:bg-tone-danger-bg active:bg-tone-danger-bg',
          'disabled:border-transparent disabled:bg-deep disabled:text-fg-disabled',
        ],
      },
      size: {
        lg: 'h-control-lg px-5 text-base',
        md: 'h-control px-4 text-sm',
        sm: 'h-control-sm px-3 text-xs',
        /** Phone chrome: the 44px minimum tap target (--hit-touch). */
        touch: 'h-touch px-4 text-sm',
      },
      iconOnly: { true: 'px-0', false: '' },
    },
    compoundVariants: [
      { size: 'lg', iconOnly: true, className: 'w-control-lg' },
      { size: 'md', iconOnly: true, className: 'w-control' },
      { size: 'sm', iconOnly: true, className: 'w-control-sm' },
      { size: 'touch', iconOnly: true, className: 'w-touch' },
    ],
    defaultVariants: { variant: 'secondary', size: 'md', iconOnly: false },
  },
)

type Common = Omit<VariantProps<typeof button>, 'iconOnly'> & {
  /** Leading glyph. Muted on secondary and quiet; inherits the text colour on primary and danger. */
  icon?: LucideIcon
  /**
   * The action is in flight: aria-disabled (focus stays), clicks ignored, and shows the spinner (and `busyLabel`, the verb in -ing form).
   * Passing it at all (even false) marks a one-tap action: the repeat click of a double click is dropped, and so is any click while
   * the promise an onClick returns is still running.
   */
  busy?: boolean
  busyLabel?: ReactNode
}

type Labelled = Common & { children: ReactNode; 'aria-label'?: string }
/** An icon-only button must say what it does. */
type IconOnly = Common & { icon: LucideIcon; children?: never; 'aria-label': string }

export type ButtonProps = (Labelled | IconOnly) &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, busy: busyProp, busyLabel, className, children, disabled, type = 'button', onClick, ...rest },
  ref,
) {
  const busy = busyProp ?? false
  // HW-15: an action button (one that has a busy state) runs once per press. The second click of a double click (or double tap)
  // arrives before React re-renders with busy, so it is dropped here: by its click count, and while a returned promise is in flight.
  const inFlight = useRef(false)
  const action = busyProp !== undefined
  // Busy keeps focus (WCAG 2.4.3): aria-disabled instead of disabled, and clicks are ignored while in flight.
  const iconOnly = children === undefined || children === null
  const glyph = variant === undefined || variant === null || variant === 'secondary' ? 'text-fg-muted group-disabled:text-fg-disabled' : ''
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled && !busy}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className={cn(button({ variant, size, iconOnly }), busy && 'cursor-progress active:transform-none', className)}
      {...rest}
      onClick={e => {
        if (busy || (action && (inFlight.current || e.detail > 1))) {
          e.preventDefault()
          return
        }
        const result = onClick?.(e) as unknown
        if (result instanceof Promise) {
          inFlight.current = true
          const release = () => {
            inFlight.current = false
          }
          result.then(release, release)
        }
      }}
    >
      {busy ? (
        <Icon icon={LoaderCircle} className="animate-spin motion-reduce:animate-none" />
      ) : icon ? (
        <Icon icon={icon} className={glyph} />
      ) : null}
      {iconOnly ? null : busy && busyLabel ? busyLabel : children}
    </button>
  )
})
