import type { ReactNode } from 'react'
import { Circle, CircleCheck, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * StepList (D08 section 13, components-13): where a process stands. Each step is done (success tick,
 * secondary text), now (primary dot, medium weight) or to do (muted circle). The state is also said in words
 * for screen readers, and the current step carries aria-current. The optional note is a mono date or count
 * at the right ("Mon 23 Nov", "2 of 4 back", "due Tue 1 Dec").
 */
export type StepState = 'done' | 'now' | 'todo'

export interface StepItem {
  label: ReactNode
  state: StepState
  /** Right-aligned detail: a real date or a count. */
  note?: ReactNode
}

const GLYPH = {
  done: { icon: CircleCheck, tone: 'text-tone-success-fg', text: 'text-fg-2', word: 'Done: ' },
  now: { icon: CircleDot, tone: 'text-primary', text: 'font-medium text-fg', word: 'Now: ' },
  todo: { icon: Circle, tone: 'text-fg-muted', text: 'text-fg-muted', word: 'To do: ' },
} as const

export function StepList({ steps, label, className }: { steps: readonly StepItem[]; /** Names the list ("Progress of RFQ-0177"). */ label?: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn('grid gap-3 text-sm', className)}>
      {steps.map((s, i) => {
        const g = GLYPH[s.state]
        return (
          <li key={i} aria-current={s.state === 'now' ? 'step' : undefined} data-step={s.state} className={cn('flex items-center gap-3', g.text)}>
            <Icon icon={g.icon} className={g.tone} />
            <span>
              <span className="sr-only">{g.word}</span>
              {s.label}
            </span>
            {s.note ? <span className="num ml-auto text-xs font-regular text-fg-muted">{s.note}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}
