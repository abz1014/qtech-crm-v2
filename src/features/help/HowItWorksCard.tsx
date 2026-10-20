import { useId, useState } from 'react'
import { ChevronDown, CircleHelp, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { howItWorksFor, howItWorksKey } from '@/features/help/howItWorks'
import { InlineMarkdown } from '@/features/help/RecipeText'
import { useDismissed } from '@/features/help/useDismissed'
import { useHelp } from '@/features/help/useHelp'

/*
 * "How this works" (learnability spec 1.3): an optional card above Today's list for someone new. Never a modal, never in
 * the way. Desktop and tablet: a short card with the role's 3 to 5 steps, each with "Show me" (opens that recipe in Help).
 * Phone: one collapsed row, "New here? How Q-Tech CRM works · 4 steps", that opens on tap, so the list does not move down.
 * "Got it" hides it for this person on this device (localStorage qtech.howItWorks.<id>); Help offers it again.
 * It also stays hidden once the person is no longer new: 14 days after `since` (users.created_at), when the caller has it.
 */
export interface HowItWorksCardProps {
  userId: string
  role: string
  /** When the person was added (ISO date or timestamp). After NEW_FOR_DAYS the card is not shown. */
  since?: string | null
  /** For tests and the gallery: today's date. */
  now?: Date
  className?: string
}

export const NEW_FOR_DAYS = 14

export function HowItWorksCard({ userId, role, since, now, className }: HowItWorksCardProps) {
  const steps = howItWorksFor(role)
  const [dismissed, setDismissed] = useDismissed(howItWorksKey(userId))
  const wide = useMediaQuery('(min-width: 768px)')
  const [expanded, setExpanded] = useState(false)
  const { openHelp } = useHelp()
  const id = useId()

  const sinceMs = since ? Date.parse(since) : NaN
  const longAgo = Number.isFinite(sinceMs) && (now ?? new Date()).getTime() - sinceMs > NEW_FOR_DAYS * 86_400_000
  if (dismissed || longAgo || steps.length === 0) return null

  const open = wide || expanded
  const titleId = `${id}-title`
  const listId = `${id}-steps`
  return (
    <section aria-labelledby={titleId} className={cn('rounded border bg-surface', className)}>
      {wide ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
          <h2 id={titleId} className="flex flex-1 items-center gap-2 text-base font-semibold">
            <Icon icon={CircleHelp} className="text-fg-muted" />
            How Q-Tech CRM works
          </h2>
          <Button variant="quiet" size="sm" onClick={() => openHelp(null)}>
            Open Help
          </Button>
          <Button size="sm" onClick={() => setDismissed(true)}>
            Got it
          </Button>
        </div>
      ) : (
        <div className="flex items-center">
          <h2 id={titleId} className="min-w-0 flex-1">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded(e => !e)}
              className="flex min-h-touch w-full items-center gap-2 px-4 text-left text-sm font-medium"
            >
              <Icon icon={CircleHelp} className="text-fg-muted" />
              <span className="min-w-0 flex-1">
                New here? How Q-Tech CRM works · {steps.length} steps
              </span>
              <Icon icon={ChevronDown} className={cn('text-fg-muted transition-transform duration-fast', expanded && 'rotate-180')} />
            </button>
          </h2>
          <Button variant="quiet" size="touch" icon={X} aria-label="Hide How this works" onClick={() => setDismissed(true)} />
        </div>
      )}
      {open ? (
        <div id={listId} className="grid gap-3 px-4 pb-3 pt-2">
          <ol className="grid gap-x-6 gap-y-1 md:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s.recipe} className="flex items-start gap-2 text-sm text-fg-2">
                <span aria-hidden="true" className="mt-[2px] grid size-5 shrink-0 place-items-center rounded-round bg-selected text-xs font-semibold text-fg">
                  {i + 1}
                </span>
                <span id={`${id}-step-${i}`} className="min-w-0 flex-1 text-pretty">
                  <InlineMarkdown text={s.text} />
                </span>
                <Button variant="quiet" size="sm" aria-describedby={`${id}-step-${i}`} onClick={() => openHelp(s.recipe)} className="-my-1 shrink-0">
                  Show me
                </Button>
              </li>
            ))}
          </ol>
          {wide ? null : (
            <div className="flex gap-2">
              <Button size="touch" onClick={() => setDismissed(true)}>
                Got it
              </Button>
              <Button variant="quiet" size="touch" onClick={() => openHelp(null)}>
                Open Help
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
