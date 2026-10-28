// "Needs you": the ONE definition (redesign phase 0, owner decision 2026-10-22, plan section (e)). Every counter in the app reads
// it: the Today badge in the top bar and the phone tabs, Today's own header and its "Overdue or due today" group, the RFQ board's
// "N need you" and the Orders list's "N need you". None of them counts anything of its own, so no two numbers on a screen can
// disagree (needsYou.test.ts proves it on an imported-style data set).
//
// An item NEEDS YOU when all of these hold:
//   1. a Today rule raised it for you (rules.ts: your own records; ownerless ones go to admin, money to admin or its sales owner);
//   2. it is not snoozed, and not Waiting (chased, cooling down);
//   3. its date has come: due today or late (the "now" group). "Due in the next 5 days" and "Ready to move" are listed, not counted;
//   4. it is not STALE: its date is at most 30 days ago. Older work leaves the count and sits in a grey "Older than 30 days" fold
//      on the same person's Today (it is never hidden from the person who has to act). LATE PAYMENTS NEVER GO STALE: money owed
//      stays at the top until it is paid.
// History (closed, won, lost, cancelled, settled imported records) never reaches the rules at all (api.ts reads open RFQs and live
// orders only; a settled imported order raises no costs item; pending owner DB batch A (0088) stops the FBR receipt exception on imported invoices).
//
// Colour (plan section (e)): RED only for late money (a payment on a real invoice past its due date, by even one day) and for a
// promise to a customer that slipped within the last 30 days (and the GST to FBR after its payment day, the 15th: a real deadline) (the quotation's due date; the commissioning day an engineer was
// given). AMBER for due today or tomorrow and for our own pace slipping. GREY for everything else: ages, chores, stale items.
import { daysBetween } from '@/features/rfqs/lib/dateText'
import { COUNT_WORDS_MAX_DAYS } from '@/lib/timeWords'
import type { RuleKey, Tone, TodayItem, TodayView } from './types'

/** A task whose date is more than this many calendar days ago is stale (the plan's 30-day cut-off). */
export const STALE_AFTER_DAYS = COUNT_WORDS_MAX_DAYS

/** Late money: never stale, always counted while it is late. A pending "I paid" claim is the same: someone is out of pocket until it is handled. */
const NEVER_STALE: ReadonlySet<RuleKey> = new Set<RuleKey>(['payment_overdue', 'claims_to_approve'])

/** The only rules that may turn red: late money, and a promise made to a customer. */
export const RED_RULES: ReadonlySet<RuleKey> = new Set<RuleKey>(['payment_overdue', 'bid_due', 'job_commissioning', 'gst_fbr'])

/** Older than 30 days (by the date the item is due on) and not late money. Roll-ups and chores with no date are never stale. */
export function isStale(item: Pick<TodayItem, 'rule' | 'actionDueOn'>, today: string): boolean {
  if (NEVER_STALE.has(item.rule) || !item.actionDueOn) return false
  return daysBetween(item.actionDueOn, today) > STALE_AFTER_DAYS
}

/**
 * The tone of an item's date. `daysToDue` is negative when late. Red only for the red rules, and only for 30 days (a payment:
 * for as long as it is late); amber for due today or tomorrow, and for any other late item; grey beyond.
 */
export function toneFor(rule: RuleKey, daysToDue: number): Tone {
  if (daysToDue < 0 && RED_RULES.has(rule) && (NEVER_STALE.has(rule) || -daysToDue <= STALE_AFTER_DAYS)) return 'danger'
  if (daysToDue < 0) return -daysToDue <= STALE_AFTER_DAYS ? 'warning' : 'neutral'
  return daysToDue <= 1 ? 'warning' : 'neutral'
}

/** Whether an item counts. A view's `now` group already holds exactly these (rules.ts groupItems); this says it for one item. */
export function needsYou(item: Pick<TodayItem, 'group' | 'waiting' | 'rule' | 'actionDueOn'>, today: string): boolean {
  return !item.waiting && item.group === 'now' && !isStale(item, today)
}

/** The items that need you, in list order: the "Overdue or due today" group. */
export const needsYouItems = (view: TodayView): TodayItem[] => view.now
