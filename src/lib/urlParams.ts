/*
 * List filters read from the address (HW-24 / HE-1). A value the list does not know (an old bookmark, a typo, a link from an earlier
 * version) is ignored, never trusted: the page falls back to its default instead of crashing on a status it cannot name. Use this
 * for every list URL parameter that must be one of a fixed set.
 */

/** `value` when it is one of `allowed`, otherwise `fallback`. */
export function knownParam<T extends string, F extends string = T>(value: string | null | undefined, allowed: readonly T[], fallback: F): T | F {
  return value != null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}
