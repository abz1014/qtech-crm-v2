/** A month key, "2026-10": what Money's month views and reports carry in the address. */
export const isMonthKey = (s: string | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
