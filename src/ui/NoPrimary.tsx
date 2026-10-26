/**
 * Marks a screen that has no single next step (To do, Settings, a report, an engineer's order whose action lives in the On site card):
 * the screen audit (docs/audit/SCREEN_AUDIT.md) then accepts zero green buttons on it. It is a marker only; two or more green buttons
 * still fail the audit.
 */
export function NoPrimary() {
  return <span hidden data-no-primary="" />
}
