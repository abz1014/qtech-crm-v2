import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, CircleHelp, FileText, Package, type LucideIcon } from 'lucide-react'
import { CaptureContext } from '@/app/capture/useCapture'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { firstUseCopy, type FirstUseScreen } from '@/features/help/firstUseCopy'
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

const ICON: Record<FirstUseScreen, LucideIcon> = { today: CalendarCheck, rfqs: FileText, orders: Package }

export function FirstUseState({ screen, role, alone, onEveryone, everyoneCount, className }: FirstUseStateProps) {
  const navigate = useNavigate()
  const openCapture = useContext(CaptureContext)?.openCapture
  const { openHelp } = useHelp()
  const copy = firstUseCopy(screen, role, { alone })
  if (!copy) return null

  const a = copy.action
  const primary =
    a.kind === 'link' ? (
      <Button variant="primary" onClick={() => navigate(a.to)}>
        {a.label}
      </Button>
    ) : a.kind === 'capture' && openCapture ? (
      <Button variant="primary" onClick={openCapture}>
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
      icon={ICON[screen]}
      bordered
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
