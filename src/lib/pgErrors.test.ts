import { describe, expect, it } from 'vitest'
import { mapPgError } from '@/lib/pgErrors'

describe('mapPgError (U07)', () => {
  it('23505 unique violation: names the entity and says what to do', () => {
    const m = mapPgError({ code: '23505', message: 'duplicate key value violates unique constraint "companies_name_key"' }, { entity: 'company' })
    expect(m.kind).toBe('unique')
    expect(m.message).toBe('A company with these details already exists. Open the existing one instead of adding a second.')
    expect(m.constraint).toBe('companies_name_key')
  })

  it('23505 on the primary key means the first attempt already arrived', () => {
    expect(mapPgError({ code: '23505', message: 'duplicate key value violates unique constraint "orders_pkey"' }).kind).toBe('already-saved')
  })

  it('23503 on insert: a linked record is missing', () => {
    const m = mapPgError({
      code: '23503',
      message: 'insert or update on table "orders" violates foreign key constraint "orders_company_id_fkey"',
      details: 'Key (company_id)=(x) is not present in table "companies".',
    })
    expect(m.kind).toBe('reference-missing')
    expect(m.message).toMatch(/no longer exists/)
  })

  it('23503 on delete: still in use', () => {
    const m = mapPgError({
      code: '23503',
      message: 'update or delete on table "companies" violates foreign key constraint "x"',
      details: 'Key (id)=(1) is still referenced from table "orders".',
    })
    expect(m.kind).toBe('reference-in-use')
    expect(m.message).toMatch(/still used/)
  })

  it('23514 check violation', () => {
    const m = mapPgError({ code: '23514', message: 'new row for relation "expenses" violates check constraint "expenses_amount_pkr_check"' })
    expect(m.kind).toBe('check')
    expect(m.message).toMatch(/not allowed/)
  })

  it('P0001 closed month: the server wording is passed through unchanged', () => {
    const msg = 'September 2026 is closed. An admin can reopen it.'
    expect(mapPgError({ code: 'P0001', message: msg })).toEqual({ kind: 'closed-month', message: msg })
  })

  it('P0001 with any other text is not shown to people', () => {
    const m = mapPgError({ code: 'P0001', message: 'trg_x: row_level_check failed at line 42' })
    expect(m.message).not.toMatch(/trg_x/)
    expect(m.kind).toBe('unknown')
  })

  it('a dropped network says trying again is safe', () => {
    const m = mapPgError(new TypeError('Failed to fetch'))
    expect(m.kind).toBe('network')
    expect(m.message).toMatch(/will not create a duplicate/)
  })

  it('anything else gets a plain fallback', () => {
    expect(mapPgError({ code: '99999', message: 'boom' }).message).toBe('Something went wrong. Nothing was saved. Try again.')
    expect(mapPgError('nope').kind).toBe('unknown')
  })
})
