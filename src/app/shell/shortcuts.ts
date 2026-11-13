import { modKeyLabel } from '@/ui/paletteSources'

/*
 * The one list of keyboard shortcuts (spec round 2, 4.2). The Keyboard shortcuts sheet draws it, and a source test checks
 * that every key the shell, the palette, tables, toasts and the Add expenses sheet react to is listed here, so a new key
 * cannot ship without showing up in the sheet.
 *
 * `keys` is what the sheet shows, left to right. Each entry is one key cap, except the joining words in `KEY_WORDS`
 * ("or", "then"), which are drawn as plain text: ['G', 'then', 'T'], ['↑', '↓', 'or', 'J', 'K'].
 * `handles` lists the `KeyboardEvent.key` values (lower case) the entry stands for; only the source test reads it.
 */
export const SHORTCUT_GROUPS = ['Anywhere', 'Lists and tables', 'Search box', 'Writing', 'Add expenses'] as const
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]

export interface Shortcut {
  group: ShortcutGroup
  keys: string[]
  what: string
  /** Where it works when that is narrower than its group ("In a list's search"). */
  where?: string
  handles?: string[]
  /** Who can use it. Left out: everyone. An engineer is not shown keys that do nothing for them (live bug 32). */
  roles?: readonly ShortcutRole[]
}

export type ShortcutRole = 'admin' | 'sales' | 'engineer'

/** Where a keyboard is likely: a fine pointer from md up. Phones never see a shortcuts entry or hint. */
export const KEYBOARD_MEDIA = '(pointer: fine) and (min-width: 768px)'

/** Joining words drawn as text between key caps. */
export const KEY_WORDS: ReadonlySet<string> = new Set(['or', 'then'])

/** One sentence under a group's heading, for what is not a key (the Add expenses legend moved here). */
export const GROUP_NOTES: Partial<Record<ShortcutGroup, string>> = {
  Anywhere: 'Single keys (N, E, O, G then T, /, ?) work outside a text box. You can turn them off in Settings, Your details.',
  'Add expenses': 'A dashed box was filled in for you: type over it to change it. A solid box is what you typed.',
}

/** A group's note for one role: an engineer's Anywhere note names only the keys that work for them. */
export function groupNote(group: ShortcutGroup, role?: string): string | undefined {
  if (group === 'Anywhere' && role === 'engineer') return 'Single keys (G then T, /, ?) work outside a text box. You can turn them off in Settings, Your details.'
  return GROUP_NOTES[group]
}

/** The list, with the platform's modifier key: ⌘ on a Mac, Ctrl elsewhere. */
export function shortcutList(mod: string = modKeyLabel()): Shortcut[] {
  return [
    // Anywhere outside a text field
    { group: 'Anywhere', keys: [mod, 'K'], what: 'Search or jump to', where: 'Also works inside a text box', handles: ['k'] },
    { group: 'Anywhere', keys: ['N'], what: 'New enquiry', where: 'Admin and sales', handles: ['n'], roles: ['admin', 'sales'] },
    { group: 'Anywhere', keys: ['E'], what: 'Add an expense', where: 'Admin', handles: ['e'], roles: ['admin'] },
    { group: 'Anywhere', keys: ['O'], what: 'Order without enquiry', where: 'Admin and sales', handles: ['o'], roles: ['admin', 'sales'] },
    { group: 'Anywhere', keys: ['G', 'then', 'T'], what: 'Go to To do', handles: ['g', 't'] },
    { group: 'Anywhere', keys: [mod, 'V'], what: 'Paste a message or picture on To do (starts a New enquiry) or on a job (adds it to the job)', handles: ['v'], roles: ['admin', 'sales'] },
    { group: 'Anywhere', keys: [mod, 'V'], what: 'Paste a message or picture on a job (adds it to the job)', handles: ['v'], roles: ['engineer'] },
    { group: 'Anywhere', keys: [mod, 'Z'], what: 'Undo the last action while its Undo button shows', handles: ['z'] },
    { group: 'Anywhere', keys: ['Esc'], what: 'Close a dialog, sheet or menu', handles: ['escape'] },
    { group: 'Anywhere', keys: ['?'], what: 'Show this list', handles: ['?'] },

    // Lists and tables
    { group: 'Lists and tables', keys: ['/'], what: "Jump to the list's search", handles: ['/'] },
    { group: 'Lists and tables', keys: ['Esc'], what: 'Clear the search; press again to leave it', where: "In a list's search", handles: ['escape'] },
    { group: 'Lists and tables', keys: ['↑', '↓', 'or', 'J', 'K'], what: 'Move between rows', handles: ['arrowup', 'arrowdown', 'j', 'k'] },
    { group: 'Lists and tables', keys: ['Home', 'End'], what: 'First or last row', handles: ['home', 'end'] },
    { group: 'Lists and tables', keys: ['Page Up', 'Page Down'], what: 'Move 10 rows', handles: ['pageup', 'pagedown'] },
    { group: 'Lists and tables', keys: ['Enter'], what: 'Open the row', handles: ['enter'] },
    { group: 'Lists and tables', keys: ['Space'], what: 'Tick the row', where: 'GST register, bank matching', handles: [' '], roles: ['admin'] },

    // The search box (palette)
    { group: 'Search box', keys: ['↑', '↓'], what: 'Move through the results', handles: ['arrowup', 'arrowdown'] },
    { group: 'Search box', keys: ['Enter'], what: 'Open the result', handles: ['enter'] },
    { group: 'Search box', keys: [mod, 'Enter'], what: 'Open it in a new tab', handles: ['enter'] },
    { group: 'Search box', keys: ['Esc'], what: 'Close the search', handles: ['escape'] },

    // Writing
    { group: 'Writing', keys: [mod, 'Enter'], what: 'Save', where: 'Add to this job, customer questions, an answer', handles: ['enter'] },
    { group: 'Writing', keys: ['Enter'], what: 'Save an inline change', where: 'A name, a supplier price, a line price, the expected cost', handles: ['enter'], roles: ['admin', 'sales'] },
    { group: 'Writing', keys: ['Enter'], what: 'Save an inline change', where: 'A name', handles: ['enter'], roles: ['engineer'] },
    { group: 'Writing', keys: ['Esc'], what: 'Cancel an inline change', handles: ['escape'] },

    // Add expenses
    { group: 'Add expenses', keys: ['Enter'], what: 'New row under a filled one', handles: ['enter'], roles: ['admin'] },
    { group: 'Add expenses', keys: ['Tab'], what: 'Next box', handles: ['tab'], roles: ['admin'] },
    { group: 'Add expenses', keys: [mod, 'Enter'], what: 'Save all', handles: ['enter'], roles: ['admin'] },
    { group: 'Add expenses', keys: ['↑', '↓', 'then', 'Tab'], what: 'Choose a category in its list and accept it', handles: ['arrowup', 'arrowdown', 'tab'], roles: ['admin'] },
    { group: 'Add expenses', keys: ['Esc'], what: 'Close the category list, or the sheet', handles: ['escape'], roles: ['admin'] },
  ]
}

/** What one role sees in the sheet. No role (or an unknown one) gets the whole list. */
export function shortcutsFor(role?: string, mod: string = modKeyLabel()): Shortcut[] {
  return shortcutList(mod).filter(s => !role || !s.roles || (s.roles as readonly string[]).includes(role))
}

/** Every `KeyboardEvent.key` value (lower case) the list stands for. */
export function handledKeys(list: readonly Shortcut[] = shortcutList()): Set<string> {
  return new Set(list.flatMap(s => s.handles ?? []))
}
