/*
 * Focus across a light-to-Radix swap (Popover.tsx, Dialog.tsx). When the Radix half arrives, a trigger that was the plain button is
 * rebuilt, and the browser drops focus to <body> (WCAG 2.4.3). Note where focus is before the swap and put it back on whatever
 * stands at the same place in the page afterwards.
 */
function pathOf(el: Element): number[] | null {
  const path: number[] = []
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const parent: Element | null = n.parentElement
    if (!parent) return null
    path.unshift(Array.prototype.indexOf.call(parent.children, n))
  }
  return path
}

export function swapKeepingFocus(swap: () => void): void {
  const active = document.activeElement
  const path = active && active !== document.body ? pathOf(active) : null
  swap()
  if (!path) return
  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body) return
    let n: Element | null = document.body
    for (const i of path) n = n?.children[i] ?? null
    if (n instanceof HTMLElement) n.focus({ preventScroll: true })
  })
}
