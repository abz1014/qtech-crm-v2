import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, CircleHelp, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
import { Icon } from '@/ui/Icon'
import { MarkdownBlocks } from '@/features/help/RecipeText'
import { findRecipe, groupByArea, recipesForPath, recipesForRole, searchRecipes, type Recipe } from '@/features/help/recipes'

/*
 * The Help panel (learnability spec 2.2). Wide screens (1024 and up): a NON-modal panel on the right, 400px, under the top
 * bar. No focus trap and no scrim, so the page stays usable and the person can follow the steps while doing them.
 * Phones and tablets: a full-height sheet with a back arrow (modal, so focus stays in it). Esc closes either.
 *
 * Top to bottom: search, "For this screen" (recipes whose screens: match the path), the person's own recipes by area
 * (Today, RFQs, Orders, Money...; "Show other roles" adds the rest; admin sees all), and a recipe view. Steps show on-screen labels as chips. Nothing is fetched: the
 * recipes are bundled markdown (recipes.ts).
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
  /** Offered on the list when the person has hidden the How this works card. */
  onShowHowItWorks?: () => void
}

const FOR_SCREEN = 3

export function HelpPanel({ recipes, role, pathname, recipeId, onShow, onClose, wide, onShowHowItWorks }: HelpPanelProps) {
  const [query, setQuery] = useState('')
  const [everyone, setEveryone] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const recipeHeadingRef = useRef<HTMLHeadingElement>(null)
  const recipe = findRecipe(recipeId, recipes as Recipe[])
  const view: 'results' | 'recipe' | 'home' = query.trim() ? 'results' : recipe ? 'recipe' : 'home'

  const mine = useMemo(() => recipesForRole(recipes, role, everyone), [recipes, role, everyone])
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
          // The side panel leaves the page usable: a click on the page does not close it.
          onInteractOutside={e => (wide ? e.preventDefault() : undefined)}
          onOpenAutoFocus={e => {
            e.preventDefault()
            if (recipe) recipeHeadingRef.current?.focus()
            else searchRef.current?.focus()
          }}
          className={cn(
            'fixed z-40 flex flex-col bg-surface focus:outline-none',
            wide
              ? 'bottom-0 right-0 top-[var(--topbar-h)] w-[400px] animate-fade-in border-l shadow-modal'
              : 'inset-0 animate-sheet-in pb-[env(safe-area-inset-bottom,0px)]',
          )}
        >
          <header className="flex items-center gap-2 border-b px-3 py-2 lg:px-5 lg:py-3">
            {wide ? null : (
              <Button variant="quiet" size="touch" icon={ChevronLeft} aria-label={view === 'recipe' ? 'Back to all help' : 'Close help'} onClick={back} />
            )}
            <RadixDialog.Title className="flex flex-1 items-center gap-2 text-lg font-semibold tracking-snug">
              <Icon icon={CircleHelp} className="text-fg-muted" />
              Help
            </RadixDialog.Title>
            {wide ? <Button variant="quiet" size="sm" icon={X} aria-label="Close help" onClick={onClose} className="-mr-2 text-fg-muted" /> : null}
          </header>

          <div className="border-b px-4 py-3 lg:px-5">
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
                className="h-control w-full rounded border border-line-input bg-surface pl-10 pr-3 text-base text-fg placeholder:text-fg-muted md:text-sm"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-5">
            {view === 'results' ? (
              <Results results={results} query={query} onShow={show} />
            ) : view === 'recipe' && recipe ? (
              <RecipeView recipe={recipe} recipes={recipes} headingRef={recipeHeadingRef} onShow={show} wide={wide} />
            ) : (
              <div className="grid content-start gap-6">
                {recipeId && !recipe ? (
                  <p role="status" className="rounded bg-sunken px-3 py-2 text-base text-fg-2">
                    That help page is not here any more. Pick one below.
                  </p>
                ) : null}
                {here.length ? <RecipeList title="For this screen" recipes={here} onShow={show} /> : null}
                {groupByArea(mine).map(g => (
                  <RecipeList key={g.area} title={g.area} recipes={g.recipes} onShow={show} />
                ))}
                {role === 'admin' ? null : <Checkbox label="Show other roles' help" checked={everyone} onCheckedChange={v => setEveryone(v === true)} />}
                {onShowHowItWorks ? (
                  <Button variant="quiet" size="sm" onClick={onShowHowItWorks} className="justify-self-start">
                    Show “How this works” again
                  </Button>
                ) : null}
                <p className="text-base text-fg-muted">Still stuck? Tell the owner what you were trying to do. They can add a step here.</p>
              </div>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

function RecipeList({ title, recipes, onShow }: { title: string; recipes: readonly Recipe[]; onShow: (id: string) => void }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="grid content-start gap-1">
      <h3 id={id} className="text-sm font-semibold text-fg-2">
        {title}
      </h3>
      <ul className="grid">
        {recipes.map(r => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onShow(r.id)}
              className="flex min-h-touch w-full items-center gap-2 rounded px-2 py-2 text-left text-base text-fg hover:bg-sunken lg:min-h-control"
            >
              <span className="flex-1 text-pretty">{r.title}</span>
              <Icon icon={ChevronRight} size="sm" className="text-fg-muted" />
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
      <p role="status" className="text-base text-fg-muted">
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
    <article className="grid content-start gap-4" aria-labelledby={`help-${recipe.id}`}>
      {wide ? (
        <Button variant="quiet" size="sm" icon={ChevronLeft} onClick={() => onShow(null)} className="-ml-2 justify-self-start">
          All help
        </Button>
      ) : null}
      <h3 id={`help-${recipe.id}`} ref={headingRef} tabIndex={-1} className="text-lg font-semibold tracking-snug text-fg focus:outline-none">
        <span className="block text-sm font-medium text-fg-muted">How do I…</span>
        {recipe.title}
      </h3>
      <MarkdownBlocks blocks={recipe.blocks} />
      {next.length ? <RecipeList title="Next" recipes={next} onShow={onShow} /> : null}
    </article>
  )
}
