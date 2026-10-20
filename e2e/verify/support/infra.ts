import { expect, test } from '@playwright/test'
import type { Role } from '../../support/stack'
import { SERVICE_KEY, db, USER } from './db'
import { open, signedIn } from './session'

/**
 * The first test of every verify suite: the helpers the suite stands on work on this stack. The service role reads past Row Level
 * Security (or the admin fallback is in use, and says so), and a signed-in context for `role` reaches its landing page.
 */
export function infraTest(role: Role): void {
  test(`support: the service-role reader and a signed-in ${role} context work on this stack`, async ({ browser }, info) => {
    console.log(SERVICE_KEY ? 'verify: database reads use the service role' : 'verify: SERVICE_ROLE_KEY is not set, database reads fall back to the admin fixture user')
    const me = await db.one<{ id: string; role: string }>(`users?id=eq.${USER[role]}&select=id,role`)
    expect(me.role).toBe(role)
    const ctx = await signedIn(browser, info, role)
    const page = await open(ctx, '/today')
    await expect(page.locator('#main')).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
    await ctx.close()
  })
}
