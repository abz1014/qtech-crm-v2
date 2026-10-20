import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Undo2, X } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { ToastContext, type ToastApi, type ToastInput } from '@/ui/useToast'

/*
 * Toast (INVENTORY: U03; D08 section 08, g2-today-b2 "Copied"). Ink surface,
 * shadow-pop, 380px on desktop and full width minus the 16px gutters on a phone
 * (8px above the tab bar). At most three show, newest at the bottom; the oldest
 * is settled and removed first.
 *
 * Undo toast: the window is 10 s. A ring in the Undo button empties and the
 * seconds count down; a bar along the bottom shrinks. Hovering or focusing the
 * toast pauses both. When the window closes the sentence changes to what was
 * done ("Floated to 4 suppliers") and goes after 5 s; after Undo it reads
 * "Undone. ..." the same way. Undo is also Cmd/Ctrl+Z while the window is open.
 * Plain toasts go after 5 s. Errors stay until dismissed, speak as an alert and
 * can carry a retry. Reduced motion: the ring and bar stay at their starting
 * size and the number still counts.
 */
const CIRCUMFERENCE = 44 // 2 * PI * r, r = 7 in the 18px ring
const SETTLED_MS = 5000
const MAX_SHOWN = 3

type Phase = 'running' | 'settled' | 'undone'
interface Item {
  id: string
  input: ToastInput
  phase: Phase
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const seq = useRef(0)
  const itemsRef = useRef<Item[]>([])
  itemsRef.current = items

  const remove = useCallback((id: string) => setItems(list => list.filter(i => i.id !== id)), [])

  const settle = useCallback((id: string) => {
    const item = itemsRef.current.find(i => i.id === id)
    if (!item || item.phase !== 'running' || !item.input.undo) return
    item.input.undo.onSettle?.()
    setItems(list => list.map(i => (i.id === id ? { ...i, phase: 'settled' } : i)))
  }, [])

