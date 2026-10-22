/*
 * The button that opened the last menu whose item was chosen. A dialog opened from a menu item cannot return focus to
 * the item (the menu has closed), so Dialog returns it here instead (WCAG 2.4.3). Popover's menu variant records it.
 */
let last: HTMLElement | null = null
let at = 0

export function rememberMenuTrigger(menu: HTMLElement | null): void {
  if (!menu?.id) return
  const trigger = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`)
  if (trigger) {
    last = trigger
    at = Date.now()
  }
}

/** The trigger of a menu item chosen in the last two seconds, if it is still on the page. */
export function recentMenuTrigger(): HTMLElement | null {
  return last && last.isConnected && Date.now() - at < 2000 ? last : null
}

/**
 * Where focus goes back to when the dialog closes. Opened from a menu item, the item is gone by then (the menu closed), so
 * focus would fall to <body> (WCAG 2.4.3): return to the button that opened the menu (the one whose aria-controls names it).
 */
export function returnTarget(active: Element | null): HTMLElement | null {
  const fromMenu = recentMenuTrigger()
  if (!(active instanceof HTMLElement) || active === document.body) return fromMenu
  if (!active.closest('[role="menu"]')) return active
  if (fromMenu) return fromMenu
  for (let x: HTMLElement | null = active; x; x = x.parentElement) {
    if (!x.id) continue
    const trigger = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(x.id)}"]`)
    if (trigger) return trigger
  }
  return document.querySelector<HTMLElement>('[aria-expanded="true"][aria-haspopup]') ?? active
}
