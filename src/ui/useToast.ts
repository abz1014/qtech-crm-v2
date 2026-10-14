import { createContext, useContext, type ReactNode } from 'react'

export type ToastTone = 'neutral' | 'success' | 'danger'

export interface ToastUndo {
  /** Runs when Undo is pressed inside the window. */
  onUndo: () => void | Promise<void>
  /** Runs when the window closes without an Undo (countdown over, or the toast dismissed). Commit work here if it was held back. */
  onSettle?: () => void
  /** Seconds the Undo stays open. Default 10. */
  seconds?: number
  /** After the countdown: what was done, in the last-thing-read form ("Floated to 4 suppliers"). */
  settledTitle?: ReactNode
  settledBody?: ReactNode
  /** After Undo: default "Undone." */
  undoneTitle?: ReactNode
  undoneBody?: ReactNode
}

export interface ToastInput {
  /** Repeats the button's verb: "Mark as floated" gives "Marked floated". */
  title: ReactNode
  /** Context line: "4 suppliers · RFQ-0177". */
  body?: ReactNode
  tone?: ToastTone
  undo?: ToastUndo
  /** A retry or another way forward ("Try again"). Errors use it. */
  action?: { label: string; onClick: () => void }
  /** Milliseconds before it goes. Default 5000; errors stay until dismissed (0). Undo toasts follow their countdown. */
  duration?: number
}

export interface ToastApi {
  toast: (t: ToastInput) => string
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast needs a <ToastProvider> (it is part of the app shell)')
  return api
}
