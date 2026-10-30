// To do (redesign phase 3, P3-A): how the one list is laid out. Pure functions over a TodayView; no framework, no database.
//
// The counter is NOT computed here: the badge and the header read needsYouItems(view).length (needsYou.ts), and Late + Today
// are exactly view.now split by date, so the blocks can never disagree with the count (needsYou.test.ts, todoModel.test.ts).
//
//   Late       a "now" item whose date is before today (red only for late money or a broken promise, needsYou.ts toneFor)
//   Today      a "now" item due today
//   This week  the next 5 working days, and ready work with no date
// At most MAX_ROWS rows are drawn per person, late money first, then promises to customers, then the rest; whatever is over folds
// into "N more this week". Nothing is dropped: the fold lists them. Far-dated work (ready, with a date after the week) is never a
// task yet and goes straight to that fold.
import { RED_RULES } from '@/features/today/needsYou'
import type { RuleKey, TodayItem, TodayView } from '@/features/today/types'

export type TodoBlock = 'late' | 'today' | 'week'

/** The most rows a person sees before "N more this week" (plan section (e)). */
export const MAX_ROWS = 7

/** A "Not ours to chase" snooze (0097) still needs a date: snoozes.until_on is NOT NULL, so it is a ceiling far past any job. */
export const NOT_OURS_UNTIL = '2099-12-31'

/** The grey fold of chased items (a label the help recipes name). */
export const WAITING_TITLE = 'Chased, waiting'

export const BLOCK_TITLE: Record<TodoBlock, string> = { late: 'Late', today: 'Today', week: 'This week' }

/** The words on each row's own button. Every rule has one; a rule that was added without a button does not compile. */
export const ACTION_LABEL: Record<RuleKey, string> = {
  chase_customer: 'Chase',
  relay_answers: 'Send answers',
  not_floated: 'Ask suppliers',
  chase_supplier: 'Chase',
  bid_due: 'Send quotation',
  decision_overdue: 'Chase',
  payment_overdue: 'Copy reminder',
  goods_late: 'Chase',
  place_po: 'Place order',
  plan_commissioning: 'Plan visit',
  to_source: 'Find suppliers',
  delivered_not_invoiced: 'Create invoice',
  close_month: 'Close month',
  costs_incomplete: 'Add costs',
  fbr_attention: 'Check invoices',
  tcs_not_sent: 'Mark posted',
  recurring_due: 'Add expenses',
  job_commissioning: 'Open job',
  job_on_site: 'Set date',
  weekly_review: 'Start review',
  gst_fbr: 'Open GST',
  claims_to_approve: 'Approve',
  backup_stale: 'Open backups',
  usage_high: 'See usage',
  decrypt_test: 'Open backups',
}

/** Rules whose button opens the prepared message (the context pane holds Copy, Open in WhatsApp and Mark chased). */
const MESSAGE_RULES: ReadonlySet<RuleKey> = new Set<RuleKey>(['chase_customer', 'chase_supplier', 'goods_late', 'payment_overdue'])
export const opensMessage = (rule: RuleKey): boolean => MESSAGE_RULES.has(rule)

/** A second button on a row, for the one person who may use it: Record payment is admin only (0010). */
export function secondAction(item: Pick<TodayItem, 'rule' | 'orderId'>, role: string): { label: string; href: string } | null {
  if (item.rule === 'payment_overdue' && role === 'admin' && item.orderId) {
    return { label: 'Record payment', href: `/money/receivables?pay=1&order=${item.orderId}` }
  }
  return null
}

export function blockOf(item: Pick<TodayItem, 'group' | 'actionDueOn'>, today: string): TodoBlock {
  if (item.group === 'now') return item.actionDueOn !== null && item.actionDueOn < today ? 'late' : 'today'
  return 'week'
}

/** Late money first, then a promise to a customer, then the rest (the sort is stable, so the date order inside each stays). */
const rank = (i: Pick<TodayItem, 'rule'>): number => (i.rule === 'payment_overdue' ? 0 : RED_RULES.has(i.rule) ? 1 : 2)

export interface TodoModel {
  late: TodayItem[]
  today: TodayItem[]
  week: TodayItem[]
  /** Everything over the cap, and the far-dated work: listed in the fold, in the same order. */
  more: TodayItem[]
  /** Every row there is for this person (shown + more), the same list the count and the blocks come from. */
  total: number
  /** Work for the rest of the week (the This week block and whatever of it is in the fold): the lede's "N later this week". */
  weekTotal: number
}

/**
 * "Ready to move" work (place the PO, plan commissioning, close the month: it can be done now) is "this week" when it has no date or
 * its date has come; a date still ahead beyond the week is not a task yet.
 */
const isWeek = (i: TodayItem, today: string): boolean => i.group === 'soon' || (i.group === 'ready' && (i.actionDueOn === null || i.actionDueOn <= today))

export function buildTodo(view: TodayView, today: string, max: number = MAX_ROWS): TodoModel {
  const byBlock: Record<TodoBlock, TodayItem[]> = { late: [], today: [], week: [] }
  const later: TodayItem[] = []
  for (const i of [...view.now, ...view.soon, ...view.ready]) {
    if (i.group === 'ready' && !isWeek(i, today)) later.push(i)
    else byBlock[blockOf(i, today)].push(i)
  }
  const ordered = (['late', 'today', 'week'] as const).flatMap(b => [...byBlock[b]].sort((a, z) => rank(a) - rank(z)).map(i => ({ i, b })))
  const shown = ordered.slice(0, max)
  const pick = (b: TodoBlock) => shown.filter(s => s.b === b).map(s => s.i)
  return {
    late: pick('late'),
    today: pick('today'),
    week: pick('week'),
    more: [...ordered.slice(max).map(s => s.i), ...later],
    total: ordered.length + later.length,
    weekTotal: byBlock.week.length,
  }
}

/** "3 more this week" when everything folded is this week's work, "3 more" when late or due-today work is in the fold too. */
export function moreText(model: Pick<TodoModel, 'more'>): string {
  const n = model.more.length
  const onlyWeek = model.more.every(i => i.group !== 'now')
  return `${n} more${onlyWeek ? ' this week' : ''}`
}
