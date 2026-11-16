import type { Locator } from '@playwright/test'

/*
 * A supplier's reply needs, for every item that gets a price, its lead time and the weight of one unit (owner, 16 Nov 2026):
 * Save reply (and Accept in Add to this job) refuses until both are in. Specs that log a reply fill them with this.
 */
export async function fillReplyDetails(
  form: Locator,
  supplierName: string,
  itemNumbers: readonly number[],
  { leadTime = '4 weeks', weight = '1.5', unit }: { leadTime?: string; weight?: string; unit?: 'kg' | 'g' | 'lb' } = {},
): Promise<void> {
  for (const n of itemNumbers) {
    await form.getByLabel(`Lead time, item ${n} from ${supplierName}`, { exact: true }).fill(leadTime)
    await form.getByLabel(`Weight of one unit, item ${n} from ${supplierName}`, { exact: true }).fill(weight)
    if (unit) await form.getByLabel(`Weight unit, item ${n} from ${supplierName}`, { exact: true }).selectOption(unit)
  }
}
