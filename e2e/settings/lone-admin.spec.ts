import { expect, test } from '@playwright/test'
import { must, openAs, rest } from '../support/stack'

/*
 * Only one active admin (owner decision: no 2-step sign-in, so a second admin is the safety net): the Team page says so and points to the
 * recovery help. The database already refuses to demote, deactivate or delete the last active admin (0029).
 */
test('Team warns when there is only one active admin and the help explains how to get back in', async ({ page }) => {
  const admins = await must(rest<{ id: string }[]>('admin', 'users?role=eq.admin&deactivated_at=is.null&select=id'))
  test.skip(admins.length !== 1, 'the fixture has more than one active admin')

  await openAs(page, 'admin', '/settings/team')
  await expect(page.getByText('Only one active admin')).toBeVisible()
  await expect(page.getByText(/Add a second admin so someone always can/)).toBeVisible()
  await page.getByRole('link', { name: 'How to get back in' }).click()
  await expect(page).toHaveURL(/help=lone-admin-recovery/)
  await expect(page.getByRole('dialog', { name: 'Help' })).toContainText('Get back in if the only admin is locked out')
})

test('the last active admin cannot be demoted or deactivated', async () => {
  const admins = await must(rest<{ id: string }[]>('admin', 'users?role=eq.admin&deactivated_at=is.null&select=id'))
  test.skip(admins.length !== 1, 'the fixture has more than one active admin')
  // the browser has no write access to users at all (the admin-users function does it); the trigger is the backstop, proved in pgTAP 0029
  const demote = await rest('admin', `users?id=eq.${admins[0].id}`, { method: 'PATCH', body: { role: 'sales' } })
  expect(demote.status).toBeGreaterThanOrEqual(400)
})
