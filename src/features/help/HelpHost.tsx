import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { usePaletteSource } from '@/app/palette/usePalette'
import { useSession } from '@/app/session'
import { whenContentDrawn } from '@/lib/afterContent'
import { useMediaQuery } from '@/lib/useMediaQuery'
import type { helpPaletteSource } from '@/features/help/helpPalette'
import { howItWorksFor, howItWorksKey } from '@/features/help/howItWorks'
import type { Recipe } from '@/features/help/recipes'
import { useDismissed } from '@/features/help/useDismissed'
import { HELP_PARAM, useHelp, withHelp } from '@/features/help/useHelp'

/** The panel and the recipes are lazy chunks: nothing of Help is in the initial JavaScript. */
const HelpPanel = lazy(() => import('@/features/help/HelpPanel').then(m => ({ default: m.HelpPanel })))

/*
 * Mount once inside the shell (AppShell's Frame, which sits inside PaletteHost): <HelpHost />.
 * - Shows the Help panel whenever the address has ?help= (useHelp opens and closes it).
 * - Registers the palette's "How do I…" group (PaletteHost is not edited).
 * - Keeps Help open when the person follows a step by tapping a link in the app (a new page has no ?help=, so the
 *   parameter is carried over); Back and Close still close it.
 *
 * Adoption, once the ux branches are merged (one line each, plus its import):
 *   AppShell.tsx, Frame, after <BottomTabs />:  <HelpHost />
 *   AccountMenu.tsx, above Settings:            <MenuItem icon={CircleHelp} onClick={() => openHelp()}>Help</MenuItem>
 *                                               (with const { openHelp } = useHelp() at the top of AccountMenu)
 *   TodayScreen.tsx, TodayBody header:          <HowItWorksCard userId={user.id} role={user.role} className="mt-2" />
 *   Empty branches (Today, RFQ board "Mine", Orders "Mine"): <FirstUseState screen="today" | "rfqs" | "orders" ... />
 *   in front of the existing EmptyState, once a "has this person started" query exists (learnability spec 1.1).
 */
export function HelpHost() {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const { open, recipeId, openHelp, closeHelp } = useHelp()
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const wide = useMediaQuery('(min-width: 1024px)')
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  // The palette group's code comes with the recipes (it searches them), so neither is in the first load (perf/trim).
  const [toSource, setToSource] = useState<{ make: typeof helpPaletteSource } | null>(null)

  // Downloaded once the opening page's content is drawn (perf/lcp, afterContent.ts), or at once when Help is asked for.
  const [drawn, setDrawn] = useState(false)
  useEffect(() => whenContentDrawn(() => setDrawn(true)), [])
  const wanted = drawn || open
  useEffect(() => {
    if (!wanted) return
    let live = true
    void Promise.all([import('@/features/help/recipes'), import('@/features/help/helpPalette')]).then(([m, p]) => {
      if (!live) return
      setRecipes(m.allRecipes())
      setToSource({ make: p.helpPaletteSource })
    })
    return () => {
      live = false
    }
  }, [wanted])

  // Help follows the person to the page a link took them to; Back (POP) and Close (POP or REPLACE) are left alone.
  const lastOpen = useRef<string | null>(null)
  useEffect(() => {
    const value = new URLSearchParams(location.search).get(HELP_PARAM)
    if (value !== null) {
      lastOpen.current = value
      return
    }
    const carry = lastOpen.current
    lastOpen.current = null
    if (carry !== null && navigationType === 'PUSH') {
      navigate({ pathname: location.pathname, search: withHelp(location.search, carry), hash: location.hash }, { replace: true, state: location.state })
    }
  }, [location, navigationType, navigate])

  const role = user?.role ?? ''
  const source = useMemo(
    () => (recipes && toSource && role ? toSource.make(recipes, role, location.pathname, openHelp) : null),
    [recipes, toSource, role, location.pathname, openHelp],
  )
  usePaletteSource(source)

  const [dismissed, setDismissed] = useDismissed(user ? howItWorksKey(user.id) : null)
  // For the one render between a link's navigation and the carry-over above, keep the panel mounted (no flash).
  const carrying = !open && navigationType === 'PUSH' ? lastOpen.current : null
  if ((!open && carrying === null) || !user || !recipes) return null
  return (
    <Suspense fallback={null}>
      <HelpPanel
        recipes={recipes}
        role={user.role}
        pathname={location.pathname}
        recipeId={open ? recipeId : carrying || null}
        onShow={id => openHelp(id)}
        onClose={closeHelp}
        wide={wide}
        onShowHowItWorks={dismissed && howItWorksFor(user.role).length ? () => setDismissed(false) : undefined}
      />
    </Suspense>
  )
}
