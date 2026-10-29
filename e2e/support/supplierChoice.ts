import type { Locator, Page } from '@playwright/test'

/*
 * Owner decision 2026-10-29: "I don't want the software to select a supplier for us." The Mark won dialog (Create order) starts every
 * item that has quotes on "Choose a supplier" and will not create the order until a person has picked one on each ticked line.
 * These helpers are that person: open a line's list of quotes and take one.
 */

/** Opens the picker named `label` ("Supplier for line 1", "Supplier for part 2, line 1") and picks `who`, else the first quote listed. */
export async function chooseSupplier(
  page: Page,
  d: Locator,
  label: string,
  who?: string | RegExp,
  tap: (target: Locator) => Promise<void> = target => target.click(),
): Promise<void> {
  await tap(d.getByRole('button', { name: label }))
  await tap(who === undefined ? page.locator('[role=option]:not([disabled])').first() : page.getByRole('option', { name: who }))
}

const UNCHOSEN = /Supplier for (?:line \d+|part \d+, line \d+): Choose a supplier/

/** Picks the first quote of every picker still on "Choose a supplier" (or `who` on each, when it is one of that line's quotes). */
export async function chooseAllSuppliers(page: Page, d: Locator, who?: string | RegExp): Promise<void> {
  // the list of lines is drawn once the quotes have loaded; before that there is nothing to count
  await d.getByRole('group', { name: 'Suppliers by line' }).waitFor()
  for (let guard = 0; guard < 30; guard++) {
    const open = d.getByRole('button', { name: UNCHOSEN })
    if ((await open.count()) === 0) return
    await open.first().click()
    const options = who === undefined ? page.locator('[role=option]:not([disabled])') : page.getByRole('option', { name: who })
    await options.first().click()
  }
}
