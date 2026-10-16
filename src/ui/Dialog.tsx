import { createContext, useContext, useRef, type ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

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

const BusyContext = createContext(false)

interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** A request is in flight: Esc, scrim and close are ignored, the body is dimmed. */
  busy?: boolean
  children: ReactNode
}

export function Dialog({ busy = false, children, ...rest }: DialogProps) {
  return (
    <BusyContext.Provider value={busy}>
      <RadixDialog.Root {...rest}>{children}</RadixDialog.Root>
    </BusyContext.Provider>
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
const WIDTH = { sm: 'md:w-[400px]', md: 'md:w-[480px]', lg: 'md:w-[640px]' } as const

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
  const busy = useContext(BusyContext)
  const contentRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const hold = (e: Event) => {
    if (busy) e.preventDefault()
  }
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 grid animate-fade-in place-items-center bg-scrim p-4 max-md:place-items-end max-md:p-0">
        <RadixDialog.Content
          ref={contentRef}
          {...(context ? {} : { 'aria-describedby': undefined })}
          onEscapeKeyDown={hold}
          onPointerDownOutside={hold}
          onInteractOutside={hold}
          onOpenAutoFocus={e => {
            e.preventDefault()
            openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
          onCloseAutoFocus={() => openerRef.current?.isConnected && openerRef.current.focus()}
          className={cn(
            'relative grid max-h-[calc(100dvh-64px)] w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded bg-surface shadow-modal',
            'animate-rise-6 focus:outline-none max-md:max-h-[calc(100dvh-16px)] max-md:animate-sheet-in max-md:rounded-b-none',
            WIDTH[size],
            className,
          )}
        >
          {/* Bottom sheet below 768: the 36 by 4 grab handle (g2-components "Bottom sheet on a phone"). */}
          <span aria-hidden="true" data-grab className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-round bg-line-strong md:hidden" />
          <header className="flex items-start gap-3 px-5 pt-5 max-md:pt-6">
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
                <RadixDialog.Description className="text-sm text-fg-muted">{context}</RadixDialog.Description>
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
              'grid min-h-0 content-start gap-4 overflow-y-auto px-5 pb-5 pt-4 text-sm text-fg-2 transition-opacity duration-fast [&>p]:max-w-[62ch]',
              busy && 'opacity-80',
            )}
          >
            {children}
          </div>
          {footer ? (
            <footer
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
