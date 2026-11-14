import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, CircleHelp, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
import { Icon } from '@/ui/Icon'
import { returnTarget } from '@/ui/menuTrigger'
import { InlineMarkdown, MarkdownBlocks } from '@/features/help/RecipeText'
import { STEP_TEXT_BESIDE_BUTTON, StepNumber } from '@/features/help/StepNumber'
import { howItWorksFor } from '@/features/help/howItWorks'
import { findRecipe, groupByArea, recipesForPath, recipesForRole, searchRecipes, type Recipe } from '@/features/help/recipes'

/*
 * The Help panel (learnability spec 2.2). Wide screens (1024 and up): a NON-modal panel on the right, 400px, under the top
 * bar. No focus trap and no scrim, so the page stays usable and the person can follow the steps while doing them.
 * Phones and tablets: a full-height sheet with a back arrow (modal, so focus stays in it). Esc closes either.
 *
 * Top to bottom: search, "For this screen" (recipes whose screens: match the path), the person's own recipes by area
 * (Home, Sell and Deliver, RFQs, Companies, Money...; "Show other roles" adds the rest for sales; admin sees all; an engineer never
 * gets the box, live bug 33), and a recipe view. Steps show on-screen labels as chips. Nothing is fetched: the recipes are bundled
 * markdown (recipes.ts).
 *
 * Forest (82-help.html .qb-help): one rhythm inside the panel. Header, search and body share the 16 px gutter; sections sit 20 px
 * apart with a bold secondary title; every row is a full-width target with a brand tint on hover; the How this works numbers are
 * brand-tinted discs. Gate 2 (question 21) keeps the live overlay: the panel sits over the page, it does not narrow it.
 */
export interface HelpPanelProps {
  recipes: readonly Recipe[]
  role: string
  pathname: string
  /** The recipe to show, or null for the list. */
  recipeId: string | null
  /** Show a recipe, or the list with null. Help stays open. */
  onShow: (id: string | null) => void
  onClose: () => void
  /** 1024px and up: the side panel. Otherwise the full-height sheet. */
  wide: boolean
}

const FOR_SCREEN = 3

