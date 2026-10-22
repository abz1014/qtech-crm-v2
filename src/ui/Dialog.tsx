import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { useBackToClose } from '@/lib/useBackToClose'
import { returnTarget } from '@/ui/menuTrigger'
import { useMediaQuery } from '@/lib/useMediaQuery'

/*
 * Dialog (INVENTORY: U03; D08 section 05). The one modal wrapper, on Radix:
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
interface Guard {
  busy: boolean
  dirty: boolean
  asking: boolean
  ask: () => void
  keep: () => void
  discard: () => void
  report: (id: string, dirty: boolean) => void
}
const GuardContext = createContext<Guard | null>(null)

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

  return (
    <GuardContext.Provider value={guard}>
      <RadixDialog.Root
        open={isOpen}
        onOpenChange={next => {
          if (!next && guarded) setAsking(true)
          else change(next)
        }}
      >
        {children}
      </RadixDialog.Root>
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

function DiscardBar({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => keepRef.current?.focus(), [])
  return (
    <div
      role="group"
      aria-label="Discard what you typed?"
      data-discard-bar
      className="flex flex-wrap items-center justify-end gap-2 border-t bg-tone-warning-bg px-5 py-3 text-sm text-tone-warning-fg max-md:[&>button]:h-touch"
    >
      <span className="mr-auto font-medium">Discard what you typed?</span>
      <Button ref={keepRef} onClick={onKeep}>
        Keep editing
      </Button>
      <Button variant="danger" onClick={onDiscard}>
        Discard
      </Button>
    </div>
  )
}

/** Wrap the button that opens the dialog; focus returns to it on close. */
export const DialogTrigger = RadixDialog.Trigger

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
const TILE: Record<Tone, string> = {
  neutral: 'bg-selected text-fg-2',
  info: 'bg-tone-info-bg text-tone-info-fg',
  success: 'bg-tone-success-bg text-tone-success-fg',
  warning: 'bg-tone-warning-bg text-tone-warning-fg',
  danger: 'bg-tone-danger-bg text-tone-danger-fg',
}
// Wider than the 400 / 480 / 640 of the mockups since the text grew (DECISIONS 2026-10-19), so lines keep their length.
const WIDTH = { sm: 'md:w-[440px]', md: 'md:w-[520px]', lg: 'md:w-[720px]' } as const

interface DialogContentProps {
  title: string
  /** The context line under the title ("RFQ-0177 · Indus Textile Mills"). Also the dialog's accessible description. */
  context?: ReactNode
  /** A small chip beside the title ("Re-issue"). It sits next to the heading, not inside it. */
  titleChip?: ReactNode
  /** The 36px tile glyph. A destructive confirm uses tone="danger". */
  icon?: LucideIcon
  tone?: Tone
  /** sm 400 (confirm), md 480 (default), lg 640. */
  size?: keyof typeof WIDTH
  /** Buttons for the footer band, Cancel first and the primary last (right-aligned). */
  footer?: ReactNode
  /** A mono tag at the right of the header, beside the close button (the PO number in the Issue purchase order dialog). */
  meta?: ReactNode
  /** Small text at the left of the footer ("Body scrolls. Header and footer stay."). */
  lead?: ReactNode
  /** The body. Scrolls on its own; header and footer stay put. */
  children?: ReactNode
  className?: string
}