  const undo = useCallback(async (id: string) => {
    const item = itemsRef.current.find(i => i.id === id)
    if (!item || item.phase !== 'running' || !item.input.undo) return
    setItems(list => list.map(i => (i.id === id ? { ...i, phase: 'undone' } : i)))
    try {
      await item.input.undo.onUndo()
    } catch (err) {
      // The undo write failed: the toast must not keep saying "Undone.". It turns into an error that stays until dismissed.
      const input: ToastInput = { title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' }
      setItems(list => list.map(i => (i.id === id ? { ...i, input, phase: 'running' } : i)))
    }
  }, [])

  const dismiss = useCallback(
    (id: string) => {
      settle(id)
      remove(id)
    },
    [settle, remove],
  )

  const toast = useCallback(
    (input: ToastInput) => {
      const id = `t${++seq.current}`
      setItems(list => {
        const next = [...list, { id, input, phase: 'running' as Phase }]
        const overflow = next.length - MAX_SHOWN
        if (overflow > 0) {
          // older ones go first; an open Undo is committed, not lost
          next.slice(0, overflow).forEach(i => i.phase === 'running' && i.input.undo?.onSettle?.())
          return next.slice(overflow)
        }
        return next
      })
      return id
    },
    [],
  )

  // Cmd/Ctrl+Z undoes the newest open Undo, unless the person is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z')) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return
      const open = [...itemsRef.current].reverse().find(i => i.phase === 'running' && i.input.undo)
      if (open) {
        e.preventDefault()
        void undo(open.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss])
  const card = (item: Item) => (
    <ToastCard key={item.id} item={item} onUndo={() => void undo(item.id)} onSettle={() => settle(item.id)} onDismiss={() => dismiss(item.id)} onGone={() => remove(item.id)} />
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[380px] max-w-full flex-col gap-2 max-md:inset-x-4 max-md:bottom-[76px] max-md:w-auto"
      >
        {/* WCAG 4.1.3: errors speak for themselves as role="alert". Every other toast goes into one persistent polite
            live region, so it is announced on arrival (a status inserted with its content is often missed) and again
            when its sentence changes (settled, undone). The countdown digits are hidden from it. */}
        {items.filter(i => i.input.tone === 'danger').map(card)}
        <div aria-live="polite" aria-relevant="additions text" className="flex flex-col gap-2" data-toast-live>
          {items.filter(i => i.input.tone !== 'danger').map(card)}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

function reducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function ToastCard({
  item,
  onUndo,
  onSettle,
  onDismiss,
  onGone,
}: {
  item: Item
  onUndo: () => void
  onSettle: () => void
  onDismiss: () => void
  onGone: () => void
}) {
  const { input, phase } = item
  const tone = input.tone ?? 'neutral'
  const total = (input.undo?.seconds ?? 10) * 1000
  const [left, setLeft] = useState(total)
  const [paused, setPaused] = useState(false)
  const still = reducedMotion()

  // One clock per toast: counts the Undo window down while running, then the short "settled" or plain life.
  const lifeMs =
    phase === 'running' ? (input.undo ? total : input.duration ?? (tone === 'danger' ? 0 : 5000)) : SETTLED_MS
  const remaining = useRef(lifeMs)
  const cb = useRef({ onSettle, onGone })
  cb.current = { onSettle, onGone }
  useEffect(() => {
    remaining.current = lifeMs
    setLeft(lifeMs)
  }, [phase, lifeMs])

  useEffect(() => {
    if (lifeMs === 0 || paused) return
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      remaining.current -= now - last
      last = now
      if (remaining.current <= 0) {
        window.clearInterval(id)
        if (phase === 'running' && input.undo) cb.current.onSettle()
        else cb.current.onGone()
      } else {
        setLeft(remaining.current)
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [paused, phase, lifeMs, input.undo])

  const undoable = phase === 'running' && Boolean(input.undo)
  const u = input.undo
  const title = phase === 'settled' ? u?.settledTitle ?? input.title : phase === 'undone' ? u?.undoneTitle ?? 'Undone.' : input.title
  const body = phase === 'settled' ? u?.settledBody ?? input.body : phase === 'undone' ? u?.undoneBody : input.body
  const secs = Math.max(0, Math.ceil(left / 1000))
  const fraction = Math.max(0, Math.min(1, left / total))

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      // Not its own live region: the provider's persistent polite region speaks it.
      aria-live={tone === 'danger' ? undefined : 'off'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto relative flex animate-rise-6 items-center gap-3 overflow-hidden rounded py-[10px] pl-[14px] pr-[10px] text-sm shadow-pop',
        tone === 'danger' ? 'bg-tone-danger-fg text-tone-ink-fg' : 'bg-tone-ink-bg text-tone-ink-fg',
      )}
    >
      <Icon icon={tone === 'danger' ? CircleAlert : phase === 'undone' ? Undo2 : CircleCheck} className={cn('shrink-0', tone === 'success' && 'text-tone-success-bg')} />
      <div className="grid min-w-0 flex-1 text-pretty">
        <span className="font-medium">{title}</span>
        {body ? <span className={cn('text-xs', tone === 'danger' ? 'opacity-90' : 'opacity-80')}>{body}</span> : null}
        {undoable ? <span className="sr-only">{` Undo is available for ${u?.seconds ?? 10} seconds, or press Control+Z.`}</span> : null}
      </div>
      {undoable ? (
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex h-control-sm items-center gap-[6px] rounded border border-tone-ink-fg/30 pl-3 pr-2 text-xs font-medium transition-colors duration-fast ease-out hover:bg-tone-ink-fg/10 focus-visible:outline-tone-ink-fg max-md:h-touch"
        >
          <svg viewBox="0 0 18 18" aria-hidden="true" className="size-[18px] -rotate-90">
            <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2" className="stroke-tone-ink-fg opacity-30" />
            <circle
              cx="9"
              cy="9"
              r="7"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              className="stroke-tone-ink-fg"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={still ? 0 : CIRCUMFERENCE * (1 - fraction)}
            />
          </svg>
          Undo
          <span aria-hidden="true" className="num min-w-[3ch] text-right opacity-80">{secs}s</span>
        </button>
      ) : input.action && phase === 'running' ? (
        <button
          type="button"
          onClick={() => {
            input.action?.onClick()
            onDismiss()
          }}
          className="inline-flex h-control-sm items-center rounded border border-tone-ink-fg/30 px-3 text-xs font-medium transition-colors duration-fast ease-out hover:bg-tone-ink-fg/10 focus-visible:outline-tone-ink-fg max-md:h-touch"
        >
          {input.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="grid size-control-sm shrink-0 place-items-center rounded opacity-70 transition-opacity duration-fast ease-out hover:bg-tone-ink-fg/10 hover:opacity-100 focus-visible:outline-tone-ink-fg max-md:size-touch"
      >
        <Icon icon={X} />
      </button>
      {undoable ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-tone-ink-fg opacity-60"
          style={{ transform: `scaleX(${still ? 1 : fraction})` }}
        />
      ) : null}
    </div>
  )
}
