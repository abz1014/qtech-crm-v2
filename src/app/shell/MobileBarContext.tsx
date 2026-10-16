import { createContext, useContext, useEffect, type ReactNode } from 'react'

/*
 * Phone bar configuration (A-82). By default the phone bar shows the logo mark, the
 * destination title, search and the avatar. A detail or sub screen asks for the other
 * form (g2-login-team-settings, g2-today-b2 phone frames): a chevron-left (back) or an x
 * (close), its own title, and one slot on the right ("Add", an amount, Capture).
 *
 *   useMobileBar({ title: 'Team', back: { to: '/settings' }, action: <Button>Add</Button> })
 *
 * The bar shows this only while the calling component is mounted; on unmount the default returns.
 * Below 768 only: tablet and desktop use the top bar and ignore this.
 */
export interface MobileBarConfig {
  title?: string
  /** Chevron-left. Goes to `to`, else runs `onClick`, else history back. */
  back?: { to?: string; onClick?: () => void; label?: string }
  /** An x, for a sub screen that is a task (capture, add expense). Same rules as `back`. */
  close?: { to?: string; onClick?: () => void }
  /** Right slot: a button, an amount, a Capture button. */
  action?: ReactNode
}

export type SetBar = (config: MobileBarConfig | null) => void

export const BarValue = createContext<MobileBarConfig | null>(null)
// The setter has its own, never-changing context so a page that calls the hook is not re-rendered when the bar changes.
export const BarSetter = createContext<SetBar | null>(null)

/** What the phone bar should show, or null for the default form. Read by MobileBar. */
export function useMobileBarConfig(): MobileBarConfig | null {
  return useContext(BarValue)
}

/** Ask the phone bar for the back / close / action form while this component is mounted. Does nothing outside the shell. */
export function useMobileBar(config: MobileBarConfig): void {
  const set = useContext(BarSetter)
  useEffect(() => {
    set?.(config)
  })
  useEffect(() => () => set?.(null), [set])
}
