import { afterEach, describe, expect, it } from 'vitest'
import {
  canUndo,
  changeBlockedBy,
  correctionChanges,
  correctionToastText,
  correctPayment,
  countingPayments,
  CORRECTION_REFUSALS,
  listOrderPayments,
  restorePayment,
  timestampMs,
  toCorrectionError,
  toPaymentLines,
  UNDO_WINDOW_MINUTES,
  voidPayment,
  voidToastText,
  type PaymentLine,
} from '@/features/money/payments/correctionApi'
import { mapPgError, PlainError } from '@/lib/pgErrors'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'

afterEach(() => installFakeDb(() => ({})).uninstall())

const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const rpcArgs = (c: FakeCall) => opArgs(c, 'args')?.[0]

describe('payment correction calls (0073)', () => {
  it('void_payment gets the payment and the reason as typed (the database trims and requires it)', async () => {
    const db = installFakeDb(() => ({ data: null }))
    await voidPayment({ paymentId: 'p1', reason: ' Typed twice ' })
    expect(db.calls.map(c => c.target)).toEqual(['rpc:void_payment'])
    expect(rpcArgs(db.calls[0])).toEqual({ p_payment_id: 'p1', p_reason: ' Typed twice ' })
  })

  it('correct_payment gets the new figures and the client id, sends an empty reference for none, and returns the new id', async () => {
    const db = installFakeDb(() => ({ data: 'n1' }))
    const id = await correctPayment({ paymentId: 'p1', newId: 'n1', amount: 5000, receivedOn: '2026-10-11', paidVia: 'cash', reference: null, reason: 'Wrong amount' })
    expect(id).toBe('n1')
    expect(rpcArgs(db.calls[0])).toEqual({
      p_payment_id: 'p1',
      p_amount: 5000,
      p_received_on: '2026-10-11',
      p_paid_via: 'cash',
      p_reference: '',
      p_reason: 'Wrong amount',
      p_new_id: 'n1',
    })
  })

  it('a retry that comes back without data still answers with the id the form made', async () => {
    installFakeDb(() => ({ data: null }))
    expect(await correctPayment({ paymentId: 'p1', newId: 'n1', amount: 1, receivedOn: '2026-10-11', paidVia: 'bank', reference: ' CHQ-9 ', reason: 'x' })).toBe('n1')
  })

  it('restore_payment gets the voided payment', async () => {
    const db = installFakeDb(() => ({ data: null }))
    await restorePayment('p1')
    expect(db.calls[0].target).toBe('rpc:restore_payment')
    expect(rpcArgs(db.calls[0])).toEqual({ p_payment_id: 'p1' })
  })

  it('a refusal comes back as a PlainError: the sentence as written, the hint as its code', async () => {
    const message = 'September 2026 is closed. Reopen it first (Money, Month-end), then change this payment.'
    installFakeDb((): FakeResult => ({ error: { code: 'P0001', message, hint: 'month_closed' } as FakeResult['error'] }))
    const err = await voidPayment({ paymentId: 'p1', reason: 'x' }).catch(e => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(mapPgError(err)).toMatchObject({ message, code: 'month_closed' })
  })

  it('every refusal hint is mapped; anything else is left for mapPgError (role, network, unknown)', () => {
    for (const hint of CORRECTION_REFUSALS) {
      expect(toCorrectionError({ code: 'P0001', message: ' Said plainly. ', hint })).toEqual(new PlainError('Said plainly.', hint))
    }
    const denied = { code: '42501', message: 'only an admin can void or correct a payment', hint: null }
    expect(toCorrectionError(denied)).toBe(denied)
    expect(mapPgError(toCorrectionError(denied)).kind).toBe('permission')
    const other = { code: 'P0001', message: 'x', hint: 'something_else' }
    expect(toCorrectionError(other)).toBe(other)
    expect(toCorrectionError(null)).toBeNull()
  })
})

const raw = (o: Partial<Parameters<typeof toPaymentLines>[0][number]>) => ({
  id: 'p',
  order_id: 'o1',
  received_on: '2026-10-10',
  amount: '5900.00',
  paid_via: 'bank',
  reference: null,
  bank_month: null,
  created_at: '2026-10-10T05:00:00.000001+00:00',
  created_by: ADMIN,
  credited_user_id: 'sales',
  legacy_source: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  corrects_payment_id: null,
  ...o,
})

describe('an order\'s payment rows', () => {
  it('reads every payment of the order, voided ones included, oldest first', async () => {
    const db = installFakeDb(() => ({ data: [raw({ id: 'p1' })] }))
    const lines = await listOrderPayments('o1')
    const call = db.calls[0]
    expect(call.target).toBe('payments_in')
    expect(opArgs(call, 'eq')).toEqual(['order_id', 'o1'])
    expect(call.ops.some(([n]) => n === 'is')).toBe(false)
    expect(String(opArgs(call, 'select')?.[0])).toContain('voided_at')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ id: 'p1', amount: 5900, paidVia: 'bank', status: 'counts', legacy: false })
  })

  it('tells a plain void from a correction, and links the correction to the payment it replaced', () => {
    const at = '2026-10-12T09:30:00.123456+00:00'
    const lines = toPaymentLines([
      raw({ id: 'p1', voided_at: at, voided_by: ADMIN, void_reason: 'Wrong amount' }),
      raw({ id: 'n1', amount: 5000, corrects_payment_id: 'p1', created_at: at }),
      raw({ id: 'p2', voided_at: '2026-10-12T09:31:00+00:00', voided_by: ADMIN, void_reason: 'Typed twice' }),
      raw({ id: 'p3', legacy_source: { table: 'order_payments' }, credited_user_id: null }),
    ])
    expect(lines.map(l => [l.id, l.status, l.correctedById, l.correctsPaymentId])).toEqual([
      ['p1', 'corrected', 'n1', null],
      ['n1', 'counts', null, 'p1'],
      ['p2', 'voided', null, null],
      ['p3', 'counts', null, null],
    ])
    expect(lines[3].legacy).toBe(true)
    expect(countingPayments(lines).map(l => l.id)).toEqual(['n1', 'p3'])
  })

  it('an older correction that was undone does not mark a later plain void as corrected', () => {
    const lines = toPaymentLines([
      raw({ id: 'p1', voided_at: '2026-10-12T10:00:00+00:00', voided_by: ADMIN, void_reason: 'Paid to another order' }),
      raw({ id: 'n1', corrects_payment_id: 'p1', created_at: '2026-10-12T09:00:00+00:00', voided_at: '2026-10-12T09:01:00+00:00', void_reason: 'Undo of a correction' }),
    ])
    expect(lines[0]).toMatchObject({ status: 'voided', correctedById: null })
    expect(lines[1]).toMatchObject({ status: 'voided', correctsPaymentId: 'p1' })
  })

  it('Void and Correct are offered on a counting, unticked payment only', () => {
    const [counts, ticked, voided] = toPaymentLines([
      raw({ id: 'a' }),
      raw({ id: 'b', bank_month: '2026-10-01' }),
      raw({ id: 'c', voided_at: '2026-10-12T10:00:00+00:00', voided_by: ADMIN, void_reason: 'x' }),
    ])
    expect(changeBlockedBy(counts)).toBeNull()
    expect(changeBlockedBy(ticked)).toBe('bank_ticked')
    expect(changeBlockedBy(voided)).toBe('voided')
  })

  it('Undo is for the person who voided, within the window', () => {
    const voidedAt = '2026-10-12T10:00:00.999999+00:00'
    const line: PaymentLine = toPaymentLines([raw({ id: 'p', voided_at: voidedAt, voided_by: ADMIN, void_reason: 'x' })])[0]
    const t0 = timestampMs(voidedAt)
    expect(t0).toBe(Date.UTC(2026, 9, 12, 10, 0, 0, 999))
    expect(canUndo(line, ADMIN, t0 + 60_000)).toBe(true)
    expect(canUndo(line, ADMIN, t0 + UNDO_WINDOW_MINUTES * 60_000 - 1)).toBe(true)
    expect(canUndo(line, ADMIN, t0 + UNDO_WINDOW_MINUTES * 60_000)).toBe(false)
    expect(canUndo(line, 'someone-else', t0 + 1000)).toBe(false)
    expect(canUndo(line, null, t0 + 1000)).toBe(false)
    expect(canUndo(toPaymentLines([raw({ id: 'q' })])[0], ADMIN, t0)).toBe(false)
  })
})

