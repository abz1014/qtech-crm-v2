import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'
import { findJobs, getJobFactsFromOld, jobKeyOf, quotationNumberOf } from '@/features/jobs/api'

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('typed job numbers', () => {
  it('reads "139", "Job 139", "job-139", "O-45", "job o45"', () => {
    expect(jobKeyOf('139')).toBe('139')
    expect(jobKeyOf('Job 139')).toBe('139')
    expect(jobKeyOf('job-139')).toBe('139')
    expect(jobKeyOf('O-45')).toBe('O-45')
    expect(jobKeyOf('job o45')).toBe('O-45')
    expect(jobKeyOf('0139')).toBe('139')
  })
  it('leaves other words alone', () => {
    expect(jobKeyOf('Fauji')).toBeNull()
    expect(jobKeyOf('RFQ-0139')).toBeNull()
    expect(jobKeyOf('PO-26-0019')).toBeNull()
  })
  it('reads a quotation number', () => {
    expect(quotationNumberOf('QT-26-0031')).toBe(31)
    expect(quotationNumberOf('qt 31')).toBe(31)
    expect(quotationNumberOf('31')).toBeNull()
  })
})

const row = (key: string, extra: Record<string, unknown> = {}) => ({
  job_key: key, kind: 'enquiry', rfq_id: `rfq-${key}`, order_id: null, company_id: 'c1', site_id: null, owner_id: 'u1', items_summary: 'Flow meter', stage: 'enquiry', stage_detail: null,
  is_history: false, last_activity_on: '2026-10-01', repeat_of_job_key: null, cancelled_orders: 0, ...extra,
})

describe('findJobs: the one search behind the Jobs box and the palette', () => {
  it('"Job 139" asks the view for that job_key', async () => {
    const { calls } = installFakeDb(c => {
      if (c.target === 'v_jobs') return { data: [row('139')] }
      if (c.target === 'companies') return { data: [{ id: 'c1', name: 'Customer Ltd' }] }
      if (c.target === 'users') return { data: [{ id: 'u1', name: 'Faizan' }] }
      return { data: [] }
    })
    const jobs = await findJobs('Job 139')
    expect(jobs.map(j => j.key)).toEqual(['139'])
    expect(jobs[0].companyName).toBe('Customer Ltd')
    const view = calls.find(c => c.target === 'v_jobs')!
    expect(String(opArgs(view, 'or')?.[0])).toContain('job_key.eq.139')
  })

  it('an RFQ, order, item, PO or invoice hit finds its job through the ids search_all returned', async () => {
    const hits = [
      { kind: 'rfq' as const, id: 'r1', label: 'RFQ-0139', meta: null, companyId: null, orderId: null, role: null, score: 3 },
      { kind: 'invoice' as const, id: 'i1', label: '145', meta: null, companyId: null, orderId: 'o9', role: null, score: 3 },
      { kind: 'po' as const, id: 'p1', label: 'PO-26-0019', meta: null, companyId: null, orderId: 'o8', role: null, score: 3 },
    ]
    const { calls } = installFakeDb(c => (c.target === 'v_jobs' ? { data: [row('139')] } : { data: [] }))
    await findJobs('145', undefined, hits)
    const clause = String(opArgs(calls.find(c => c.target === 'v_jobs')!, 'or')?.[0])
    expect(clause).toContain('rfq_id.in.(r1')
    expect(clause).toContain('order_id.in.(o9,o8)')
    // the palette's own answer was reused: no second search_all
    expect(calls.some(c => c.target === 'rpc:search_all')).toBe(false)
  })

  it('a QT- number looks the quotation up and finds its enquiry', async () => {
    const { calls } = installFakeDb(c => {
      if (c.target === 'quotations') return { data: [{ rfq_id: 'r7' }] }
      if (c.target === 'v_jobs') return { data: [row('139')] }
      return { data: [] }
    })
    await findJobs('QT-26-0031', undefined, [])
    expect(opArgs(calls.find(c => c.target === 'quotations')!, 'eq')).toEqual(['number', 31])
    expect(String(opArgs(calls.find(c => c.target === 'v_jobs')!, 'or')?.[0])).toContain('rfq_id.in.(r7)')
  })

  it('an engineer who cannot read quotations still gets the other matches', async () => {
    installFakeDb(c => {
      if (c.target === 'quotations') return { error: { message: 'permission denied' } }
      if (c.target === 'v_jobs') return { data: [row('139')] }
      return { data: [] }
    })
    const jobs = await findJobs('QT-26-0031', undefined, [{ kind: 'company', id: 'c1', label: 'x', meta: null, companyId: 'c1', orderId: null, role: null, score: 1 }])
    expect(jobs).toHaveLength(1)
  })

  it('finds nothing, and asks nothing, for empty text', async () => {
    const { calls } = installFakeDb(() => ({ data: [] }))
    expect(await findJobs('   ')).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('facts from an old address (one round)', () => {
  const head = { id: 'r1', number: 139, notes: null, customer_ref: 'X-1', received_on: '2026-08-12', due_on: null, closed_on: null, close_reason: null, company: { id: 'c1', name: 'Harbour Textiles' }, site: null, contact: null, owner: { id: 'u1', name: 'Faizan' } }
  it('/rfqs/<id>: the view and the enquiry by id, together, and nothing else', async () => {
    const db = installFakeDb(c => (c.target === 'v_jobs' ? { data: row('139', { rfq_id: 'r1' }) } : { data: head }))
    const f = await getJobFactsFromOld('rfq', 'r1')
    expect(f?.job.key).toBe('139')
    expect(f?.customerRef).toBe('X-1')
    expect(db.calls.map(c => c.target).sort()).toEqual(['rfqs', 'v_jobs'])
  })
  it('/orders/<id>: the view by order id and the order with its enquiry embedded; a direct order says nothing (the caller asks the slow way)', async () => {
    const db = installFakeDb(c => (c.target === 'v_jobs' ? { data: row('139', { order_id: 'o1' }) } : { data: { rfq: head } }))
    expect((await getJobFactsFromOld('order', 'o1'))?.job.key).toBe('139')
    expect(db.calls.map(c => c.target).sort()).toEqual(['orders', 'v_jobs'])
    installFakeDb(c => (c.target === 'v_jobs' ? { data: row('O-45', { kind: 'direct', rfq_id: null, order_id: 'o2' }) } : { data: { rfq: null } }))
    expect(await getJobFactsFromOld('order', 'o2')).toBeNull()
  })
})
