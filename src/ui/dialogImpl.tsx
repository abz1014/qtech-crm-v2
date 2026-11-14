import { useContext, useEffect, useRef, type ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { returnTarget } from '@/ui/menuTrigger'
import { GuardContext } from '@/ui/dialogStore'

/* The Radix half of Dialog (src/ui/Dialog.tsx says why it is a module of its own): the previous implementation, unchanged. */
export const DialogRoot = RadixDialog.Root
export const DialogTriggerImpl = RadixDialog.Trigger

function DiscardBar({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => keepRef.current?.focus(), [])
  return (
    <div
      role="group"
      aria-label="Discard unsaved changes?"
      data-discard-bar
      className="flex flex-wrap items-center justify-end gap-2 border-t bg-tone-warning-bg px-card py-3 text-sm text-tone-warning-fg max-md:[&>button]:h-touch"
    >
      <span className="mr-auto font-card">Discard unsaved changes?</span>
      <Button ref={keepRef} onClick={onKeep}>
        Keep editing
      </Button>
      <Button variant="danger" onClick={onDiscard}>
        Discard
      </Button>
    </div>
  )
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
const TILE: Record<Tone, string> = {
  neutral: 'bg-selected text-fg-2',
  info: 'bg-tone-info-bg text-tone-info-fg',
  success: 'bg-tone-success-bg text-tone-success-fg',
  warning: 'bg-tone-warning-bg text-tone-warning-fg',
  danger: 'bg-tone-danger-bg text-tone-danger-fg',
}
// Forest .qb-dialog: 560 (--dialog-w) and the wide 760 (--dialog-w-wide); the confirm stays 440 so its two lines keep their length.
// Every width is a cap: the dialog is never wider than the window less its 16 px margins (R-006).
const WIDTH = { sm: 'md:w-[440px]', md: 'md:max-w-dialog', lg: 'md:max-w-dialog-wide' } as const

export interface DialogContentProps {
  title: string
  /** The context line under the title ("RFQ-0177 · Indus Textile Mills"). Also the dialog's accessible description. */
  context?: ReactNode
  /** A small chip beside the title ("Re-issue"). It sits next to the heading, not inside it. */
  titleChip?: ReactNode
  /** The 36px tile glyph. A destructive confirm uses tone="danger". */
  icon?: LucideIcon
  tone?: Tone
  /** sm 440 (confirm), md 560 (default), lg 760. */
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

export function DialogContentImpl({
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
      <RadixDialog.Overlay className="fixed inset-0 z-dialog grid animate-fade-in place-items-center bg-scrim p-4 max-md:place-items-end max-md:p-0">
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
            // preventScroll: focusing a field far down a long form (Mark won) must not scroll the body under the header on open.
            target.focus({ preventScroll: true })
          }}
          // Radix only restores focus to a <DialogTrigger>. A dialog opened from code has none, so
          // return to whatever had focus when it opened.
          onCloseAutoFocus={e => {
            if (!openerRef.current?.isConnected) return
            e.preventDefault()
            openerRef.current.focus()
          }}
          className={cn(
            'relative grid max-h-[calc(100dvh-64px)] w-full max-w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-card bg-surface shadow-e3',
            // A short window (a laptop at 400% zoom): the whole sheet scrolls, so the title and Close are never pushed off the top.
            '[@media(max-height:480px)]:grid-rows-[auto_auto_auto] [@media(max-height:480px)]:overflow-y-auto',
            'animate-rise-6 focus:outline-none max-md:max-h-[calc(100dvh-16px)] max-md:animate-sheet-in max-md:rounded-b-none max-md:rounded-t-sheet',
            WIDTH[size],
            className,
          )}
        >
          {/* Bottom sheet below 768: the 40 by 4 grab handle (Forest .qb-sheet__grab). */}
          <span aria-hidden="true" data-grab className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-pill bg-line-input md:hidden" />
          <header className="flex items-start gap-3 px-card pb-1 pt-5 max-md:border-b max-md:pb-3 max-md:pt-6 [@media(max-height:480px)]:sticky [@media(max-height:480px)]:top-0 [@media(max-height:480px)]:z-sticky [@media(max-height:480px)]:bg-surface [@media(max-height:480px)]:pb-2">
            {icon ? (
              <span aria-hidden="true" className={cn('grid size-[36px] shrink-0 place-items-center rounded-control', TILE[tone])}>
                <Icon icon={icon} size="lg" />
              </span>
            ) : null}
            <div className="grid min-w-0 flex-1 gap-[2px]">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <RadixDialog.Title className="min-w-0 text-xl font-bold tracking-snug [overflow-wrap:anywhere] max-[359px]:text-lg">{title}</RadixDialog.Title>
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
              'grid min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto overscroll-contain px-card pb-5 pt-4 text-base text-fg-2 transition-opacity duration-fast [&>p]:max-w-[62ch]',
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
                'flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t bg-surface px-card py-4 pb-[max(var(--sp-4),env(safe-area-inset-bottom,0px))]',
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
