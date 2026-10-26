// To do, Team view (redesign phase 3, P3-B): the admin sees each other person's list and late count, read only, so slippage is
// visible without their tasks crowding the admin's own. Built from the SAME facts the admin's own list is built from (one read),
// by running the rules once per person: nothing is counted a second way. A person's snoozes are theirs alone, so none are applied.
//
// Stale work (more than 30 days old, not late money) is not in anyone's late count or needs-you count; it stays visible, greyed,
// "since <date>", under its owner's name, and is on the owner's own Older-than-30-days fold and the Monday review.
import type { TodayData } from '@/features/today/api'
import { needsYouItems } from '@/features/today/needsYou'
import { buildToday } from '@/features/today/rules'
import { buildTodo } from '@/features/today/todoModel'
import type { Role, TodayItem } from '@/features/today/types'

export interface TeamPerson {
  id: string
  name: string
  role: Role
  /** Late rows (a "now" item past its date): the one number worth a glance. */
  late: number
  /** Everything that needs this person (Late + Today): the number on their own badge. */
  needsYou: number
  /** The first rows of their list, in To do order. */
  rows: TodayItem[]
  /** Past the first rows. */
  more: number
  /** Older than 30 days, grey, with their dates. */
  stale: TodayItem[]
}

/** How many rows of each person the overview draws. */
export const TEAM_ROWS = 5

export function buildTeam(data: TodayData, today: string, selfId: string, rows: number = TEAM_ROWS): TeamPerson[] {
  const roleOf = (id: string | null): Role | null => (id ? (data.roles[id] ?? null) : null)
  return Object.entries(data.roles)
    .filter(([id]) => id !== selfId)
    .map(([id, role]) => {
      const view = buildToday({
        today,
        user: { id, role },
        roleOf,
        rfqs: data.rfqs,
        clarifications: data.clarifications,
        inquiries: data.inquiries,
        legs: data.legs,
        orders: data.orders,
        receivables: data.receivables,
        monthEnd: data.monthEnd,
        gst: data.gst,
        claims: data.claims,
        costs: data.costs,
        invoices: data.invoices,
        recurring: data.recurring,
        jobs: data.jobs,
        snoozes: [],
      })
      const todo = buildTodo(view, today, rows)
      const needs = needsYouItems(view)
      return {
        id,
        name: data.names[id] ?? 'Unknown',
        role,
        late: needs.filter(i => i.actionDueOn !== null && i.actionDueOn < today).length,
        needsYou: needs.length,
        rows: [...todo.late, ...todo.today, ...todo.week],
        more: todo.more.length,
        stale: view.stale,
      }
    })
    .sort((a, b) => b.late - a.late || b.needsYou - a.needsYou || a.name.localeCompare(b.name))
}
