// When a chased item comes back (the "returns on" date in the banners). The same numbers Today's rules use
// (features/today/rules.ts THRESHOLDS): a customer chase waits 3 working days, a supplier chase 2, and a bid due within
// 3 working days shortens either to 1.

import { isBidClose } from './customerChase'
import { addBusinessDays } from './dateText'

export const CUSTOMER_WAIT_DAYS = 3
export const SUPPLIER_WAIT_DAYS = 2
export const BID_CLOSE_WAIT_DAYS = 1

export function waitDays(base: number, dueOn: string | null | undefined, today: string): number {
  return isBidClose(dueOn, today) ? Math.min(base, BID_CLOSE_WAIT_DAYS) : base
}

/** The day a customer chase made today comes back to the list. */
export function customerReturnsOn(today: string, dueOn: string | null | undefined): string {
  return addBusinessDays(today, waitDays(CUSTOMER_WAIT_DAYS, dueOn, today))
}

/** The day a supplier chase made today comes back to the list. */
export function supplierReturnsOn(today: string, dueOn: string | null | undefined, baseDays = SUPPLIER_WAIT_DAYS): string {
  return addBusinessDays(today, waitDays(baseDays, dueOn, today))
}
