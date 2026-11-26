/* The no-access page's heading (NoAccessPage.tsx), kept apart so the page file exports only the component. */

const WHO: Record<string, string> = { admin: 'admins', sales: 'sales', engineer: 'engineers' }

/**
 * "is" or "are" for an area's name: "Team is for admins", "Expense categories are for admins", "Mistakes to fix are for admins"
 * (screen review 2026-11-24, item 25). A name is plural when one of its words is a plural noun (ends in a single s).
 */
export function areaVerb(area: string): 'is' | 'are' {
  return area.split(' ').some(w => /[^su]s$/i.test(w) && w.length > 3 && w !== w.toUpperCase()) ? 'are' : 'is'
}

/** The no-access heading: "Money is for admins and sales", "Exchange rates are for admins and sales". */
export function noAccessTitle(area: string, allowed: readonly string[]): string {
  return `${area} ${areaVerb(area)} for ${joinWords(allowed.map(r => WHO[r] ?? r))}`
}

function joinWords(words: string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}
