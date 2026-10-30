import { expect, type Locator, type Page } from '@playwright/test'

/*
 * The Job page's stage sections (src/features/jobs/StageSections.tsx), for the specs that used to drive the RFQ page and the Order page.
 * The sections are an accordion, ONE open at a time, and each stage holds the components those pages held:
 *   Quotation       items and supplier prices, suppliers asked and their replies, the quotations
 *   Order           Mark won (until there is an order), the customer PO, the order lines (Edit GST and lines, Remove line, Add line)
 *   Supplier order  Choose supplier, Add supplier, Issue PO, Mark placed (no PO), Pay supplier
 *   Delivery        Delivered today, Chase goods, the expected date, Commissioning (Edit, Mark done today)
 *   Invoice         Create invoice, Record payment, the payment reminder
 *   Payment         the payments received and their menu (Correct, Void)
 * The old /rfqs/<id> and /orders/<id> addresses redirect here (src/app/oldAddresses.tsx), so a spec may open either; the job page opens on
 * the stage the job is at.
 */
export type StageName = 'Enquiry' | 'Quotation' | 'Order' | 'Supplier order' | 'Delivery' | 'Invoice' | 'Payment'

/** What the address becomes once an order is made, or an old address has redirected: /jobs/139, /jobs/O-45. */
export const JOB_URL = /\/jobs\/[^/?#]+(?:[?#].*)?$/

export const stagesOf = (page: Page): Locator => page.locator('[data-stages]')

/** Opens the stage (closing whichever other one is open) and returns its body. */
export async function openStage(page: Page, name: StageName): Promise<Locator> {
  const head = stagesOf(page).getByRole('button', { name: new RegExp(`^${name}`) })
  await head.waitFor()
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  const body = stagesOf(page).getByRole('region', { name: `${name} stage` })
  await expect(body).toBeVisible()
  return body
}

/**
 * Mark won. Once a quotation is out it is the next-step band's green button (the stage does not repeat it); before that it is the Order
 * stage's own button. Never both at once.
 */
export async function markWonButton(page: Page): Promise<Locator> {
  await stagesOf(page).waitFor()
  const won = page.getByRole('button', { name: 'Mark won', exact: true })
  if ((await won.count()) === 0) await openStage(page, 'Order')
  return won
}
