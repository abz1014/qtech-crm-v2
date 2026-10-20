import type { KeyboardEvent } from 'react'

/*
 * Roving focus for a radiogroup or listbox built from buttons (WCAG 2.1.1, 4.1.2): one Tab stop, the arrow keys,
 * Home and End move between the items. In a radiogroup the arrow also chooses (the radio pattern), so pass
 * `select: true`; in a listbox the arrow only moves and Enter or Space picks.
 *
 *   <div role="radiogroup" onKeyDown={e => rovingKeyDown(e, { item: '[role=radio]', select: true })}>
 *     {list.map((c, i) => <button role="radio" tabIndex={rovingTabIndex(i, chosenIndex)} … />)}
 */
export function rovingTabIndex(index: number, selectedIndex: number): 0 | -1 {
  return index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1
}

export function rovingKeyDown(e: KeyboardEvent<HTMLElement>, { item, select = false }: { item: string; select?: boolean }) {
  const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']
  if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(item)).filter(
    el => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true',
  )
  if (items.length === 0) return
  const at = items.findIndex(el => el === document.activeElement || el.contains(document.activeElement))
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
  e.preventDefault()
  const el = items[at < 0 && e.key !== 'End' && e.key !== 'Home' ? 0 : next]
  items.forEach(x => x.setAttribute('tabindex', x === el ? '0' : '-1'))
  el.focus()
  if (select) el.click()
}
