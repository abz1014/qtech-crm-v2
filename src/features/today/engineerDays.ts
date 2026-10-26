// An engineer's list, grouped by day (redesign phase 7, plan (j2)): Missed, Today, Tomorrow, then each later day by name, then the
// jobs whose goods are on site and have no date yet. A row reads "10:00 · Install · customer · site" (visit.ts); a job with no time
// sorts after the timed ones on its day. Pure: TodayScreen draws it, the rules (rules.ts ENGINEER_RULES) decide what is in it.
import { addDays } from '@/features/rfqs/lib/dateText'
import { formatDay } from '@/lib/formatDay'
import { VISIT_TYPE_LABEL, isVisitType, visitLine } from '@/features/orders/lib/visit'
import type { TodoBlock } from '@/features/today/todoModel'
import type { TodayItem, TodayView } from '@/features/today/types'

export interface DayGroup {
  /** "now-missed", "now" (today), "soon-<date>", "ready": the screen picks its colour block from the prefix. */
  id: string
  title: string
  items: TodayItem[]
}

/** The row, in the engineer's words: the visit line first, then what to do about it. */
export function dayRow(item: TodayItem, today: string): TodayItem {
  if (item.rule !== 'job_commissioning' || !item.visit) return item
  const late = !!item.actionDueOn && item.actionDueOn < today
  const type = isVisitType(item.visit.type) ? VISIT_TYPE_LABEL[item.visit.type] : 'Commissioning'
  return { ...item, title: visitLine(item.visit), party: late ? item.title : type }
}

const byTime = (a: TodayItem, b: TodayItem) => {
  const ta = a.visit?.time ?? null
  const tb = b.visit?.time ?? null
  if (ta !== tb) return ta === null ? 1 : tb === null ? -1 : ta < tb ? -1 : 1
  return a.number - b.number
}

export function engineerDayGroups(view: TodayView, today: string): DayGroup[] {
  const jobs = view.active.filter(i => i.rule === 'job_commissioning' && i.actionDueOn)
  const onSite = view.active.filter(i => i.rule !== 'job_commissioning')
  const tomorrow = addDays(today, 1)
  const days = [...new Set(jobs.map(i => i.actionDueOn as string).filter(d => d >= today))].sort()
  const out: DayGroup[] = []
  const missed = jobs.filter(i => (i.actionDueOn as string) < today).sort(byTime)
  if (missed.length) out.push({ id: 'now-missed', title: 'Missed', items: missed.map(i => dayRow(i, today)) })
  for (const d of days) {
    const items = jobs.filter(i => i.actionDueOn === d).sort(byTime).map(i => dayRow(i, today))
    const title = d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : formatDay(d)
    out.push({ id: d === today ? 'now' : `soon-${d}`, title, items })
  }
  if (onSite.length) out.push({ id: 'ready', title: 'Goods on site, no date yet', items: onSite })
  return out
}


/** The colour block of a day group (todoModel's three): Missed is late, Today is today, every later day and goods on site are this week. */
export const dayBlock = (id: string): TodoBlock => (id === 'now-missed' ? 'late' : id === 'now' ? 'today' : 'week')
