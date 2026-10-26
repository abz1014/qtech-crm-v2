import { describe, expect, it } from 'vitest'
import { buildTimeline, formatStamp, formatValue, lastChangedLine } from '@/features/history/model'
import { columnSpec } from '@/features/history/labels'
import { CATEGORY_FUEL, CATEGORY_RENT, ev, page } from '@/features/history/fixtures'

const T = (hhmm: string, day = '2026-10-12') => `${day}T${hhmm}:00+05:00`
const spec = (table: string, col: string) => columnSpec(table, col)!

describe('formatting', () => {
  it('writes money, dates, bools, enums and names the way the screens do', () => {
    expect(formatValue(spec('expenses', 'amount_pkr'), 5000)).toBe('PKR 5,000')
    expect(formatValue(spec('expenses', 'amount_pkr'), '1234.5')).toBe('PKR 1,234.50')
    expect(formatValue(spec('expenses', 'paid_on'), '2026-10-04')).toBe('4 Oct 2026')
    expect(formatValue(spec('expenses', 'bank_month'), '2026-10-01')).toBe('Oct 2026')
    expect(formatValue(spec('expenses', 'bank_month'), null)).toBe('Not ticked')
    expect(formatValue(spec('expenses', 'paid_via'), 'cash')).toBe('Cash')
    expect(formatValue(spec('rfqs', 'is_priority'), true)).toBe('Yes')
    expect(formatValue(spec('expenses', 'category_id'), CATEGORY_RENT, { [CATEGORY_RENT]: 'Rent' })).toBe('Rent')
    expect(formatValue(spec('expenses', 'description'), '')).toBe('empty')
  })

  it('formats a timestamp in Karachi time as "12 Oct 2026, 3:40 pm"', () => {
    expect(formatStamp('2026-10-12T10:40:00Z')).toBe('12 Oct 2026, 3:40 pm')
    expect(formatStamp('2026-10-12T19:05:00Z')).toBe('13 Oct 2026, 12:05 am')
  })
})

