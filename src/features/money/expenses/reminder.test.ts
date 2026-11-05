import { describe, expect, it } from 'vitest'
import { badLines, isBillDue, reminderLines, reminderTotal, type ReminderBill } from '@/features/money/expenses/reminder'
import type { Category } from '@/features/money/expenses/model'

const CATS: Category[] = [
  { id: 'ca7e0000-0000-4000-8000-000000000002', name: 'Rent', grp: 'overhead', groupId: 'g1', defaultPaidVia: 'bank', sort: 1, active: true, budget: null },
  { id: 'elec', name: 'Electricity', grp: 'overhead', groupId: 'g1', defaultPaidVia: 'cash', sort: 2, active: true, budget: null },
]
const bill = (over: Partial<ReminderBill> = {}): ReminderBill => ({
  id: 'b1',
  label: 'Rent',
  dayOfMonth: 1,
  active: true,
  startMonth: null,
  recorded: false,
  categoryId: 'ca7e0000-0000-4000-8000-000000000002',
  amount: 100000,
  paidVia: null,
  ...over,
})
const TODAY = '2026-11-05'

describe('the recurring-bill reminder', () => {
  it('lists every due bill with its usual amount, for the month its bill is for', () => {
    const lines = reminderLines([bill(), bill({ id: 'b2', label: 'Electricity', categoryId: 'elec', amount: 18000, dayOfMonth: 3 })], TODAY, CATS)
    expect(lines.map(l => [l.label, l.amount, l.period, l.paidVia])).toEqual([
      ['Electricity', 18000, '2026-10', 'cash'],
      ['Rent', 100000, '2026-11', 'bank'],
    ])
    expect(reminderTotal(lines)).toBe(118000)
  })

  it('records an amount the person changed, and the total follows it', () => {
    const lines = reminderLines([bill({ id: 'b2', label: 'Electricity', categoryId: 'elec', amount: 18000, dayOfMonth: 3 }), bill()], TODAY, CATS, { b2: 21350 })
    expect(lines.find(l => l.id === 'b2')).toMatchObject({ amount: 21350, usual: 18000 })
    expect(reminderTotal(lines)).toBe(121350)
  })

  it('a cleared or zero amount blocks recording and is not counted', () => {
    const lines = reminderLines([bill(), bill({ id: 'b2', label: 'Electricity', categoryId: 'elec' })], TODAY, CATS, { b2: null })
    expect(badLines(lines).map(l => l.id)).toEqual(['b2'])
    expect(reminderTotal(lines)).toBe(100000)
  })

  it('leaves out a bill that is recorded, paused, not started, or whose day has not come', () => {
    const due = (b: ReminderBill) => isBillDue(b, TODAY)
    expect(due(bill({ recorded: true }))).toBe(false)
    expect(due(bill({ active: false }))).toBe(false)
    expect(due(bill({ startMonth: '2026-12' }))).toBe(false)
    expect(due(bill({ dayOfMonth: 25 }))).toBe(false)
    expect(due(bill({ dayOfMonth: null }))).toBe(true)
    expect(due(bill())).toBe(true)
  })
})
