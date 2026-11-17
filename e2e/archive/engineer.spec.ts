import { expect, test, type Page } from '@playwright/test'
import { openAs } from '../support/stack'
import { archiveOff, archiveOn, jobRowName, seedArchive } from '../support/archive'
import { openJobsFor } from './shared'

/*
 * Archive old data (0141), as the engineer. The engineer sees no money and no table the archive rules lean on (orders, quotations), so the
 * archive must work for them through the job view only: the Jobs list hides old jobs, search does not find them, an archived job still
 * opens with its banner (and no Unarchive button), and no request is refused for permission (403 or Postgres 42501).
 */
test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => archiveOff())
test.afterEach(async () => archiveOff())

/** Collects permission refusals and console errors from a page. */
function watch(page: Page): { problems: string[] } {
  const problems: string[] = []
  page.on('response', res => {
    const url = res.url()
    if (!/\/(rest|rpc|storage|functions)\/v1\//.test(url) && !/\/rest\/v1\//.test(url)) return
    if (res.status() === 403) problems.push(`403 ${res.request().method()} ${url}`)
    else if (res.status() >= 400) {
      void res
        .text()
        .then(t => {
          if (t.includes('42501') || /permission denied/i.test(t)) problems.push(`${res.status()} ${url} ${t.slice(0, 160)}`)
        })
        .catch(() => undefined)
    }
  })
  page.on('console', m => {
    if (m.type() === 'error' && /42501|permission denied|\b403\b/i.test(m.text())) problems.push(`console: ${m.text()}`)
  })
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
  return { problems }
}

async function openPalette(page: Page) {
  await page.locator('#main').waitFor()
  await expect(async () => {
    if (!(await page.getByRole('dialog', { name: 'Search or jump to' }).isVisible())) await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

test('the Jobs list hides old jobs, search does not find them, and no page is refused for permission', async ({ page }) => {
  test.setTimeout(150_000)
  const f = await seedArchive()
  await archiveOn()
  const seen = watch(page)
  await openAs(page, 'engineer', '/todo')
  await expect(page.locator('#main')).toBeVisible()

  // the list
  await openJobsFor(page, f.company.name)
  await expect(page.getByRole('row', { name: jobRowName.rfq(f.newRfq.number) }).first()).toBeVisible()
  await expect(page.getByRole('row', { name: jobRowName.order(f.newOrder.number) }).first()).toBeVisible()
  await expect(page.getByRole('row', { name: jobRowName.rfq(f.oldRfq.number) })).toHaveCount(0)
  await expect(page.getByRole('row', { name: jobRowName.order(f.oldOrder.number) })).toHaveCount(0)

  // the search box on the list finds the new job by its customer ref and not the old one
  await page.goto('/jobs')
  const box = page.getByLabel('Search jobs')
  await box.fill(f.newRfq.ref)
  await expect(page.getByRole('row', { name: jobRowName.rfq(f.newRfq.number) }).first()).toBeVisible()
  await box.fill(f.oldRfq.ref)
  await expect(page.getByRole('row', { name: jobRowName.rfq(f.oldRfq.number) })).toHaveCount(0)

  // the palette (Ctrl K) does the same
  await openPalette(page)
  const input = page.getByRole('combobox')
  await input.fill(`ENQ-NEW-${f.tag}`)
  await expect(page.getByRole('option', { name: new RegExp(`Job ${f.newRfq.number} · `) })).toBeVisible()
  await input.fill(`ENQ-OLD-${f.tag}`)
  await expect(page.getByRole('option', { name: new RegExp(`Job ${f.oldRfq.number} · `) })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // an archived job still opens by its address, with the banner and no Unarchive button
  await page.goto(`/jobs/O-${f.oldOrder.number}`)
  await expect(page.getByText(/This is in the Archive \(dated before .+\)/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unarchive' })).toHaveCount(0)
  await page.goto(`/jobs/${f.oldRfq.number}`)
  await expect(page.getByText(/This is in the Archive \(dated before .+\)/)).toBeVisible()

  // Today and the list again, then settle: any refused request has been answered by now
  await page.goto('/todo')
  await expect(page.locator('#main')).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(seen.problems).toEqual([])
})

test('with archiving off the engineer sees every job, old ones included', async ({ page }) => {
  const f = await seedArchive()
  const seen = watch(page)
  await openAs(page, 'engineer', '/todo')
  await openJobsFor(page, f.company.name)
  await expect(page.getByRole('row', { name: jobRowName.rfq(f.oldRfq.number) }).first()).toBeVisible()
  await expect(page.getByRole('row', { name: jobRowName.order(f.oldOrder.number) }).first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(seen.problems).toEqual([])
})