describe('buildTimeline', () => {
  const update = (at: string, was: Record<string, unknown>, now: Record<string, unknown>, by_name = 'Ayesha') =>
    ev({ at, action: 'update', was, now, by_name, by: by_name })

  it('shows "was -> now" for the columns that changed, with a name for ids', () => {
    const [e] = buildTimeline(
      [
        page(
          [update(T('15:40'), { amount_pkr: 5000, category_id: CATEGORY_RENT, description: 'same' }, { amount_pkr: 500, category_id: CATEGORY_FUEL, description: 'same' })],
          { [CATEGORY_RENT]: 'Rent', [CATEGORY_FUEL]: 'Fuel & travel' },
        ),
      ],
      { table: 'expenses' },
    )
    expect(e.when).toBe('12 Oct 2026, 3:40 pm')
    expect(e.by).toBe('Ayesha')
    expect(e.changes.map(c => c.text)).toEqual(['Amount: PKR 5,000 → PKR 500', 'Category: Rent → Fuel & travel'])
  })

  it('ignores hidden columns and columns that did not change', () => {
    const out = buildTimeline([page([update(T('10:00'), { updated_at: 'a', model_tokens: 'x' }, { updated_at: 'b', model_tokens: 'y' })])], { table: 'expenses' })
    expect(out).toEqual([])
  })

  it('merges edits by the same person within 2 minutes, from the first "was" to the last "now"', () => {
    const out = buildTimeline(
      [
        page([
          update(T('15:41'), { amount_pkr: 600 }, { amount_pkr: 500 }),
          update(T('15:40'), { amount_pkr: 5000 }, { amount_pkr: 600, description: 'tea' }),
        ]),
      ],
      { table: 'expenses' },
    )
    expect(out).toHaveLength(1)
    expect(out[0].at).toBe(T('15:41'))
    expect(out[0].changes.map(c => c.text)).toEqual(['Amount: PKR 5,000 → PKR 500', 'Detail: empty → tea'])
  })

  it('drops a change that was put back within the window', () => {
    const out = buildTimeline([page([update(T('15:41'), { amount_pkr: 600 }, { amount_pkr: 500 }), update(T('15:40'), { amount_pkr: 500 }, { amount_pkr: 600 })])], { table: 'expenses' })
    expect(out).toEqual([])
  })

  it('does not merge different people, or edits more than 2 minutes apart', () => {
    const person = buildTimeline([page([update(T('15:41'), { amount_pkr: 2 }, { amount_pkr: 3 }, 'Bilal'), update(T('15:40'), { amount_pkr: 1 }, { amount_pkr: 2 })])], { table: 'expenses' })
    expect(person).toHaveLength(2)
    const late = buildTimeline([page([update(T('15:43'), { amount_pkr: 2 }, { amount_pkr: 3 }), update(T('15:40'), { amount_pkr: 1 }, { amount_pkr: 2 })])], { table: 'expenses' })
    expect(late).toHaveLength(2)
  })

  it('shows the insert as "Entered by X" and keeps it apart from later edits', () => {
    const out = buildTimeline(
      [page([update(T('15:41'), { amount_pkr: 1 }, { amount_pkr: 2 }), ev({ at: T('15:40'), action: 'insert', now: { amount_pkr: 1 }, by_name: 'Bilal' })])],
      { table: 'expenses' },
    )
    expect(out.map(e => e.title)).toEqual([null, 'Entered by Bilal'])
    expect(out[1].kind).toBe('created')
  })

  it('says "Imported from old CRM" for an imported record with no insert, once the oldest page is in', () => {
    const e = update(T('15:41'), { amount_pkr: 1 }, { amount_pkr: 2 })
    expect(buildTimeline([page([e])], { table: 'expenses', imported: true }).at(-1)?.title).toBe('Imported from old CRM')
    expect(buildTimeline([page([e], {}, true)], { table: 'expenses', imported: true }).map(x => x.kind)).toEqual(['changed'])
    expect(buildTimeline([page([e])], { table: 'expenses' }).map(x => x.kind)).toEqual(['changed'])
    const inserted = buildTimeline([page([ev({ at: T('09:00'), action: 'insert', now: { amount_pkr: 1 } })])], { table: 'expenses', imported: true })
    expect(inserted.map(x => x.kind)).toEqual(['created'])
  })

  it('turns lines and jsonb into "Lines changed (3 -> 4)"', () => {
    const [e] = buildTimeline(
      [page([ev({ table: 'quotations', record_id: 'q1', at: T('11:00'), action: 'update', was: { lines: [{}, {}, {}] }, now: { lines: [{}, {}, {}, {}] } })])],
      { table: 'quotations' },
    )
    expect(e.changes[0].text).toBe('Lines changed (3 → 4)')
  })

  it('names child lines: a changed quantity, an added line and a removed line', () => {
    const out = buildTimeline(
      [
        page([
          ev({ table: 'order_items', record_id: 'i1', at: T('15:00'), action: 'update', was: { qty: 2, position: 1 }, now: { qty: 3, position: 1 }, child_label: 'Valve DN50' }),
          ev({ table: 'order_items', record_id: 'i2', at: T('13:00'), action: 'delete', was: { qty: 1 }, child_label: 'Valve DN50' }),
          ev({ table: 'order_items', record_id: 'i3', at: T('12:00'), action: 'insert', now: { qty: 1, position: 0 }, child_label: 'Gasket' }),
        ]),
      ],
      { table: 'orders' },
    )
    expect(out[0].changes[0].text).toBe("Line 2 'Valve DN50': quantity 2 → 3")
    expect(out[1].changes[0].text).toBe("Removed line 'Valve DN50'")
    expect(out[2].changes[0].text).toBe("Added line 1 'Gasket'")
  })

  it('resolves a child label that is an id', () => {
    const SUP = 'ca7e0000-0000-4000-8000-0000000000aa'
    const [e] = buildTimeline(
      [page([ev({ table: 'supplier_inquiries', at: T('10:00'), action: 'insert', now: { supplier_id: SUP }, child_label: SUP })], { [SUP]: 'Alpenmark Controls' })],
      { table: 'rfqs' },
    )
    expect(e.changes[0].text).toBe("Added supplier 'Alpenmark Controls'")
  })

  it('shows nothing about money for an engineer: redacted events carry no money keys', () => {
    const out = buildTimeline(
      [page([ev({ table: 'order_items', record_id: 'i1', at: T('15:00'), action: 'update', was: { qty: 2, description: 'Valve' }, now: { qty: 3, description: 'Valve' }, child_label: 'Valve' })])],
      { table: 'orders' },
    )
    const text = out.flatMap(e => e.changes.map(c => c.text)).join(' ')
    expect(text).toMatch(/quantity 2 → 3/)
    expect(text).not.toMatch(/PKR|price|amount|GST|cost/i)
  })
})

describe('lastChangedLine', () => {
  const now = new Date('2026-10-14T10:00:00+05:00')
  it('says who and how long ago', () => {
    expect(lastChangedLine({ at: '2026-10-12T15:40:00+05:00', by_name: 'Ayesha' }, now)).toBe('Last changed by Ayesha, 2 days ago')
    expect(lastChangedLine({ at: '2026-10-13T15:40:00+05:00', by_name: 'Ayesha' }, now)).toBe('Last changed by Ayesha, yesterday')
    expect(lastChangedLine({ at: '2026-10-14T08:30:00+05:00', by_name: 'Ayesha' }, now)).toBe('Last changed by Ayesha, 1 hour ago')
    expect(lastChangedLine({ at: '2026-10-14T09:59:30+05:00', by_name: null }, now)).toBe('Last changed just now')
    expect(lastChangedLine(undefined, now)).toBeNull()
  })
})
