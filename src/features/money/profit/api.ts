/*
 * Profitability reads the two monthly views the In vs out report already reads (v_month_profit: invoiced sales net of GST, costs and
 * profit; v_month_cash_flow: money received, GST included). Both are admin only by the database. One reader each, shared, so the two
 * pages never disagree about a month.
 */
export { loadCashFlow, loadProfit } from '@/features/money/inOut/api'
