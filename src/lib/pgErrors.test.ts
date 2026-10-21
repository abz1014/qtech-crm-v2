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

  it('22003 numeric overflow: says the number is too large, not "try again" (hunt HE-7)', () => {
    const m = mapPgError({ code: '22003', message: 'numeric field overflow' })
    expect(m.kind).toBe('check')
    expect(m.message).toMatch(/too large/)
    expect(m.message).not.toMatch(/Something went wrong/)
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

  it('a dropped network as supabase-js returns it (an error object, code empty, "TypeError: Failed to fetch") is a network error', () => {
    // postgrest-js catches the fetch rejection and resolves { error: { message: `${name}: ${message}`, code: '' } }.
    for (const message of ['TypeError: Failed to fetch', 'TypeError: NetworkError when attempting to fetch resource.', 'TypeError: Load failed', 'FetchError: request failed']) {
      const m = mapPgError({ code: '', message, details: '', hint: '' })
      expect(m.kind, message).toBe('network')
    }
    // A real server answer with an empty code is not mistaken for one.
    expect(mapPgError({ code: '', message: 'JWT expired' }).kind).toBe('unknown')
  })

  it('42501 (row-level security / permission) does not tell the person to try again', () => {
    const m = mapPgError({ code: '42501', message: 'new row violates row-level security policy for table "expenses"' })
    expect(m.kind).toBe('permission')
    expect(m.message).not.toMatch(/Try again/)
    expect(m.message).toMatch(/Nothing was saved/)
  })

  it('PGRST116 (no row came back) says the record is gone', () => {
    const m = mapPgError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' })
    expect(m.kind).toBe('not-found')
    expect(m.message).toMatch(/Reload/)
  })

  it('a P0001 whose message is not a string does not crash', () => {
    expect(() => mapPgError({ code: 'P0001', message: 42 as unknown as string })).not.toThrow()
  })

  it('anything else gets a plain fallback', () => {
    expect(mapPgError({ code: '99999', message: 'boom' }).message).toBe('Something went wrong. Nothing was saved. Try again.')
    expect(mapPgError('nope').kind).toBe('unknown')
  })
})
