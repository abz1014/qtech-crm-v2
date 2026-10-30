import { requireSupabase, unwrap } from '@/lib/supabase'

/*
 * Exchange rates (R15). The latest rate per currency is read through `listFxLatest` in the rfqs api (v_fx_latest, manual beats
 * auto on the same day); this file adds the history of one currency and the one write, `set_fx_rate`.
 */

export interface FxHistoryRow {
  /** fx_rates.as_of, YYYY-MM-DD. */
  asOf: string
  ratePkr: number
  source: 'auto' | 'manual'
}

/** The latest rows of one currency, newest first. A manual row and an automatic row for the same day are both listed (manual first). */
export async function listFxHistory(currency: string, limit = 12): Promise<FxHistoryRow[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db
      .from('fx_rates')
      .select('as_of, rate_pkr, source')
      .eq('currency', currency)
      .order('as_of', { ascending: false })
      .order('source', { ascending: false })
      .limit(limit),
  )
  return rows.map(r => ({ asOf: r.as_of, ratePkr: Number(r.rate_pkr), source: r.source === 'manual' ? 'manual' : 'auto' }))
}

/** When the nightly job last stored an automatic rate (fx_rates.created_at of the newest automatic row), or null if it never has. */
export async function getLastAutoRun(): Promise<string | null> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('fx_rates').select('created_at').eq('source', 'auto').order('created_at', { ascending: false }).limit(1))
  return rows[0]?.created_at ?? null
}

/** set_fx_rate: a manual rate for the day (today when `asOf` is omitted). Entering it twice for the same day replaces it. */
export async function setFxRate(input: { currency: string; ratePkr: number; asOf?: string; confirm?: boolean }): Promise<string> {
  const db = requireSupabase()
  // 0114: a rate more than 20 percent away from the latest is refused (HINT fx_rate_far) until `confirm` is true
  const { data, error } = await db.rpc('set_fx_rate', { p_currency: input.currency, p_rate_pkr: input.ratePkr, p_as_of: input.asOf, p_confirm: input.confirm ?? false })
  if (error) throw error
  return data as string
}
