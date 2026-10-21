/*
 * Postgres errors to plain messages (U07; FE rule: errors say what happened, what
 * is safe, and what to do, and they do not apologise: DESIGN_SYSTEM section 13).
 *
 *   23505 unique_violation       "already exists"
 *   23503 foreign_key_violation  a linked record is missing, or still in use
 *   23514 check_violation        a value is outside what the table allows
 *   42501 insufficient_privilege row-level security refused it: trying again will not help
 *   PGRST116                     .single() found no row: it was removed meanwhile
 *   ''    + "TypeError: ..."     postgrest-js resolves a failed fetch as an error object, not a throw
 *   P0001 raise_exception        the month-lock trigger: "<Month YYYY> is closed. An admin can
 *                                reopen it." is already plain, so it is passed through unchanged.
 *                                Any other P0001 text is not written for people and is not shown.
 *
 * Works on a PostgrestError ({ code, message, details }) or anything shaped like one.
 */
import { PlainError } from '@/lib/errors/plainError'
import { rpcMessage, type RpcAction } from '@/lib/errors/rpcMessages'

export interface PgLikeError {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

export type PgErrorKind =
  | 'unique' // 23505
  | 'already-saved' // 23505 on the client-generated primary key: the first attempt did arrive
  | 'reference-missing' // 23503 on insert/update
  | 'reference-in-use' // 23503 on delete
  | 'check' // 23514
  | 'too-large' // 22003: numeric field overflow
  | 'closed-month' // P0001 closed-month message
  | 'permission' // 42501: row-level security or a missing grant
  | 'not-found' // PGRST116: .single() found no row
  | 'network'
  | 'unknown'

export interface MappedError {
  kind: PgErrorKind
  /** Plain sentence for a banner or a field line. */
  message: string
  /** The server's own code for a PlainError (email_taken, last_admin), so a form can route it. */
  code?: string
  /** Constraint name when Postgres gave one, so a form can route the message to a field. */
  constraint?: string
  /** Help recipe id and a screen to open, when the server rule has one (src/lib/errors/rpcMessages.ts). */
  help?: string
  action?: RpcAction
}

export interface MapOptions {
  /** What was being saved ("company", "expense"): reads better in the unique-violation sentence. */
  entity?: string
}

// PlainError lives in its own module so the first load can use it without this file and its message table (perf/trim).
export { PlainError }

const CLOSED_MONTH = /\bis closed\.\s*An admin can reopen it\.?$/i
/** postgrest-js turns a rejected fetch into { code: '', message: `${err.name}: ${err.message}` }. */
const FETCH_FAILED = /^(TypeError|FetchError):/
const NETWORK = { kind: 'network', message: 'Check your connection and try again. Trying again will not create a duplicate.' } as const

function isPgLike(e: unknown): e is PgLikeError {
  return typeof e === 'object' && e !== null && ('code' in e || 'message' in e)
}

/** The constraint named in "violates unique constraint "x"" (or "…foreign key / check constraint"). */
export function constraintOf(err: PgLikeError): string | undefined {
  const m = /constraint "([^"]+)"/.exec(err.message ?? '')
  return m?.[1]
}

export function mapPgError(err: unknown, opts: MapOptions = {}): MappedError {
  const exists = opts.entity ? `A ${opts.entity} with these details already exists.` : 'That already exists.'
  if (err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { ...NETWORK }
  if (err instanceof PlainError) return { kind: 'unknown', message: err.message, code: err.code }
  if (!isPgLike(err)) {
    return { kind: 'unknown', message: 'Something went wrong. Nothing was saved. Try again.' }
  }
  const text = typeof err.message === 'string' ? err.message : ''
  if (!err.code && FETCH_FAILED.test(text)) return { ...NETWORK }
  const constraint = constraintOf({ ...err, message: text })
  const rpc = ['22023', '22004', 'P0001', 'P0002', '23514', '42501', '', undefined].includes(err.code) ? rpcMessage(text) : null
  if (rpc && !(err.code === 'P0001' && CLOSED_MONTH.test(text.trim()))) {
    const kind: PgErrorKind = err.code === '23514' ? 'check' : err.code === '42501' ? 'permission' : 'unknown'
    return { kind, ...rpc, ...(constraint ? { constraint } : {}) }
  }
  switch (err.code) {
    case '23505':
      if (constraint && /_pkey$/.test(constraint)) {
        return { kind: 'already-saved', message: 'This was already saved.', constraint }
      }
      return {
        kind: 'unique',
        message: `${exists} Open the existing one instead of adding a second.`,
        constraint,
      }
    case '23503': {
      const inUse = /is still referenced/i.test(String(err.details ?? '')) || /update or delete on table/i.test(text)
      return inUse
        ? { kind: 'reference-in-use', message: 'This is still used by other records, so it cannot be removed. Nothing was changed.', constraint }
        : { kind: 'reference-missing', message: 'A record this one points to no longer exists. Reload the page, choose it again, then save.', constraint }
    }
    case '23514':
      return {
        kind: 'check',
        message: 'One of the values is not allowed. Check that amounts are above zero and dates are in order, then save again.',
        constraint,
      }
    case '22003':
      // numeric_value_out_of_range (HW-10): a quantity or amount bigger than its column holds.
      return {
        kind: 'too-large',
        message: 'A number is too large to save. Check the quantities and amounts, then save again.',
      }
    case '42501':
      return { kind: 'permission', message: 'Your role cannot make this change. Nothing was saved. Ask an admin if it needs doing.' }
    case 'PGRST116':
      return { kind: 'not-found', message: 'This record is no longer there. It may have been removed. Reload the page.' }
    case 'P0001':
      if (CLOSED_MONTH.test(text.trim())) {
        return { kind: 'closed-month', message: text.trim() }
      }
      return { kind: 'unknown', message: 'This change was refused. Nothing was saved.' }
    default:
      return { kind: 'unknown', message: 'Something went wrong. Nothing was saved. Try again.' }
  }
}
