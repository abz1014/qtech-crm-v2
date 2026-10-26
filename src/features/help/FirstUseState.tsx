import { useNavigate } from 'react-router-dom'
import { Banknote, CalendarCheck, CircleHelp, FileText, Package, type LucideIcon } from 'lucide-react'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { firstUseCopy, NOTHING_YET, type FirstUseCopy, type FirstUseScreen, type NothingYetScreen } from '@/features/help/firstUseCopy'
import { useHelp } from '@/features/help/useHelp'

/*
 * The empty state for someone who has not started yet (learnability spec 1.2): what the screen is for, and ONE button,
 * the next action. A quiet "Show me how" opens the matching Help recipe. The words are in firstUseCopy.ts.
 *
 * The screen decides when the person is new (it owns its data) and swaps this in before its own empty branch:
 *   if (items.length === 0 && isNew) return <FirstUseState screen="today" role={user.role} />
 * Renders nothing for a screen and role with no first-use words, so the screen's own empty state shows instead.
 */
export interface FirstUseStateProps {
  screen: FirstUseScreen
  role: string
  /** Admin on Today: the owner is still the only person on the team, so the one button is adding people. */
  alone?: boolean
  /** The "show everyone's" switch, for a list that has one (engineers on Orders). */
  onEveryone?: () => void
  /** How many there are for everyone, shown on that button. */
  everyoneCount?: number
  className?: string
}

const ICON: Record<FirstUseScreen | NothingYetScreen, LucideIcon> = { today: CalendarCheck, rfqs: FileText, orders: Package, receivables: Banknote }

export function FirstUseState({ screen, role, alone, onEveryone, everyoneCount, className }: FirstUseStateProps) {
  const copy = firstUseCopy(screen, role, { alone })
  if (!copy) return null
  return <FirstUseCard copy={copy} icon={ICON[screen]} onEveryone={onEveryone} everyoneCount={everyoneCount} className={className} />
}

/**
 * A list that has never had a record, company-wide (NOTHING_YET in firstUseCopy.ts): a neutral line about what will appear here,
 * instead of the goal state ("Every order is paid in full") that is only true once records exist. Unbordered by default, because
 * it sits inside a table body that already has its edge.
 */
export function NothingYetState({ screen, bordered = false, className }: { screen: NothingYetScreen; bordered?: boolean; className?: string }) {
  return <FirstUseCard copy={NOTHING_YET[screen]} icon={ICON[screen]} bordered={bordered} className={className} />
}

function FirstUseCard({
  copy,
  icon,
  onEveryone,
  everyoneCount,
  bordered = true,
  className,
}: {
  copy: FirstUseCopy
  icon: LucideIcon
  onEveryone?: () => void
  everyoneCount?: number
  bordered?: boolean
  className?: string
}) {
  const navigate = useNavigate()
  const { openHelp } = useHelp()

  const a = copy.action
  const primary = !a ? null : a.kind === 'link' ? (
      <Button variant="primary" onClick={() => navigate(a.to)}>
        {a.label}
      </Button>
    ) : a.kind === 'everyone' && onEveryone ? (
      <Button variant="primary" onClick={onEveryone}>
        {everyoneCount === undefined ? a.label : `${a.label} (${everyoneCount})`}
      </Button>
    ) : null

  const recipe = copy.recipe
  return (
    <EmptyState
      mood="neutral"
      icon={icon}
      bordered={bordered}
      title={copy.title}
      className={className}
      actions={
        <>
          {primary}
          {recipe ? (
            <Button variant="quiet" icon={CircleHelp} onClick={() => openHelp(recipe)}>
              Show me how
            </Button>
          ) : null}
        </>
      }
    >
      {copy.body}
    </EmptyState>
  )
}
