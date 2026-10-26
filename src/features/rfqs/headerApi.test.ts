import { afterEach, describe, expect, it } from 'vitest'
import { getRfqHeader } from '@/features/rfqs/api'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'

/* PERF-1: the RFQ header is read in ONE round (the customer, site, contact and owner are embedded), as the order header is. */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const row = {
  id: 'r-1',
  number: 177,
  company_id: 'c-1',
  site_id: 's-1',
  contact_id: 'k-1',
  customer_ref: 'ENQ-1',
  received_on: '2026-10-01',
  due_on: '2026-10-08',
  due_time: '14:30:00',
  owner_id: 'u-1',
  created_by: 'u-2',
  is_priority: true,
  quoted_on: null,
  closed_on: null,
  close_reason: null,
  close_note: null,
  notes: null,
  company: { id: 'c-1', name: 'Indus Textile Mills', country: 'Pakistan', city: 'Lahore', created_at: '2023-01-01T00:00:00Z' },
  site: { name: 'Plant 2', address: 'Kot Lakhpat' },
  contact: { name: 'Asma Khan', phone: '0300', email: 'a@x.pk', job_title: 'Buyer' },
  owner: { id: 'u-1', name: 'Ayesha Rana', role: 'sales', phone: null },
}

describe('getRfqHeader', () => {
  it('reads the RFQ and its state, and nothing after them: one round', async () => {
    const fake = installFakeDb(c => (c.target === 'rfqs' ? { data: row } : { data: { rfq_id: 'r-1', outcome: 'open' } }))
    const h = await getRfqHeader('r-1')
    expect(fake.calls.map(c => c.target).sort()).toEqual(['rfqs', 'v_rfq_state'])
    expect(String(opArgs(fake.calls.find(c => c.target === 'rfqs')!, 'select')?.[0])).toMatch(/company:companies!rfqs_company_id_fkey/)
    expect(h).toMatchObject({
      id: 'r-1',
      createdBy: 'u-2',
      siteId: 's-1',
      contactId: 'k-1',
      dueTime: '14:30',
      company: { id: 'c-1', name: 'Indus Textile Mills', city: 'Lahore' },
      site: { name: 'Plant 2' },
      contact: { name: 'Asma Khan', jobTitle: 'Buyer' },
      owner: { id: 'u-1', name: 'Ayesha Rana' },
    })
  })

  it('an RFQ with no site, contact or owner has none, and a missing RFQ is null', async () => {
    installFakeDb(c => (c.target === 'rfqs' ? { data: { ...row, site_id: null, contact_id: null, owner_id: null, site: null, contact: null, owner: null } } : { data: null }))
    const h = await getRfqHeader('r-1')
    expect(h?.site).toBeNull()
    expect(h?.contact).toBeNull()
    expect(h?.owner).toBeNull()
    expect(h?.state).toBeNull()
    installFakeDb(() => ({ data: null }))
    expect(await getRfqHeader('nope')).toBeNull()
  })
})
