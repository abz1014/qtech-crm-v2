import { useId, useState } from 'react'
import { ChevronDown, CircleHelp, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CARD } from '@/ui/card'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { howItWorksFor, howItWorksKey } from '@/features/help/howItWorks'
import { InlineMarkdown } from '@/features/help/RecipeText'
import { STEP_TEXT_BESIDE_BUTTON, StepNumber } from '@/features/help/StepNumber'
import { useDismissed } from '@/features/help/useDismissed'
import { useHelp } from '@/features/help/useHelp'

/*
 * "How this works" (learnability spec 1.3): an optional card above Today's list for someone new. Never a modal, never in
 * the way. At every width it is one collapsed row, "How Q-Tech CRM works · 4 steps", that opens on tap to the role's
 * 3 to 5 steps, each with "Show me" (opens that recipe in Help), so the list does not move down: on a 1366 x 768 laptop
 * the open card pushed Today's jobs below the fold (audit T1). The × hides it without opening it.
 * "Got it" hides it for this person on this device (localStorage qtech.howItWorks.<id>); Help offers it again.
 * It also stays hidden once the person is no longer new: 7 days (the first week) after `since` (users.created_at), when the caller has it.
 * After that Help is the only place it lives: HelpPanel lists the same steps inline.
 *
 * Forest (82-help.html .hp-howcard): the one card look (CARD), a full-width row in the body weight, and when open the same
 * hairline-ruled step rows with brand-tinted number discs that Help's own "How this works" list draws.
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

export const NEW_FOR_DAYS = 7

export function HowItWorksCard({ userId, role, since, now, className }: HowItWorksCardProps) {
  const steps = howItWorksFor(role)
  const [dismissed, setDismissed] = useDismissed(howItWorksKey(userId))
  const [expanded, setExpanded] = useState(false)
  const { openHelp } = useHelp()
  const id = useId()

  const sinceMs = since ? Date.parse(since) : NaN
  const longAgo = Number.isFinite(sinceMs) && (now ?? new Date()).getTime() - sinceMs > NEW_FOR_DAYS * 86_400_000
  if (dismissed || longAgo || steps.length === 0) return null

  const titleId = `${id}-title`
  const listId = `${id}-steps`
  return (
    <section aria-labelledby={titleId} className={cn(CARD, 'min-w-0', className)}>
      <div className="flex min-w-0 items-center pr-1">
        {/* A disclosure, not a title: the UI face, not the wide display cut. */}
        <h2 id={titleId} className="min-w-0 flex-1 font-sans">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded(e => !e)}
            className="flex min-h-touch w-full items-center gap-2 px-4 text-left text-base font-semibold text-fg lg:min-h-control"
          >
            <Icon icon={CircleHelp} className="text-fg-muted" />
            <span className="min-w-0 flex-1 break-words">
              How Q-Tech CRM works · {steps.length} steps
            </span>
            <Icon icon={ChevronDown} className={cn('text-fg-muted transition-transform duration-base ease-out', expanded && 'rotate-180')} />
          </button>
        </h2>
        <Button variant="quiet" size="touch" icon={X} aria-label="Hide How this works" onClick={() => setDismissed(true)} className="rounded-pill text-fg" />
      </div>
      {expanded ? (
        <div id={listId} className="grid animate-rise-4 gap-3 border-t px-4 pb-4 pt-2">
          {/* Two columns only when the CARD has room for two (about 2 x 16rem), not when the window does: in Today's 420 px
              list a viewport breakpoint squeezed each step to a word per line and pushed "Show me" past the card's edge. */}
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-x-6">
            {steps.map((s, i) => (
              <li key={s.recipe} className="flex items-start gap-2 border-b py-2 text-base text-fg-2">
                <StepNumber n={i + 1} besideButton />
                <span id={`${id}-step-${i}`} className={cn('min-w-0 flex-1 text-pretty', STEP_TEXT_BESIDE_BUTTON)}>
                  <InlineMarkdown text={s.text} />
                </span>
                <Button variant="quiet" size="sm" aria-describedby={`${id}-step-${i}`} onClick={() => openHelp(s.recipe)} className="shrink-0">
                  Show me
                </Button>
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <Button onClick={() => setDismissed(true)}>
              Dismiss
            </Button>
            <Button variant="quiet" onClick={() => openHelp(null)}>
              Open Help
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
