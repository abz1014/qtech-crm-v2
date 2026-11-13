import { Suspense, useState } from 'react'
import { Plus } from 'lucide-react'
import { newEntries } from '@/app/shell/newEntries'
import { limeButtonClass, railTextClass } from '@/app/shell/railStyle'
import { useStartEntry } from '@/app/shell/useStartEntry'
import { useUpgrade } from '@/app/shell/useUpgrade'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { lazyWithReload } from '@/lib/importWithReload'

// The rail's menu (Radix popover) is downloaded after the first paint, or when it is reached for (useUpgrade).
const loadImpl = () => import('@/app/shell/NewMenuImpl').then(m => ({ default: m.NewMenuImpl }))
const NewMenuImpl = lazyWithReload(loadImpl)

/*
 * Create (gate 2, question 1: the lime Create on the rail, the + in the phone bar). One list of things a person starts, by role, in the
 * live order and words (newEntries.ts):
 *   admin     New RFQ (N) · Expense (E) · Payment received · Order without RFQ (O)
 *   sales     New RFQ (N) · Order without RFQ (O)
 *   engineer  none: nothing is drawn (their lime button is Take photo, and their bar has Camera)
 *   rail  the lime button at the top of the forest rail opens a menu under it (a lime + alone while the rail is 72 wide); key letters for a mouse
 *   tab   the + in the middle of the phone bar opens the same rows as a sheet, 64 tall each
 * Expense opens Quick add in a dialog (the E key does too).
 */
export interface NewMenuProps {
  role: string
  variant?: 'rail' | 'tab'
  /** rail: drawn 72 wide, the word kept for screen readers only. */
  collapsed?: boolean
}

export function NewMenu({ role, variant = 'rail', collapsed = false }: NewMenuProps) {
  if (newEntries(role).length === 0) return null
  return variant === 'tab' ? <CreateTab role={role} /> : <CreateRail role={role} collapsed={collapsed} />
}

function CreateRail({ role, collapsed }: { role: string; collapsed: boolean }) {
  const up = useUpgrade(loadImpl)
  const trigger = (more: { onClick?: () => void; onPointerEnter?: () => void; onFocus?: () => void }) => (
    <button type="button" aria-haspopup="menu" title="Create" className={limeButtonClass(collapsed)} {...more}>
      <Icon icon={Plus} size="lg" />
      <span className={railTextClass(collapsed)}>Create</span>
    </button>
  )
  if (!up.on) return trigger({ onClick: up.upgradeAndOpen, onPointerEnter: up.upgrade, onFocus: up.upgrade })
  return (
    <Suspense fallback={trigger({})}>
      <NewMenuImpl role={role} collapsed={collapsed} defaultOpen={up.openFirst} />
    </Suspense>
  )
}

/** The + in the middle of the phone bar and the Create sheet it opens (the Dialog is a bottom sheet below 768). */
function CreateTab({ role }: { role: string }) {
  const [open, setOpen] = useState(false)
  const start = useStartEntry()
  const entries = newEntries(role)
  return (
    <>
      <button
        type="button"
        aria-label="Create"
        aria-haspopup="dialog"
        data-create-tab=""
        onClick={() => setOpen(true)}
        className="grid min-h-touch min-w-0 place-items-center py-1 text-brand-700"
      >
        <span className="grid size-12 place-items-center rounded-pill bg-brand-700 text-primary-foreground shadow-e2 transition-transform duration-fast active:scale-press">
          <Icon icon={Plus} size="lg" />
        </span>
      </button>
      {open ? (
        <Dialog open onOpenChange={o => !o && setOpen(false)}>
          <DialogContent title="Create" icon={Plus}>
            <ul className="grid gap-3">
              {entries.map(e => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      start(e)
                    }}
                    className="flex min-h-row w-full items-center gap-4 rounded-card border bg-surface px-4 text-left text-lg font-card transition-colors duration-fast ease-out hover:bg-brand-100 active:scale-press"
                  >
                    <Icon icon={e.icon} size="lg" className="text-brand-700" />
                    {e.label}
                  </button>
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
