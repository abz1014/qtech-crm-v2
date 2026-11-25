import { afterEach, describe, expect, it } from 'vitest'
import * as api from '@/features/settings/archive/api'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'

let fake: ReturnType<typeof installFakeDb> | undefined
afterEach(() => fake?.uninstall())
const rpcArgs = (c: FakeCall) => opArgs(c, 'args')?.[0]

describe('archive api', () => {
  it('reads the one settings row', async () => {
    fake = installFakeDb(() => ({ data: { enabled: true, cutoff: '2026-01-01' } }))
    expect(await api.getArchiveSetting()).toEqual({ enabled: true, cutoff: '2026-01-01' })
    expect(fake.calls[0].target).toBe('archive_settings')
    expect(opArgs(fake.calls[0], 'eq')).toEqual(['id', 1])
  })

  it('archive_set sends the switch and the date', async () => {
    fake = installFakeDb(() => ({ data: {} }))
    await api.setArchive(true, '2026-01-01')
    expect(fake.calls[0].target).toBe('rpc:archive_set')
    expect(rpcArgs(fake.calls[0])).toEqual({ p_enabled: true, p_cutoff: '2026-01-01' })
  })

  it('archive_preview sends the date and turns numbers into numbers', async () => {
    fake = installFakeDb(() => ({
      data: [{ entity: 'rfq', would_hide: '3', of_which_imported: 1, of_which_open: 2, open_amount_pkr: '1500.5', already_unhidden: 0 }],
    }))
    const rows = await api.previewArchive('2026-01-01')
    expect(rpcArgs(fake.calls[0])).toEqual({ p_cutoff: '2026-01-01' })
    expect(rows).toEqual([{ entity: 'rfq', wouldHide: 3, imported: 1, open: 2, openAmountPkr: 1500.5, alreadyUnhidden: 0 }])
  })

  it('archive_list sends the filters; a blank search is left out', async () => {
    fake = installFakeDb(() => ({
      data: [{ id: 'r1', entity: 'order', ref: 'ORD-1', company_id: 'c1', company_name: 'Acme', doc_date: '2025-01-02', amount: '10', is_imported: true, is_unhidden: false }],
    }))
    const rows = await api.listArchive({ entity: 'order', companyId: 'c1', search: '  ', limit: 50, offset: 100 })
    expect(rpcArgs(fake.calls[0])).toEqual({ p_entity: 'order', p_company_id: 'c1', p_search: undefined, p_limit: 50, p_offset: 100 })
    expect(rows[0]).toMatchObject({ id: 'r1', ref: 'ORD-1', companyName: 'Acme', amount: 10, isImported: true, isUnhidden: false })
    await api.listArchive({ entity: 'order', companyId: null, search: ' acme ', limit: 50, offset: 0 })
    expect(rpcArgs(fake.calls[1])).toMatchObject({ p_company_id: undefined, p_search: 'acme' })
  })

  it('shows RFQ and order numbers as RFQ-0139 and ORD-0045', async () => {
    fake = installFakeDb(() => ({ data: [{ id: 'r1', entity: 'rfq', ref: '139', company_id: null, company_name: null, doc_date: null, amount: null, is_imported: false, is_unhidden: false }] }))
    expect((await api.listArchive({ entity: 'rfq', companyId: null, search: '', limit: 50, offset: 0 }))[0].ref).toBe('RFQ-0139')
    fake.uninstall()
    fake = installFakeDb(() => ({ data: [{ id: 'o1', entity: 'order', ref: '45', company_id: null, company_name: null, doc_date: null, amount: null, is_imported: false, is_unhidden: false }] }))
    expect((await api.listArchive({ entity: 'order', companyId: null, search: '', limit: 50, offset: 0 }))[0].ref).toBe('ORD-0045')
    expect(fake.calls).toHaveLength(1)
  })

  it('shows quotations as QTS or QT with the first issue year and Rev n', async () => {
    const row = (id: string, ref: string) => ({ id, entity: 'quotation', ref, company_id: null, company_name: null, doc_date: null, amount: null, is_imported: false, is_unhidden: false })
    fake = installFakeDb(c => {
      if (c.target === 'rpc:archive_list') return { data: [row('q1', '42/1'), row('q2', '4810'), row('q3', '7')] }
      if (opArgs(c, 'in')?.[0] === 'id')
        return {
          data: [
            { id: 'q1', number: 42, revision: 1, quote_code: null, issued_on: '2026-01-05', rfq_id: 'a' },
            { id: 'q2', number: 4810, revision: 0, quote_code: 'IFL', issued_on: '2026-11-20', rfq_id: 'b' },
          ],
        }
      return {
        data: [
          { rfq_id: 'a', revision: 1, issued_on: '2026-01-05' },
          { rfq_id: 'a', revision: 0, issued_on: '2025-12-30' },
          { rfq_id: 'b', revision: 0, issued_on: '2026-11-20' },
        ],
      }
    })
    const rows = await api.listArchive({ entity: 'quotation', companyId: null, search: '', limit: 50, offset: 0 })
    expect(rows.map(r => r.ref)).toEqual(['QT-25-0042 Rev 1', 'QTS-IFL-4810', '7'])
    expect(fake.calls.map(c => c.target)).toEqual(['rpc:archive_list', 'quotations', 'quotations'])
    expect(opArgs(fake.calls[2], 'in')).toEqual(['rfq_id', ['a', 'b']])
  })

  it('shows purchase orders as PO-YY-NNNN with the first issue year', async () => {
    const row = (id: string, ref: string) => ({ id, entity: 'purchase_order', ref, company_id: null, company_name: null, doc_date: null, amount: null, is_imported: false, is_unhidden: false })
    fake = installFakeDb(c => {
      if (c.target === 'rpc:archive_list') return { data: [row('p1', '17'), row('p2', '18/2')] }
      if (opArgs(c, 'in')?.[0] === 'id')
        return {
          data: [
            { id: 'p1', number: 17, revision: 0, issued_on: '2026-03-01', supplier_order_id: 's1' },
            { id: 'p2', number: 18, revision: 2, issued_on: '2026-01-10', supplier_order_id: 's2' },
          ],
        }
      return {
        data: [
          { supplier_order_id: 's1', revision: 0, issued_on: '2026-03-01' },
          { supplier_order_id: 's2', revision: 0, issued_on: '2025-12-01' },
          { supplier_order_id: 's2', revision: 2, issued_on: '2026-01-10' },
        ],
      }
    })
    const rows = await api.listArchive({ entity: 'purchase_order', companyId: null, search: '', limit: 50, offset: 0 })
    expect(rows.map(r => r.ref)).toEqual(['PO-26-0017', 'PO-25-0018 Rev 2'])
  })

  it('unhide and rehide send the entity and the id', async () => {
    fake = installFakeDb(() => ({ data: true }))
    await api.unhideRecord('invoice', 'i1')
    await api.rehideRecord('invoice', 'i1')
    expect(fake.calls.map(c => c.target)).toEqual(['rpc:archive_unhide', 'rpc:archive_rehide'])
    expect(fake.calls.map(rpcArgs)).toEqual([
      { p_entity: 'invoice', p_id: 'i1' },
      { p_entity: 'invoice', p_id: 'i1' },
    ])
  })

  it('throws the database error', async () => {
    fake = installFakeDb(() => ({ error: { code: '42501', message: 'Only an admin can change the archive setting.' } }))
    await expect(api.setArchive(false, '2026-01-01')).rejects.toMatchObject({ code: '42501' })
  })
})
