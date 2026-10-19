// S16 Part 2: who may read what. Source: docs/DATA_MODEL.md section 10 (the access matrix). Read checks only.
// "all" = every active staff role may read it. "admin" = admin only. "adminSales" = admin and sales, never the engineer.
// A denied object may answer with a permission error or with zero rows; it must never return a row.
// Objects not listed here are still covered by Part 1 (anonymous denial); the smoke prints them as "unclassified".
export const READ_ACCESS = {
  all: [
    'users', 'companies', 'company_sites', 'contacts', 'brands', 'company_brands', 'rfqs', 'rfq_items',
    'supplier_inquiries', 'supplier_quote_lines', 'clarifications', 'orders', 'order_items', 'supplier_orders',
    'order_engineers', 'attachments', 'snoozes', 'targets', 'company_profile', 'fx_rates', 'quotations',
    'purchase_orders', 'v_company_roles', 'v_rfq_state', 'v_inquiry_state', 'v_order_state', 'v_fx_latest',
    'v_supplier_activity', 'v_supplier_stats',
  ],
  adminSales: ['invoices', 'v_invoice_state', 'v_gst_register', 'v_gst_month'],
  admin: [
    'order_costs', 'payments_in', 'expenses', 'recurring_expenses', 'expense_categories', 'closed_months',
    'audit_log', 'v_order_money', 'v_cash_month', 'v_payment_net', 'v_month_pnl', 'v_month_expense_category',
    'v_month_team',
  ],
}

export function mayRead(role, name) {
  if (READ_ACCESS.all.includes(name)) return true
  if (READ_ACCESS.adminSales.includes(name)) return role === 'admin' || role === 'sales'
  if (READ_ACCESS.admin.includes(name)) return role === 'admin'
  return null // unclassified
}
