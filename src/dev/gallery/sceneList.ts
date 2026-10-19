/*
 * The gallery's overlay scenes, as plain data so the Playwright suites (e2e/support.ts) and the
 * gallery page share one list. Add a scene here, give it a node in scenes.tsx and, if it needs a
 * click or typing to open, its steps in e2e/support.ts.
 */
export const SCENE_LIST = [
  { scene: 'dialog-default', group: 'Dialog', label: 'Default' },
  { scene: 'dialog-busy', group: 'Dialog', label: 'Busy' },
  { scene: 'dialog-error', group: 'Dialog', label: 'With error' },
  { scene: 'dialog-confirm', group: 'Dialog', label: 'Destructive confirm' },
  { scene: 'dialog-long', group: 'Dialog', label: 'Long body scrolls' },
  { scene: 'dialog-money', group: 'Dialog', label: 'Record payment (pre-filled, with source)' },
  { scene: 'palette-idle', group: 'Command palette', label: 'Idle: recent, actions, jump to' },
  { scene: 'palette-typing', group: 'Command palette', label: 'Searching' },
  { scene: 'palette-empty', group: 'Command palette', label: 'No results' },
  { scene: 'toast-undo', group: 'Toast', label: 'With Undo (10 s)' },
  { scene: 'toast-settled', group: 'Toast', label: 'Settled after the countdown' },
  { scene: 'toast-error', group: 'Toast', label: 'Error with retry' },
  { scene: 'toast-plain', group: 'Toast', label: 'Plain' },
  { scene: 'toast-paused', group: 'Toast', label: 'Paused on hover' },
  { scene: 'toast-two', group: 'Toast', label: 'Two at once' },
  { scene: 'toast-phone', group: 'Toast', label: 'Phone: full width, 44px Undo (see the 375 photo)' },
  { scene: 'combobox-open', group: 'Combobox', label: 'Open with the Add new row' },
  { scene: 'overlays', group: 'Tooltip and Popover', label: 'Tooltip, menu and information popover' },
  { scene: 'tooltips', group: 'Tooltip and Popover', label: 'Tooltip variants: disabled why, long label, status, two lines' },
  { scene: 'shell', group: 'Shell', label: 'Top bar, phone bar and phone tabs (5 tabs, with counts)' },
] as const

export type SceneName = (typeof SCENE_LIST)[number]['scene']
