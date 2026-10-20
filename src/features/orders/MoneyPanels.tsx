/*
 * The money panel of the order page (g2-order-detail.html): "Margin" (admin only, M04). It lives with the other money code because it
 * reads order_costs, expenses and v_order_money.
 *
 * The "Invoices and payments" panel that used to sit under it was folded into the header's status strip by the UX audit of 2026-10-19
 * (screens.md 8, "one place for each action"): the Invoicing cell says what is invoiced and has "Create invoice", the Payment cell says
 * what was received, the balance and its due date and has "Record payment" (admin), unless either is the page's one primary step.
 */
export { MarginPanel } from '@/features/money/costs/MarginPanel'