export function HelpPanel({ recipes, role, pathname, recipeId, onShow, onClose, wide }: HelpPanelProps) {
  const [query, setQuery] = useState('')
  const [everyone, setEveryone] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const recipeHeadingRef = useRef<HTMLHeadingElement>(null)
  // An engineer opens only engineer help, even through a ?help= link or a related link (live bug 33, owner decision D).
  const allowed = useMemo(() => recipesForRole(recipes, role), [recipes, role])
  const recipe = findRecipe(recipeId, allowed)
  const view: 'results' | 'recipe' | 'home' = query.trim() ? 'results' : recipe ? 'recipe' : 'home'

  const mine = useMemo(() => recipesForRole(recipes, role, everyone && role !== 'engineer'), [recipes, role, everyone])
  const here = useMemo(() => recipesForPath(recipes, pathname, role).slice(0, FOR_SCREEN), [recipes, pathname, role])
  const results = useMemo(() => (query.trim() ? searchRecipes(mine, query) : []), [mine, query])

  // Moving between the list and a recipe moves focus with it, so a keyboard or screen-reader user lands on what changed.
  const lastView = useRef(view)
  useEffect(() => {
    if (lastView.current === view) return
    if (view === 'recipe') recipeHeadingRef.current?.focus()
    else if (lastView.current === 'recipe') searchRef.current?.focus()
    lastView.current = view
  }, [view, recipeId])

  const show = (id: string | null) => {
    setQuery('')
    onShow(id)
  }
  const back = view === 'recipe' ? () => show(null) : onClose

  return (
    <RadixDialog.Root open modal={!wide} onOpenChange={open => (open ? undefined : onClose())}>
      <RadixDialog.Portal>
        <RadixDialog.Content
          aria-describedby={undefined}
          data-help-panel={wide ? 'side' : 'sheet'}
          // Says which it is, so the page's single-key shortcuts keep working beside the side panel (blockingOverlayOpen).
          aria-modal={!wide}
          // The side panel leaves the page usable: a click on the page does not close it.
          onInteractOutside={e => (wide ? e.preventDefault() : undefined)}
          onOpenAutoFocus={e => {
            e.preventDefault()
            openerRef.current = returnTarget(document.activeElement)
            if (recipe) recipeHeadingRef.current?.focus()
            else searchRef.current?.focus()
          }}
          // Opened from code (Account menu > Help, the ? button, a link): no <Dialog.Trigger>, so Radix would leave focus on
          // <body>. Go back to what opened it, or to the menu button when it came from a menu item (hunt HE-14).
          onCloseAutoFocus={e => {
            if (!openerRef.current?.isConnected) return
            e.preventDefault()
            openerRef.current.focus()
          }}
          className={cn(
            'fixed z-sheet flex flex-col bg-surface focus:outline-none',
            wide
              ? 'bottom-0 right-0 top-[var(--topbar-h)] w-[400px] animate-fade-in border-l shadow-e3'
              : 'inset-0 animate-sheet-in pb-[env(safe-area-inset-bottom,0px)]',
          )}
        >
          <header className={cn('flex min-w-0 items-center gap-2 border-b py-2', wide ? 'px-4' : 'pl-2 pr-4')}>
            {wide ? null : (
              <Button variant="quiet" size="touch" icon={ChevronLeft} aria-label={view === 'recipe' ? 'Back to all help' : 'Close help'} onClick={back} className="text-fg" />
            )}
            <RadixDialog.Title className="flex min-w-0 flex-1 items-center gap-2 text-lg font-card tracking-snug text-fg">
              <Icon icon={CircleHelp} className="text-fg-muted" />
              Help
            </RadixDialog.Title>
            {wide ? <Button variant="quiet" icon={X} aria-label="Close help" onClick={onClose} className="-mr-2 rounded-pill text-fg" /> : null}
          </header>

          <div className="border-b px-4 py-3">
            <label className="relative block">
              <span className="sr-only">Search help</span>
              <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="How do I…"
                autoComplete="off"
                className="h-control w-full rounded-control border border-line-input bg-surface pl-10 pr-3 text-base text-fg transition-colors duration-fast ease-out placeholder:text-fg-muted hover:border-fg-muted md:text-sm"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {view === 'results' ? (
              <Results results={results} query={query} onShow={show} />
            ) : view === 'recipe' && recipe ? (
              <RecipeView recipe={recipe} recipes={allowed} headingRef={recipeHeadingRef} onShow={show} wide={wide} />
            ) : (
              <div className="grid content-start gap-5">
                {recipeId && !recipe ? (
                  <p role="status" className="rounded-control bg-sunken px-3 py-2 text-base text-fg-2 text-pretty">
                    That help page is not here any more. Pick one below.
                  </p>
                ) : null}
                {here.length ? <RecipeList title="For this screen" recipes={here} onShow={show} /> : null}
                {groupByArea(mine, role).map(g => (
                  <RecipeList key={g.area} title={g.area} recipes={g.recipes} onShow={show} />
                ))}
                {role === 'admin' || role === 'engineer' ? null : (
                  <div className="px-2">
                    <Checkbox label="Show other roles' help" checked={everyone} onCheckedChange={v => setEveryone(v === true)} />
                  </div>
                )}
                <HowItWorksList role={role} onShow={show} />
                <p className="px-2 text-base text-fg-2 text-pretty">Answer not found. Tell the owner what the task was. A step can be added here.</p>
              </div>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** "How this works" (owner decision 8): after the first week the card on Home is gone and the steps live here, inline. */
function HowItWorksList({ role, onShow }: { role: string; onShow: (id: string) => void }) {
  const id = useId()
  const steps = howItWorksFor(role)
  if (steps.length === 0) return null
  return (
    <section aria-labelledby={id} className="grid min-w-0 content-start gap-1">
      <SectionTitle id={id}>How this works</SectionTitle>
      <ol className="grid">
        {steps.map((s, i) => (
          <li key={s.recipe} className="flex items-start gap-2 border-b px-2 py-2 text-base text-fg-2 last:border-b-0">
            <StepNumber n={i + 1} besideButton />
            <span id={`${id}-step-${i}`} className={cn('min-w-0 flex-1 text-pretty', STEP_TEXT_BESIDE_BUTTON)}>
              <InlineMarkdown text={s.text} />
            </span>
            <Button variant="quiet" size="sm" aria-describedby={`${id}-step-${i}`} onClick={() => onShow(s.recipe)} className="shrink-0">
              Show me
            </Button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** A section's title in the panel: bold, secondary size, the second ink (.qb-help__sec-t). */
function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h3 id={id} className="px-2 text-sm font-bold text-fg-2">
      {children}
    </h3>
  )
}

function RecipeList({ title, recipes, onShow }: { title: string; recipes: readonly Recipe[]; onShow: (id: string) => void }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="grid min-w-0 content-start gap-1">
      <SectionTitle id={id}>{title}</SectionTitle>
      <ul className="grid">
        {recipes.map(r => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onShow(r.id)}
              className="group flex min-h-touch w-full items-center gap-2 rounded-control p-2 text-left text-base font-medium text-fg transition-colors duration-fast ease-out hover:bg-brand-100 active:bg-brand-100 lg:min-h-control"
            >
              <span className="min-w-0 flex-1 break-words text-pretty">{r.title}</span>
              <Icon icon={ChevronRight} size="sm" className="text-fg-muted transition-transform duration-fast ease-out group-hover:translate-x-1 motion-reduce:transform-none" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Results({ results, query, onShow }: { results: readonly Recipe[]; query: string; onShow: (id: string) => void }) {
  return (
    <div className="grid content-start gap-3">
      <p role="status" className="px-2 text-base text-fg-muted text-pretty">
        {results.length ? `${results.length} ${results.length === 1 ? 'answer' : 'answers'} for “${query.trim()}”` : `Nothing matches “${query.trim()}”. Try one word, like quotation or payment.`}
      </p>
      {results.length ? <RecipeList title="Answers" recipes={results} onShow={onShow} /> : null}
    </div>
  )
}

function RecipeView({
  recipe,
  recipes,
  headingRef,
  onShow,
  wide,
}: {
  recipe: Recipe
  recipes: readonly Recipe[]
  headingRef: RefObject<HTMLHeadingElement>
  onShow: (id: string | null) => void
  wide: boolean
}) {
  const next = recipe.related.map(id => findRecipe(id, recipes as Recipe[])).filter((r): r is Recipe => Boolean(r))
  return (
    <article className="grid min-w-0 content-start gap-4" aria-labelledby={`help-${recipe.id}`}>
      {wide ? (
        <Button variant="quiet" size="sm" icon={ChevronLeft} onClick={() => onShow(null)} className="-ml-2 justify-self-start">
          All help
        </Button>
      ) : null}
      <h3 id={`help-${recipe.id}`} ref={headingRef} tabIndex={-1} className="break-words text-lg font-card tracking-snug text-fg focus:outline-none">
        <span className="block text-sm font-semibold tracking-normal text-fg-muted">How do I…</span>
        {recipe.title}
      </h3>
      <MarkdownBlocks blocks={recipe.blocks} />
      {next.length ? <RecipeList title="Next" recipes={next} onShow={onShow} /> : null}
    </article>
  )
}
