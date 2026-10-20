import type { CompanyListRow } from '@/features/companies/api'

/** The country most existing companies share, if there are enough of them to say so. Read from the cache: no extra request. */
export function commonCountry(rows: readonly Pick<CompanyListRow, 'country'>[] | undefined): string | null {
  if (!rows || rows.length < 5) return null
  const count = new Map<string, number>()
  for (const r of rows) {
    // free text: count "Pakistan" and "pakistan" as one country (the first spelling seen is the one shown)
    const c = r.country?.trim()
    if (!c) continue
    const key = [...count.keys()].find(k => k.toLowerCase() === c.toLowerCase()) ?? c
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]
  return top && top[1] / rows.length >= 0.5 ? top[0] : null
}
