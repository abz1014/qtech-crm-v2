/*
 * Mistyped record links (HE-20). /companies/zzz or /orders/123 can never match a record: PostgREST answers 400 with
 * Postgres code 22P02 ("invalid input syntax for type uuid"). A detail read turns that into "no such record", so the
 * screen says "isn't here" (the link is wrong) instead of "Check your connection" (which can never help).
 */

/** The database refused the id itself (not a uuid), as opposed to the request failing. */
export function isInvalidIdError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: unknown }).code === '22P02')
}

/** For a detail read's queryFn: `api.getX(id).catch(nullOnInvalidId)`. Every other error is rethrown untouched. */
export function nullOnInvalidId(err: unknown): null {
  if (isInvalidIdError(err)) return null
  throw err
}
