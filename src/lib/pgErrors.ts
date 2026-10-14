/*
 * Postgres errors to plain messages (U07; FE rule: errors say what happened, what
 * is safe, and what to do, and they do not apologise: DESIGN_SYSTEM section 13).
 *
 *   23505 unique_violation       "already exists"
 *   23503 foreign_key_violation  a linked record is missing, or still in use
 *   23514 check_violation        a value is outside what the table allows
 *   P0001 raise_exception        the month-lock trigger: "<Month YYYY> is closed. An admin can
 *                                reopen it." is already plain, so it is passed through unchanged.
 *                                Any other P0001 text is not written for people and is not shown.
 *
 * Works on a PostgrestError ({ code, message, details }) or anything shaped like one.
 */
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
  | 'closed-month' // P0001 closed-month message
  | 'network'
  | 'unknown'

export interface MappedError {
  kind: PgErrorKind
  /** Plain sentence for a banner or a field line. */
  message: string
  /** Constraint name when Postgres gave one, so a form can route the message to a field. */
  constraint?: string
}

export interface MapOptions {
  /** What was being saved ("company", "expense"): reads better in the unique-violation sentence. */
  entity?: string
}

const CLOSED_MONTH = /\bis closed\.\s*An admin can reopen it\.?$/i

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
  if (err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { kind: 'network', message: 'Check your connection and try again. Trying again will not create a duplicate.' }
  }
  if (!isPgLike(err)) {
    return { kind: 'unknown', message: 'Something went wrong. Nothing was saved. Try again.' }
  }
  const constraint = constraintOf(err)
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
      const inUse = /is still referenced/i.test(err.details ?? '') || /update or delete on table/i.test(err.message ?? '')
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
    case 'P0001':
      if (err.message && CLOSED_MONTH.test(err.message.trim())) {
        return { kind: 'closed-month', message: err.message.trim() }
      }
      return { kind: 'unknown', message: 'This change was refused. Nothing was saved.' }
    default:
      return { kind: 'unknown', message: 'Something went wrong. Nothing was saved. Try again.' }
  }
}
