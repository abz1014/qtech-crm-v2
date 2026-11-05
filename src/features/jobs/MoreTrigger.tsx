import { ChevronDown } from 'lucide-react'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/**
 * The job page's "More" button before its menu is ready: the same size and label as the real MoreMenu trigger, drawn at once,
 * disabled and marked busy, so the button never pops in late and the band does not shift when the menu arrives.
 */
export function MoreTrigger() {
  return (
    <Button aria-haspopup="menu" aria-busy="true" disabled>
      More
      <Icon icon={ChevronDown} size="sm" />
    </Button>
  )
}
