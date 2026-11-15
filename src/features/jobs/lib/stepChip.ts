import { CircleAlert, CircleCheck, CircleDashed, Clock, Hourglass, type LucideIcon } from 'lucide-react'
import type { StepTone } from '@/lib/status'

/** Who acts next, as the Job page's hero chip and the current step's chip say it: an icon and a word (30-job-page.html chipFor). */
export const STEP_CHIP: Record<StepTone, { icon: LucideIcon; word: string }> = {
  now: { icon: CircleAlert, word: 'Needs action' },
  waiting: { icon: Hourglass, word: 'Waiting' },
  late: { icon: Clock, word: 'Late' },
  done: { icon: CircleCheck, word: 'Done' },
  inert: { icon: CircleDashed, word: 'Nothing to do' },
}