describe('correction wording', () => {
  const before = { amount: 5900, receivedOn: '2026-10-10', paidVia: 'bank' as const, reference: 'TT-1' }

  it('lists what a correction changes; nothing changed is an empty list (Save stays off)', () => {
    expect(correctionChanges(before, { ...before, reference: ' TT-1 ' })).toEqual([])
    expect(correctionChanges(before, { amount: 5000, receivedOn: '2026-10-11', paidVia: 'cash', reference: 'CHQ-9' }, '2026-10-20')).toEqual([
      { field: 'amount', text: 'PKR 5,900 → 5,000' },
      { field: 'receivedOn', text: '10 Oct → 11 Oct' },
      { field: 'paidVia', text: 'Bank → Cash' },
      { field: 'reference', text: 'Ref TT-1 → CHQ-9' },
    ])
    expect(correctionChanges(before, { ...before, reference: null })).toEqual([{ field: 'reference', text: 'Ref TT-1 → none' }])
    expect(correctionChanges(before, { ...before, amount: 5900.5 })).toEqual([{ field: 'amount', text: 'PKR 5,900 → 5,900.50' }])
  })

  it('the Undo toasts say what happened and what Undo brings back', () => {
    expect(voidToastText({ amount: 5900, receivedOn: '2026-10-20' }, 38, '2026-10-20')).toEqual({
      title: 'Voided payment',
      body: 'ORD-0038 · PKR 5,900 · 20 Oct',
      undoneBody: 'The payment counts again.',
    })
    expect(correctionToastText(before, { ...before, amount: 5000 }, 38, '2026-10-20')).toEqual({
      title: 'Corrected payment',
      body: 'ORD-0038 · PKR 5,900 → 5,000',
      undoneBody: 'The original payment counts again.',
    })
    expect(voidToastText({ amount: 1000, receivedOn: '2025-01-15' }, 7, '2026-10-20').body).toBe('ORD-0007 · PKR 1,000 · 15 Jan 2025')
  })
})
