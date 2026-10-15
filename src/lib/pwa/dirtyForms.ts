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
