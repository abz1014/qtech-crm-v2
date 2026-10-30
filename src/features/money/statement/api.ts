import { requireSupabase, unwrap } from '@/lib/supabase'
import { toLines, type RawStatementLine, type StatementLine } from '@/features/money/statement/model'

/* The lines of a customer's statement up to a date (customer_statement, 0125). Admin only: anyone else gets no rows. */
export async function fetchStatementLines(companyId: string, to: string): Promise<StatementLine[]> {
  const rows = unwrap(await requireSupabase().rpc('customer_statement', { p_company: companyId, p_to: to })) ?? []
  return toLines(rows as unknown as RawStatementLine[])
}
