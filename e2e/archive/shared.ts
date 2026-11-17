import { expect, type Page } from '@playwright/test'
import { dueRows, showAllTodo } from '../support/todo'
import { rfqRef } from '../support/stack'

/* What the three role specs share: reading the lists the archive hides. */

/** The Jobs list, searched by the fixture's company name (so only this test's jobs are in it). */
export async function openJobsFor(page: Page, company: string): Promise<void> {
  await page.goto(`/jobs?q=${encodeURIComponent(company)}`)
  await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible()
}

/** To do (Today), with every block and the "N more" fold open: the rows for one RFQ. */
export async function todayRowsFor(page: Page, rfqNumber: number) {
  await page.goto('/todo')
  await showAllTodo(page)
  return page.locator('li[data-rule]').filter({ hasText: rfqRef(rfqNumber) })
}

/**
 * The number on Home in the top bar ("Home, 3 due now"). It loads after the page, so it is read the way the counters spec does: Today's own
 * "N need you" is the figure it must show, and the link is waited for until it says so (the one number, three places).
 */
export async function homeBadge(page: Page): Promise<number> {
  const header = page.locator('[data-needs-you-count]')
  await expect(header).toBeVisible()
  const n = Number(await header.innerText())
  const link = page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /^Home/ }).first()
  await expect(link).toHaveAccessibleName(n > 0 ? new RegExp(String.raw`^Home\s?, ${n} due now$`) : /^Home$/, { timeout: 15_000 })
  return n
}

export { dueRows }

/** Text that has stopped changing (a figure that loads in two steps): the same two reads in a row. */
export async function settledText(read: () => Promise<string>): Promise<string> {
  let last = ''
  await expect(async () => {
    const a = await read()
    await new Promise(r => setTimeout(r, 400))
    const b = await read()
    expect(a).toBe(b)
    expect(a.trim()).not.toBe('')
    last = a
  }).toPass({ timeout: 20_000 })
  return last
}

/** The month key (YYYY-MM) of a day. */
export const monthOf = (day: string): string => day.slice(0, 7)
