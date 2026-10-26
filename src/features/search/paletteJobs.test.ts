import { describe, expect, it, vi } from 'vitest'
import type { JobRow } from '@/features/jobs/api'

const job: JobRow = {
  key: '139', kind: 'enquiry', rfqId: 'r1', orderId: 'o1', companyId: 'c1', companyName: 'Harbour Textiles', siteName: null, ownerId: 'u', ownerName: 'F', items: 'Flowmeter',
  stage: 'delivered', stageDetail: 'partly invoiced, advance received', isHistory: false, lastActivityOn: '2026-10-19', repeatOf: null, cancelledOrders: 0, engineerIds: [],
}
vi.mock('@/features/search/api', () => ({ searchAll: async () => [] }))
vi.mock('@/features/jobs/api', () => ({ findJobs: async () => [job] }))
vi.mock('@/app/palette/usePalette', () => ({ usePaletteSource: () => undefined }))

import { searchPaletteSource } from '@/features/search/paletteSource'

describe('Jobs in the palette', () => {
  const find = async (office: boolean) => (await searchPaletteSource(0, office).search!('Job 139', new AbortController().signal)).find(i => i.id === 'job-139')

  it('shows the stop and its words to the office', async () => {
    expect((await find(false))?.meta).toMatch(/Invoice · partly invoiced, advance received/)
  })

  it('an engineer reads no money state and no Invoice word (it is Billing)', async () => {
    const meta = (await find(true))?.meta ?? ''
    expect(meta).toMatch(/Billing/)
    expect(meta).not.toMatch(/nvoice|advance/)
  })
})
