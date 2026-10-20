import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/*
 * Help lives in the address: ?help=<recipe id> opens the panel on that recipe, ?help= (empty) on the list. So the browser
 * and phone back button close it, and a recipe can be linked from anywhere (an empty state, an error toast, the How this
 * works card) with nothing to register. No context: the URL is the state.
 *
 * openHelp pushes one history entry when Help is closed (marked in history state), and swaps the entry when it is already
 * open, so Back always closes Help rather than stepping through recipes. closeHelp goes back over that entry, or removes
 * the parameter when Help was opened by a link (a fresh page load on ?help=...).
 */
export const HELP_PARAM = 'help'
const PUSHED = 'qtechHelpPushed'

export interface HelpApi {
  /** Help is open. */
  open: boolean
  /** The recipe shown, or null for the list. */
  recipeId: string | null
  /** Open Help on a recipe, or on the list with no id. */
  openHelp: (id?: string | null) => void
  closeHelp: () => void
}

/** The search string with Help set to a recipe (or '' for the list), or removed with null. Other parameters are kept. */
export function withHelp(search: string, id: string | null): string {
  const params = new URLSearchParams(search)
  if (id === null) params.delete(HELP_PARAM)
  else params.set(HELP_PARAM, id)
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** The route to a page with a recipe open: for a link that should open Help on arrival (an empty state, an error toast). */
export function helpHref(pathname: string, id: string): string {
  return `${pathname}${withHelp('', id)}`
}

const asObject = (state: unknown): Record<string, unknown> => (state && typeof state === 'object' ? (state as Record<string, unknown>) : {})

export function useHelp(): HelpApi {
  const location = useLocation()
  const navigate = useNavigate()
  const value = useMemo(() => new URLSearchParams(location.search).get(HELP_PARAM), [location.search])
  const pushed = asObject(location.state)[PUSHED] === true

  const openHelp = useCallback(
    (id?: string | null) => {
      const to = { pathname: location.pathname, search: withHelp(location.search, id ?? ''), hash: location.hash }
      if (value !== null) navigate(to, { replace: true, state: location.state })
      else navigate(to, { state: { ...asObject(location.state), [PUSHED]: true } })
    },
    [location, navigate, value],
  )

  const closeHelp = useCallback(() => {
    if (value === null) return
    if (pushed) navigate(-1)
    else {
      const rest = { ...asObject(location.state) }
      delete rest[PUSHED]
      navigate({ pathname: location.pathname, search: withHelp(location.search, null), hash: location.hash }, { replace: true, state: rest })
    }
  }, [location, navigate, pushed, value])

  return { open: value !== null, recipeId: value || null, openHelp, closeHelp }
}
