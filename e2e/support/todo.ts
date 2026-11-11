import type { Locator, Page } from '@playwright/test'

/*
 * To do shows at most 7 rows and folds the rest into "N more" (redesign phase 3). A spec that looks for one particular row, or
 * that counts every row that needs you, opens that fold, and the closed Today and This week rows, first. The shared test database holds other suites' rows, so a row the spec
 * seeded can be past the seventh.
 */

/** Today and This week are closed rows with their count until tapped (L6): opens each, so its rows are in the page. */
export async function openClosedBlocks(page: Page): Promise<void> {
  // Each click removes that row from the match set (its block opens), so always take the first one still closed.
  const closed = page.locator('[data-block-closed]')
  for (let i = 0; i < 4 && (await closed.count()) > 0; i++) await closed.first().click()
}

/** Waits for the list to have loaded (the header's count is drawn only then), then opens the "N more" fold when there is one. */
export async function showAllTodo(page: Page): Promise<void> {
  await page.locator('[data-needs-you-count]').waitFor({ timeout: 30_000 })
  await openClosedBlocks(page)
  const fold = page.locator('section[data-more-fold]')
  if ((await fold.count()) === 0) return
  const button = fold.getByRole('button').first()
  if ((await button.getAttribute('aria-expanded')) === 'false') await button.click()
}

/** Every row counted by "need you": Late and Today, wherever it is drawn (a block or the "N more" fold). */
export const dueRows = (page: Page): Locator => page.locator('li[data-rule][data-due="late"], li[data-rule][data-due="today"]')
