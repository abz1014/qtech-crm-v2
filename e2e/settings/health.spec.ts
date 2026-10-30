import { expect, test } from '@playwright/test'
import { must, openAs, rest } from '../support/stack'
import { showAllTodo } from '../support/todo'

/*
 * Settings > Backups and usage (migration 0120), end to end against the local CI stack.
 *   - the admin sees the last backup, the free-plan meters with real sizes, and the monthly key check, and can record the check;
 *   - sales and an engineer get no page, no menu entry, and the database refuses admin_health() to them;
 *   - a fresh stack warns about nothing on To do (the backup clock starts at the migration, the plan is nearly empty).
 * The stale-backup and 70% rows are unit tested (src/features/today/rulesHealth.test.ts); the database function and the job that
 * writes the backup time are tested in pgTAP (0120) and by backup-checks.yml.
 */
test('admin sees backup status and usage, and records the monthly key check', async ({ page }) => {
  await openAs(page, 'admin', '/settings/backups')
  await expect(page.getByRole('heading', { level: 1, name: 'Backups and usage' })).toBeVisible()
  await expect(page.getByTestId('backup-last')).toContainText('None recorded yet')
  await expect(page.getByTestId('usage-db')).toContainText('of 500.0 MB')
  await expect(page.getByTestId('usage-storage')).toContainText('of 1.00 GB')
  await expect(page.getByRole('progressbar', { name: 'Database' })).toBeVisible()
  await expect(page.getByTestId('decrypt-last')).toContainText('Never checked')

  await page.getByRole('button', { name: 'I opened a backup with my key today' }).click()
  await expect(page.getByTestId('decrypt-last')).toContainText('Last checked')

  // a fresh stack has nothing to warn about
  await page.goto('/todo')
  await showAllTodo(page)
  await expect(page.locator('li[data-rule="backup_stale"], li[data-rule="usage_high"], li[data-rule="decrypt_test"]')).toHaveCount(0)
})

test('admin_health answers the admin and refuses sales and engineers', async () => {
  const admin = await must(rest<{ db_bytes: number; storage_bytes: number }[]>('admin', 'rpc/admin_health', { method: 'POST', body: {} }))
  expect(Number(admin[0].db_bytes)).toBeGreaterThan(0)
  expect(Number(admin[0].storage_bytes)).toBeGreaterThanOrEqual(0)
  for (const who of ['sales', 'engineer'] as const) {
    const r = await rest(who, 'rpc/admin_health', { method: 'POST', body: {} })
    expect(r.status).toBeGreaterThanOrEqual(400)
    const c = await rest(who, 'rpc/confirm_backup_decrypt_test', { method: 'POST', body: {} })
    expect(c.status).toBeGreaterThanOrEqual(400)
  }
})

test('sales has no Backups and usage page and no menu entry', async ({ page }) => {
  await openAs(page, 'sales', '/settings/backups')
  await expect(page.locator('#main')).toContainText('Backups and usage is for')
  await expect(page.getByRole('link', { name: 'Backups and usage' })).toHaveCount(0)
})

test('an engineer has no Backups and usage page', async ({ page }) => {
  await openAs(page, 'engineer', '/settings/backups')
  await expect(page.locator('#main')).toContainText('Backups and usage is for')
})