export function DialogContent({
  title,
  titleChip,
  context,
  icon,
  tone = 'neutral',
  size = 'md',
  footer,
  lead,
  meta,
  children,
  className,
}: DialogContentProps) {
  const guard = useContext(GuardContext)
  const busy = guard?.busy ?? false
  const dirty = guard?.dirty ?? false
  const contentRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const hold = (e: Event) => {
    if (busy || dirty) e.preventDefault()
  }
  const holdEscape = (e: KeyboardEvent) => {
    if (busy) e.preventDefault()
    else if (dirty) {
      e.preventDefault()
      guard?.ask()
    }
  }
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 grid animate-fade-in place-items-center bg-scrim p-4 max-md:place-items-end max-md:p-0">
        <RadixDialog.Content
          ref={contentRef}
          {...(context ? {} : { 'aria-describedby': undefined })}
          onEscapeKeyDown={holdEscape}
          onPointerDownOutside={hold}
          onInteractOutside={hold}
          onOpenAutoFocus={e => {
            e.preventDefault()
            openerRef.current = returnTarget(document.activeElement)
            const root = contentRef.current
            if (!root) return
            const target =
              root.querySelector<HTMLElement>('[data-autofocus]') ??
              root.querySelector<HTMLElement>('[data-dialog-body] :is(input,select,textarea):not([disabled],[type=hidden])') ??
              root.querySelector<HTMLElement>('[data-cancel]') ??
              root
            target.focus()
          }}
          // Radix only restores focus to a <DialogTrigger>. A dialog opened from code has none, so
          // return to whatever had focus when it opened.
          onCloseAutoFocus={e => {
            if (!openerRef.current?.isConnected) return
            e.preventDefault()
            openerRef.current.focus()
          }}
          className={cn(
            'relative grid max-h-[calc(100dvh-64px)] w-full max-w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded bg-surface shadow-modal',
            // A short window (a laptop at 400% zoom): the whole sheet scrolls, so the title and Close are never pushed off the top.
            '[@media(max-height:480px)]:grid-rows-[auto_auto_auto] [@media(max-height:480px)]:overflow-y-auto',
            'animate-rise-6 focus:outline-none max-md:max-h-[calc(100dvh-16px)] max-md:animate-sheet-in max-md:rounded-b-none',
            WIDTH[size],
            className,
          )}
        >
          {/* Bottom sheet below 768: the 36 by 4 grab handle (g2-components "Bottom sheet on a phone"). */}
          <span aria-hidden="true" data-grab className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-round bg-line-strong md:hidden" />
          <header className="flex items-start gap-3 px-5 pt-5 max-md:pt-6 [@media(max-height:480px)]:sticky [@media(max-height:480px)]:top-0 [@media(max-height:480px)]:z-10 [@media(max-height:480px)]:bg-surface [@media(max-height:480px)]:pb-2">
            {icon ? (
              <span aria-hidden="true" className={cn('grid size-[36px] shrink-0 place-items-center rounded', TILE[tone])}>
                <Icon icon={icon} size="lg" />
              </span>
            ) : null}
            <div className="grid min-w-0 flex-1 gap-[2px]">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <RadixDialog.Title className="text-lg font-semibold tracking-snug">{title}</RadixDialog.Title>
                {titleChip}
              </div>
              {context ? (
                <RadixDialog.Description className="text-base text-fg-2">{context}</RadixDialog.Description>
              ) : null}
            </div>
            {meta ? <div className="mr-2 shrink-0 self-start">{meta}</div> : null}
            <RadixDialog.Close asChild>
              <Button variant="quiet" size="sm" icon={X} aria-label="Close" disabled={busy} className="-mr-2 -mt-1 text-fg-muted" />
            </RadixDialog.Close>
          </header>
          <div
            data-dialog-body
            className={cn(
              // Reading text is 16 px (text-base, owner decision 2026-10-19); controls inside set their own size.
              'grid min-h-0 content-start gap-4 overflow-y-auto px-5 pb-5 pt-4 text-base text-fg-2 transition-opacity duration-fast [&>p]:max-w-[62ch]',
              busy && 'opacity-80',
            )}
          >
            {children}
          </div>
          {guard?.asking ? (
            <DiscardBar onKeep={guard.keep} onDiscard={guard.discard} />
          ) : footer ? (
            <footer
              onClickCapture={e => {
                // A Cancel button (data-cancel) closes through the caller's own state, so it is caught here.
                if (!dirty || busy || !(e.target instanceof Element) || !e.target.closest('[data-cancel]')) return
                e.preventDefault()
                e.stopPropagation()
                guard?.ask()
              }}
              className={cn(
                'flex items-center justify-end gap-2 border-t bg-sunken px-5 py-3 pb-[max(var(--sp-3),env(safe-area-inset-bottom,0px))]',
                'max-md:flex-col-reverse max-md:items-stretch max-md:[&>button]:h-touch',
              )}
            >
              {lead ? <span className="mr-auto inline-flex items-center gap-2 text-xs text-fg-muted max-md:mr-0">{lead}</span> : null}
              {footer}
            </footer>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Overlay>
    </RadixDialog.Portal>
  )
}
