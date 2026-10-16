import type { ReactNode } from 'react'
import { CircleCheck, CloudOff, Lock, Search, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * EmptyState (D08 section 09, components-09): what is true, and what happens next. Moods:
 *   goal     the work is done (success tile, circle-check)
 *   neutral  first use or a filter matched nothing (grey tile; pass `icon` for first use)
 *   warning  not available to this role: says what is missing and who can change it (warning tile, lock)
 *   error    could not load (danger tile, speaks as an alert)
 * `bordered` draws the card the mockup shows when the state stands on its own (a panel or a page):
 * solid for the goal state, dashed for the rest, 260px tall. Inside a table body or a list pane the
 * container already has its edge, so leave it off. `bordered="solid"` or "dashed" overrides the default.
 */
type Mood = 'goal' | 'neutral' | 'warning' | 'error'
const MOOD: Record<Mood, { icon: LucideIcon; tile: string }> = {
  goal: { icon: CircleCheck, tile: 'bg-tone-success-bg text-tone-success-fg' },
  neutral: { icon: Search, tile: 'bg-selected text-fg-2' },
  warning: { icon: Lock, tile: 'bg-tone-warning-bg text-tone-warning-fg' },
  error: { icon: CloudOff, tile: 'bg-tone-danger-bg text-tone-danger-fg' },
}

interface EmptyStateProps {
  mood?: Mood
  icon?: LucideIcon
  title: ReactNode
  /** One or two lines: why it is empty and what happens next. */
  children?: ReactNode
  /** At most two actions. */
  actions?: ReactNode
  /** Small print under the actions (request reference on errors). */
  meta?: ReactNode
  /** The standalone card: true (solid for goal, dashed otherwise), or force 'solid' or 'dashed'. */
  bordered?: boolean | 'solid' | 'dashed'
  className?: string
}

export function EmptyState({ mood = 'neutral', icon, title, children, actions, meta, bordered, className }: EmptyStateProps) {
  const m = MOOD[mood]
  const edge = bordered === true ? (mood === 'goal' ? 'solid' : 'dashed') : bordered
  return (
    <div
      role={mood === 'error' ? 'alert' : undefined}
      data-mood={mood}
      className={cn(
        'grid justify-items-center gap-3 text-center',
        edge ? 'min-h-[260px] content-center rounded bg-surface px-6 py-10' : 'px-6 py-10',
        edge === 'solid' && 'border',
        edge === 'dashed' && 'border border-dashed border-line-strong',
        className,
      )}
    >
      <span className={cn('grid size-10 place-items-center rounded', m.tile)}>
        <Icon icon={icon ?? m.icon} size="xl" />
      </span>
      <p className="text-balance text-lg font-semibold tracking-snug">{title}</p>
      {children ? <p className="max-w-[46ch] text-pretty text-sm text-fg-muted">{children}</p> : null}
      {actions ? <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div> : null}
      {meta ? <p className="text-xs text-fg-muted">{meta}</p> : null}
    </div>
  )
}
