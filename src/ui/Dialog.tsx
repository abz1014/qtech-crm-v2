import { cloneElement, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { useBackToClose } from '@/lib/useBackToClose'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { GuardContext, preloadDialog, useDialogImpl, type Guard } from '@/ui/dialogStore'
import type { DialogContentProps } from '@/ui/dialogImpl'

/*
 * Dialog (INVENTORY: U03; D08 section 05). The one modal wrapper, on Radix (downloaded after the first paint, or when a dialog first
 * opens: dialogImpl.tsx; the tests load it up front, src/test/setup.ts):
 * focus trap, Esc, scrim click, aria-labelledby/-describedby, and focus returned
 * to whatever opened it. A modal on desktop, a bottom sheet below 768.
 *
 * Open: focus goes to the first field in the body (or the element marked
 * data-autofocus); on a confirm it goes to the least destructive button
 * (Cancel, marked data-cancel). While `busy`, Esc, the scrim and the close
 * button are ignored so a request in flight cannot be abandoned half way.
 *
 * Composition (a form keeps its submit in the footer through the `form` attribute):
 *   <Dialog open={open} onOpenChange={setOpen} busy={pending}>
 *     <DialogContent title="Record payment" context="ORD-0038 · Punjab Cement Ltd" icon={Banknote}
 *       footer={<><Button data-cancel onClick={close}>Cancel</Button><Button variant="primary" type="submit" form="pay">Save payment</Button></>}>
 *       <form id="pay">…</form>
 *     </DialogContent>
 *   </Dialog>
 */

/*
 * Discard guard (learnability spec 3.3): once something was typed, a stray tap must not throw it away. While the dialog is
 * `dirty` (the prop, or any <Form> inside it with changes, reported through useReportDialogDirty) the scrim does nothing,
 * and Esc, the close button and a [data-cancel] button show an inline bar, "Discard what you typed?", with focus on
 * Keep editing. A dialog that closes itself after a save (its own setOpen(false)) is not asked.
 */
interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** A request is in flight: Esc, scrim and close are ignored, the body is dimmed. */
  busy?: boolean
  /** Something was typed: closing asks "Discard what you typed?" first. A <Form> inside reports this on its own. */
  dirty?: boolean
  children: ReactNode
}

export function Dialog({ busy = false, dirty = false, open, defaultOpen, onOpenChange, children }: DialogProps) {
  const [inner, setInner] = useState(defaultOpen ?? false)
  const isOpen = open ?? inner
  const [forms, setForms] = useState<ReadonlySet<string>>(new Set())
  const [asking, setAsking] = useState(false)
  const guarded = dirty || forms.size > 0
  useEffect(() => {
    if (!isOpen) setAsking(false)
  }, [isOpen])

  const change = useCallback(
    (next: boolean) => {
      if (!next) setAsking(false)
      if (open === undefined) setInner(next)
      onOpenChange?.(next)
    },
    [open, onOpenChange],
  )
  const report = useCallback((id: string, d: boolean) => {
    setForms(s => {
      if (s.has(id) === d) return s
      const n = new Set(s)
      if (d) n.add(id)
      else n.delete(id)
      return n
    })
  }, [])

  const guard = useMemo<Guard>(
    () => ({
      busy,
      dirty: guarded,
      asking: asking && guarded,
      ask: () => setAsking(true),
      keep: () => setAsking(false),
      discard: () => change(false),
      report,
    }),
    [busy, guarded, asking, change, report],
  )
  // Android Back (and the browser's) closes the open dialog instead of leaving the page: the same path as Esc (asks first
  // when something was typed), and ignored while a save is in flight.
  // Phones and touch screens always: that is where a system Back button closes a sheet. On a desktop only while something
  // is typed (Back asks "Discard what you typed?" instead of leaving the page); a clean dialog leaves Back its usual meaning.
  const touch = useMediaQuery('(max-width: 767px), (pointer: coarse)')
  useBackToClose(isOpen, () => {
    if (busy) return
    if (guarded) setAsking(true)
    else change(false)
  }, { enabled: touch || guarded })

  const mod = useDialogImpl()
  useEffect(() => {
    if (isOpen) void preloadDialog()
  }, [isOpen])
  return (
    <GuardContext.Provider value={guard}>
      {mod ? (
        <mod.DialogRoot
          open={isOpen}
          onOpenChange={next => {
            if (!next && guarded) setAsking(true)
            else change(next)
          }}
        >
          {children}
        </mod.DialogRoot>
      ) : null}
    </GuardContext.Provider>
  )
}

/** A form inside a dialog says whether it holds changes (Form calls this; a hand-rolled form can too). */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with the guard it reports to
export function useReportDialogDirty(dirty: boolean) {
  const guard = useContext(GuardContext)
  const report = guard?.report
  const id = useId()
  useEffect(() => {
    if (!report) return
    report(id, dirty)
    return () => report(id, false)
  }, [report, id, dirty])
}

/** Wrap the button that opens the dialog; focus returns to it on close. */
export function DialogTrigger(props: { asChild?: boolean; children: ReactNode }) {
  const mod = useDialogImpl()
  if (mod) return <mod.DialogTriggerImpl {...props} />
  return isValidElement(props.children) ? cloneElement(props.children as ReactElement<Record<string, unknown>>, { onPointerEnter: () => void preloadDialog() }) : <>{props.children}</>
}

export function DialogContent(props: DialogContentProps) {
  const mod = useDialogImpl()
  return mod ? <mod.DialogContentImpl {...props} /> : null
}
