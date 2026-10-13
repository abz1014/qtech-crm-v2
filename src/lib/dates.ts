// Ported from src/lib/dates.ts @ 7a29f3a (Q-Tech CRM v1). Unchanged behaviour; header only.
// Business-timezone date helpers.
// The business operates in Pakistan (Asia/Karachi, UTC+5). Using
// new Date().toISOString() gives the UTC date, which is wrong between
// 00:00 and 05:00 PKT. Always use these helpers for "today" and for
// converting Date objects to YYYY-MM-DD strings.

const BUSINESS_TZ = 'Asia/Karachi';

// en-CA locale formats as YYYY-MM-DD
const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in the business timezone, as YYYY-MM-DD. */
export function businessToday(): string {
  return dateFmt.format(new Date());
}

/** Format any Date as YYYY-MM-DD in the business timezone. */
export function toBusinessDate(d: Date): string {
  return dateFmt.format(d);
}

/** N days from today (negative for past) in the business timezone, as YYYY-MM-DD. */
export function businessDaysFromNow(days: number): string {
  // Do the arithmetic on the Karachi calendar date, not the runtime's local
  // date — new Date()/setDate() operate in local time, which can be off by
  // a day from Asia/Karachi depending on the machine's timezone.
  const [y, m, d] = businessToday().split('-').map(Number);
  const shifted = new Date(y, m - 1, d + days);
  const dd = String(shifted.getDate()).padStart(2, '0');
  const mm = String(shifted.getMonth() + 1).padStart(2, '0');
  return `${shifted.getFullYear()}-${mm}-${dd}`;
}

/** First day of the month containing `today` (business timezone), as YYYY-MM-DD. */
export function businessMonthStart(): string {
  return businessToday().slice(0, 7) + '-01';
}

/** Last day of the month containing `today` (business timezone), as YYYY-MM-DD. */
export function businessMonthEnd(): string {
  const [y, m] = businessToday().split('-').map(Number);
  // Day 0 of next month = last day of this month. Build in local time and
  // read the calendar parts directly — no toISOString conversion.
  const last = new Date(y, m, 0);
  const dd = String(last.getDate()).padStart(2, '0');
  return `${y}-${String(m).padStart(2, '0')}-${dd}`;
}
