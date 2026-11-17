/*
 * Archive pickers (money): an open item the archive hides from lists still counts in receivables, so a picker keeps offering it and
 * says so in words. The shared option controls (Select, Combobox) take plain text, so the label is a suffix on that text.
 */
export const IN_ARCHIVE = 'In Archive'

/** "INV-12 · PKR 1,000" becomes "INV-12 · PKR 1,000 · In Archive" for an archived option; any other text comes back unchanged. */
export function withArchiveTag(text: string, archived: boolean | null | undefined): string {
  return archived ? `${text} · ${IN_ARCHIVE}` : text
}
