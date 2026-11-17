import { setSupabaseForTests, type Db } from '@/lib/supabase'

/*
 * A scriptable stand-in for the Supabase client, for hook and api unit tests. Every chained call is
 * recorded; awaiting the chain answers with whatever `respond` returns for that call. No network, no
 * schema: the real queries are proven against the real database by the Playwright suite.
 */
export interface FakeCall {
  /** A table or view name, or "rpc:<function>". */
  target: string
  /** The kind of statement: select, insert, update, upsert, delete or rpc. */
  verb: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'
  /** Every chained method in order, with its arguments: [['select', ['id']], ['eq', ['company_id', 'c1']]]. For rpc, the first op is ['args', [{...}]]. */
  ops: [string, unknown[]][]
}

export interface FakeResult {
  data?: unknown
  /** The exact row count a `{ count: 'exact' }` read returns. */
  count?: number | null
  error?: { code?: string; message: string; details?: string | null; hint?: string | null } | null
}

const WRITES = ['insert', 'update', 'upsert', 'delete']

/** The arguments of the first chained call with this name, or undefined. */
export function opArgs(call: FakeCall, name: string): unknown[] | undefined {
  return call.ops.find(([n]) => n === name)?.[1]
}

/**
 * Whether a fixture row passes the eq / neq / is filters of a call, the way PostgREST would. A row with no `archived` field counts as
 * archived = false (migration 0141), so older fixtures keep passing archive filters. Other filter kinds are ignored.
 */
export function rowMatchesFilters(row: Record<string, unknown>, call: FakeCall): boolean {
  const val = (col: string) => (col in row ? row[col] : col === 'archived' ? false : undefined)
  return call.ops.every(([name, args]) => {
    const [col, v] = args as [string, unknown]
    if (name === 'eq') return val(col) === v
    if (name === 'neq') return val(col) !== v
    if (name === 'is') return (val(col) ?? null) === v
    return true
  })
}

/** The rows of a fixture that pass the call's filters (see rowMatchesFilters). */
export function filterRows<T extends Record<string, unknown>>(rows: readonly T[], call: FakeCall): T[] {
  return rows.filter(r => rowMatchesFilters(r, call))
}

export function installFakeDb(respond: (call: FakeCall) => FakeResult | Promise<FakeResult>) {
  const calls: FakeCall[] = []
  const chain = (target: string, verb: FakeCall['verb'], first?: [string, unknown[]]) => {
    const call: FakeCall = { target, verb, ops: first ? [first] : [] }
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
              calls.push(call)
              Promise.resolve(respond(call)).then(r => resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }), reject)
            }
          }
          return (...args: unknown[]) => {
            call.ops.push([prop, args])
            if (WRITES.includes(prop) && call.verb === 'select') call.verb = prop as FakeCall['verb']
            return proxy
          }
        },
      },
    )
    return proxy
  }
  const db = {
    from: (table: string) => chain(table, 'select'),
    rpc: (fn: string, args: unknown) => chain(`rpc:${fn}`, 'rpc', ['args', [args]]),
  }
  setSupabaseForTests(db as unknown as Db)
  return { calls, uninstall: () => setSupabaseForTests(null) }
}
