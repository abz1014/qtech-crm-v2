import { useEffect, useId } from 'react'

/*
 * Which forms on screen hold unsaved edits. The "New version available" reload checks it so an update
 * never throws away what someone is typing. useSubmitForm registers every form built with it.
 */
const dirty = new Set<string>()

export function setFormDirty(id: string, isDirty: boolean): void {
  if (isDirty) dirty.add(id)
  else dirty.delete(id)
}

export function hasDirtyForms(): boolean {
  return dirty.size > 0
}

/** Report a form's dirty state for as long as it is mounted. */
export function useDirtyFlag(isDirty: boolean): void {
  const id = useId()
  useEffect(() => {
    setFormDirty(id, isDirty)
    return () => setFormDirty(id, false)
  }, [id, isDirty])
}

/** A dialog, sheet or alert dialog is open on screen (Radix marks them role="dialog" / "alertdialog"; menus are role="menu" and do not count). */
export function hasOpenDialog(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]') !== null
}

/** The person is in the middle of typing: a text field, text area or editable area has the focus and holds something. */
export function isTypingNow(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return (el.textContent ?? '').length > 0
  if (el instanceof HTMLTextAreaElement) return el.value.length > 0
  if (el instanceof HTMLInputElement) return /^(text|search|email|tel|url|number|password|)$/i.test(el.type) && el.value.length > 0
  return false
}
