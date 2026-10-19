import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react'

/*
 * Phone bar configuration (A-82; UX audit 2026-10-19 "phone detail pages use one header bar with back"). By default the
 * phone bar shows the logo mark, the destination title, search, Capture and the avatar. A detail or sub screen asks for
 * ONE bar instead (g2-login-team-settings, g2-today-b2 phone frames): a chevron-left (back) or an x (close), its own
 * title, and one slot on the right (a small "more" menu, "Add", an amount).
 *
 *   useMobileBar({ title: 'RFQ-0177', back: 'history', fallback: '/rfqs', actions: <MoreMenu />, hideTabs: true })
 *   useMobileBar({ title: 'Team', back: { to: '/settings' }, action: <Button>Add</Button> })   // the original shape
 *
 * The bar shows this only while the calling component is mounted; on unmount the default returns.
 * Below 768 only: tablet and desktop use the top bar and ignore this.
 */
export interface MobileBarConfig {
  title?: string
  /**
   * Chevron-left. A route ('/rfqs'), or 'history': the screen the person came from (navigate(-1)), or `fallback` when
   * there is none in the app (opened from a link, a notification or a refresh).
   * Object form (A-82): goes to `to`, else runs `onClick`, else behaves as 'history'. `label` names the button (default "Back").
   */
  back?: 'history' | (string & {}) | { to?: string; onClick?: () => void; label?: string }
  /** Where 'history' goes when there is no previous screen in the app. Default '/'. */
  fallback?: string
  /** An x, for a sub screen that is a task (capture, add expense). Same rules as the object form of `back`. */
  close?: { to?: string; onClick?: () => void }
  /** Right slot: a small "more" menu (Popover variant="menu" behind a 44px icon button), a button, an amount. */
  actions?: ReactNode
  /** The original name of `actions` (TeamPage). `actions` wins when both are given. */
  action?: ReactNode
  /** Hide the bottom tab bar while this screen is open: for a page with its own sticky action bar at the bottom. */
  hideTabs?: boolean
}

export type SetBar = (config: MobileBarConfig | null) => void

export const BarValue = createContext<MobileBarConfig | null>(null)
// The setter has its own, never-changing context so a page that calls the hook is not re-rendered when the bar changes.
export const BarSetter = createContext<SetBar | null>(null)

/** What the phone bar should show, or null for the default form. Read by MobileBar and BottomTabs. */
export function useMobileBarConfig(): MobileBarConfig | null {
  return useContext(BarValue)
}

/**
 * Ask the phone bar for the one-bar form (back or close, title, actions) while this component is mounted. Does nothing
 * outside the shell. Layout effects, so the default bar never flashes before the page's own bar on a phone.
 */
export function useMobileBar(config: MobileBarConfig): void {
  const set = useContext(BarSetter)
  useLayoutEffect(() => {
    set?.(config)
  })
  // A layout cleanup runs before the next page's layout effect, so leaving one detail page for another keeps the new bar.
  useLayoutEffect(() => () => set?.(null), [set])
}
