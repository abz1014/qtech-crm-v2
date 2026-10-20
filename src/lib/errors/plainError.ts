/**
 * An error whose message is already a plain sentence written for people (the admin-users function
 * answers in them). mapPgError (src/lib/pgErrors.ts, which re-exports this) passes it through unchanged
 * instead of the generic fallback.
 */
export class PlainError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'PlainError'
    this.code = code
  }
}
