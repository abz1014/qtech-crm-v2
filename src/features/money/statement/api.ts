import { requireSupabase, unwrap } from '@/lib/supabase'
import { toLines, type RawStatementLine, type StatementLine } from '@/features/money/statement/model'

/* The lines of a customer's statement up to a date (customer_statement, 0125), or of one order of theirs (0127). Admin only: anyone else gets no rows. */
export async function fetchStatementLines(companyId: string, to: string, orderId?: string): Promise<StatementLine[]> {
  const rows = unwrap(await requireSupabase().rpc('customer_statement', { p_company: companyId, p_to: to, ...(orderId ? { p_order: orderId } : {}) })) ?? []
  return toLines(rows as unknown as RawStatementLine[])
}
