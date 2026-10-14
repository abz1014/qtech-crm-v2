import axe from 'axe-core'

/** Runs axe on a rendered subtree and returns readable violations (empty when clean). Colour contrast is skipped (jsdom has no layout; contrast is verified from the token table, DESIGN_SYSTEM section 7) and so is the page-landmark rule (a portalled fragment is not a page). */
export async function axeViolations(root: Element = document.body): Promise<string[]> {
  const result = await axe.run(root, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
  return result.violations.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.target.join(' ')).join(', ')})`)
}
