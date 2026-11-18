/*
 * Archive (migration 0141): the computed field `archived` on a table or view is true for old and imported rows once the archive
 * setting is on, and always false while it is off.
 *
 * LIST reads only. Use hideArchived on lists, boards, a picker's default list, badges and search lists, so the clutter drops out.
 * NUMBER reads (totals, KPIs, receivables, money, reports, memory RPCs, next-number lookups) and DETAIL reads (one row by its key)
 * must NEVER be filtered: archived rows still count, and an archived row must still open.
 * One exception (owner decision 18 Nov 2026, migration 0144): "To collect" (receivables_summary and the To collect page's own tiles) leaves
 * archived orders out. The server does it for the summary; the client never filters that number itself.
 *
 * An engineer cannot read `archived` on the base tables orders, quotations or purchase_orders (no column grant): filter through a
 * view (v_jobs, v_order_state, ...) for any read an engineer can make.
 */
export function hideArchived<Q extends { eq(column: 'archived', value: boolean): Q }>(q: Q): Q {
  return q.eq('archived', false)
}
