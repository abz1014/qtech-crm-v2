import type { ReactNode } from 'react'
import { CircleCheck, CloudOff, Search, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * EmptyState (D08 section 09): what is true, and what happens next. Three moods:
 * goal (the work is done), neutral (a filter matched nothing), error (could not load).
 */
type Mood = 'goal' | 'neutral' | 'error'
const MOOD: Record<Mood, { icon: LucideIcon; tile: string }> = {
  goal: { icon: CircleCheck, tile: 'bg-tone-success-bg text-tone-success-fg' },
  neutral: { icon: Search, tile: 'bg-sunken text-fg-muted' },
  error: { icon: CloudOff, tile: 'bg-tone-danger-bg text-tone-danger-fg' },
}

interface EmptyStateProps {
  mood?: Mood
  icon?: LucideIcon
  title: ReactNode
  /** One or two lines: why it is empty and what happens next. */
  children?: ReactNode
  actions?: ReactNode
  /** Small print under the actions (request reference on errors). */
  meta?: ReactNode
  className?: string
}

export function EmptyState({ mood = 'neutral', icon, title, children, actions, meta, className }: EmptyStateProps) {
  const m = MOOD[mood]
  return (
    <div
      role={mood === 'error' ? 'alert' : undefined}
      className={cn('grid justify-items-center gap-3 px-6 py-10 text-center', className)}
    >
      <span className={cn('grid size-10 place-items-center rounded', m.tile)}>
        <Icon icon={icon ?? m.icon} size="xl" />
      </span>
      <p className="text-lg font-semibold tracking-snug">{title}</p>
      {children ? <p className="max-w-prose text-sm text-fg-muted">{children}</p> : null}
      {actions ? <div className="flex flex-wrap justify-center gap-2">{actions}</div> : null}
      {meta ? <p className="num text-xs text-fg-muted">{meta}</p> : null}
    </div>
  )
}
