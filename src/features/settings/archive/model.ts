import type { ArchiveEntity, PreviewRow } from '@/features/settings/archive/api'
import { generateCSV } from '@/lib/csvExport'

/* Plain words, record links and the preview file for Settings > Archive. No server calls here. */

export const ENTITY_LABEL: Record<ArchiveEntity, string> = {
  rfq: 'RFQs',
  order: 'Orders',
  quotation: 'Quotations',
  purchase_order: 'Purchase orders',
  supplier_order: 'Supplier orders',
  invoice: 'Invoices',
  payment: 'Payments',
  expense: 'Expenses',
  claim: 'Expense claims',
  topup: 'Cash top-ups',
  cash_count: 'Cash counts',
  inquiry: 'Requests to suppliers',
  clarification: 'Clarifications',
}

export function entityLabel(entity: string): string {
  return ENTITY_LABEL[entity as ArchiveEntity] ?? entity
}

/**
 * The record's normal page, or null where the app has none. RFQs and orders open their Job (the old addresses resolve the id);
 * the other kinds are only lines in a list or inside a job, with no page of their own.
 */
export function recordHref(entity: string, id: string): string | null {
  if (entity === 'rfq') return `/rfqs/${id}`
  if (entity === 'order') return `/orders/${id}`
  return null
}

export interface PreviewTotals {
  wouldHide: number
  imported: number
  open: number
  openAmountPkr: number
  alreadyUnhidden: number
}

export function previewTotals(rows: readonly PreviewRow[]): PreviewTotals {
  return rows.reduce<PreviewTotals>(
    (t, r) => ({
      wouldHide: t.wouldHide + r.wouldHide,
      imported: t.imported + r.imported,
      open: t.open + r.open,
      openAmountPkr: t.openAmountPkr + r.openAmountPkr,
      alreadyUnhidden: t.alreadyUnhidden + r.alreadyUnhidden,
    }),
    { wouldHide: 0, imported: 0, open: 0, openAmountPkr: 0, alreadyUnhidden: 0 },
  )
}

export function previewCsv(rows: readonly PreviewRow[]): string {
  const t = previewTotals(rows)
  return generateCSV(
    ['Kind', 'Would be archived', 'Imported', 'Still open', 'Open amount (PKR)', 'Already shown'],
    [
      ...rows.map(r => [entityLabel(r.entity), r.wouldHide, r.imported, r.open, r.openAmountPkr, r.alreadyUnhidden]),
      ['Total', t.wouldHide, t.imported, t.open, t.openAmountPkr, t.alreadyUnhidden],
    ],
  )
}
