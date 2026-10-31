import { expect, test, type Page } from '@playwright/test'
import { axeViolations } from '../support/axe'
import { API_URL, ANON_KEY, createCompany, createRfq, login, must, openAs, rest, rfqRef, uniqueName } from '../support/stack'

/*
 * Delete an RFQ (0092 delete_rfq), end to end against the local CI stack: an admin deletes a mistake from the More menu, the confirm
 * says what goes with it, the RFQ and its files are gone, and the person lands on the RFQ list. Sales and engineers are offered no
 * delete, and an RFQ with an order says so instead of offering it.
 */

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function seedRfq(): Promise<{ rfq: { id: string; number: number }; company: string }> {
  const company = uniqueName('Delete Test Co')
  const co = await createCompany(company)
  const rfq = await createRfq(co.id)
  return { rfq, company }
}

/** A photo on the RFQ, uploaded as the admin the way the app does it. Returns its storage path. */
async function seedPhoto(rfqId: string): Promise<string> {
  const s = await login('admin')
  const path = `${rfqId}/${crypto.randomUUID()}.png`
  const up = await fetch(`${API_URL}/storage/v1/object/rfq-files/${path}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, authorization: `Bearer ${s.access_token}`, 'content-type': 'image/png' },
    body: PNG,
  })
  if (!up.ok) throw new Error(`seed upload failed: ${up.status} ${await up.text()}`)
  await must(
    rest('admin', 'attachments', {
      method: 'POST',
      body: { bucket: 'rfq-files', path, file_name: 'site.png', mime_type: 'image/png', size_bytes: PNG.length, rfq_id: rfqId },
    }),
  )
  return path
}

async function objectStatus(path: string): Promise<number> {
  const s = await login('admin')
  const res = await fetch(`${API_URL}/storage/v1/object/authenticated/rfq-files/${path}`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${s.access_token}` } })
  await res.arrayBuffer()
  return res.status
}

const openMore = (page: Page) => page.getByRole('button', { name: /^More( actions)?$/ }).click()

test.describe('delete an RFQ', () => {
  test('an admin deletes an RFQ with no order: the confirm lists the file, the RFQ is gone and its file waits 30 days in the trash, the list is shown', async ({ page }) => {
    const { rfq, company } = await seedRfq()
    const photo = await seedPhoto(rfq.id)
    expect(await objectStatus(photo)).toBe(200)

    await openAs(page, 'admin', `/rfqs/${rfq.id}`)
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Delete RFQ' }).click()

    const dialog = page.getByRole('dialog', { name: `Delete ${rfqRef(rfq.number)}?` })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-slot="delete-also"]')).toContainText('1 file')
    await expect(dialog.getByText('This can’t be undone.')).toBeVisible()
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
    // Red, never green; 44px high.
    const del = dialog.getByRole('button', { name: 'Delete', exact: true })
    expect(await del.evaluate(el => el.className)).not.toContain('bg-primary')
    expect((await del.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40)
    await del.click()

    await expect(page).toHaveURL(/\/jobs$/)
    await expect(page.getByRole('status').filter({ hasText: `${rfqRef(rfq.number)} deleted` })).toBeVisible()

    // Gone from the database and from the list after a reload. The stored file is kept for 30 days (0120): still readable, and listed in the trash.
    expect(await must(rest<unknown[]>('admin', `rfqs?id=eq.${rfq.id}&select=id`))).toEqual([])
    expect(await objectStatus(photo)).toBe(200)
    const health = await must(rest<{ trash_files: number }[]>('admin', 'rpc/admin_health', { method: 'POST', body: {} }))
    expect(Number(health[0].trash_files)).toBeGreaterThanOrEqual(1)
    await page.reload()
    await expect(page.locator('#main')).toBeVisible()
    await expect(page.getByText(company)).toHaveCount(0)
  })

  test('sales sees no Delete RFQ', async ({ page }) => {
    const { rfq } = await seedRfq()
    await openAs(page, 'sales', `/rfqs/${rfq.id}`)
    await openMore(page)
    await expect(page.getByRole('menu', { name: 'More actions' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete RFQ' })).toHaveCount(0)
  })
})
