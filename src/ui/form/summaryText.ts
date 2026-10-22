/*
 * Text for the "Fix 2 fields to continue" summary (Form.tsx). Kept apart from the component so it can be tested on its own.
 */

/** "Input tax" for a field the form gave no label: a schema key ("inputTax", "lines.0.qty") is never shown as it is. */
export function humaniseFieldName(name: string): string {
  const last = name.split('.').filter(p => !/^\d+$/.test(p)).pop() ?? name
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : name
}

/** The field's own message as a sentence ("The amount must be above zero."), or "needs a value." when it has none. */
export function summaryLine(message: unknown): string {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return 'needs a value.'
  return /[.!?]$/.test(text) ? text : `${text}.`
}
