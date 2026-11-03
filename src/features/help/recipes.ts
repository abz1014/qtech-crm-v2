import { labelsIn, parseInline, parseMarkdown, plainText, type Block } from '@/features/help/markdown'

/*
 * "How do I..." recipes (learnability spec, 2.2 to 2.4). One recipe per file in docs/help/, a tiny front matter on top:
 *
 *   ---
 *   id: new-rfq                      the file name without .md; ?help=new-rfq opens it
 *   title: Log a new enquiry         read after "How do I..."
 *   roles: sales, admin              who it is for (engineer, sales, admin)
 *   keywords: enquiry, customer      extra words search should find it by (optional)
 *   screens: /rfqs, /todo            route prefixes where it is offered under "For this screen" (optional)
 *   related: ask-suppliers           recipes to read next (optional)
 *   ---
 *   1. Tap [RFQs], then [New RFQ].   at most 7 steps; [Label] is the exact on-screen label
 *
 * A writer changes help by editing markdown only: no screen registers anything. labelSync.test.ts keeps every [Label]
 * true to the screens.
 */

export type HelpRole = 'sales' | 'engineer' | 'admin'
export const HELP_ROLES: readonly HelpRole[] = ['sales', 'engineer', 'admin']
export const MAX_STEPS = 7

export interface Recipe {
  id: string
  title: string
  roles: HelpRole[]
  keywords: string[]
  screens: string[]
  related: string[]
  /** The markdown under the front matter. */
  body: string
  blocks: Block[]
  /** The numbered steps, as plain words (labels keep their words). */
  steps: string[]
  /** Every [Label] in the body. */
  labels: string[]
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

/** One recipe file. Throws a sentence naming the file when the front matter is wrong, so a typo fails the tests, not the panel. */
export function parseRecipe(raw: string, file: string): Recipe {
  const src = raw.replace(/\r\n?/g, '\n')
  const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src)
  if (!fm) throw new Error(`${file}: a recipe starts with a front matter block between two "---" lines`)
  const meta: Record<string, string> = {}
  for (const line of fm[1].split('\n')) {
    const m = /^([a-z]+):\s*(.*)$/.exec(line.trim())
    if (m) meta[m[1]] = m[2].trim()
    else if (line.trim()) throw new Error(`${file}: front matter line "${line.trim()}" is not "key: value"`)
  }
  const id = meta.id ?? ''
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`${file}: id "${id}" must be lower-case words joined by hyphens`)
  const base = file.replace(/^.*[\\/]/, '').replace(/\.md$/, '')
  if (base !== id) throw new Error(`${file}: id "${id}" must match the file name (${base}.md)`)
  if (!meta.title) throw new Error(`${file}: title is missing`)
  const roles = list(meta.roles)
  const bad = roles.filter(r => !(HELP_ROLES as readonly string[]).includes(r))
  if (!roles.length || bad.length) throw new Error(`${file}: roles must list sales, engineer or admin (got "${meta.roles ?? ''}")`)
  const body = fm[2].trim()
  const blocks = parseMarkdown(body)
  const steps = blocks.flatMap(b => (b.kind === 'steps' ? b.items.map(plainText) : []))
  return {
    id,
    title: meta.title,
    roles: roles as HelpRole[],
    keywords: list(meta.keywords),
    screens: list(meta.screens),
    related: list(meta.related),
    body,
    blocks,
    steps,
    labels: labelsIn(body),
  }
}

/** The recipe files, bundled as text (Vite's ?raw). README.md (how to write one) is not a recipe. */
const files = import.meta.glob('../../../docs/help/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

let cache: Recipe[] | null = null

/** Every recipe, sorted by title. Parsed once. */
export function allRecipes(): Recipe[] {
  cache ??= Object.entries(files)
    .filter(([file]) => !/README\.md$/i.test(file))
    .map(([file, raw]) => parseRecipe(raw, file))
    .sort((a, b) => a.title.localeCompare(b.title))
  return cache
}

export function findRecipe(id: string | null | undefined, recipes: readonly Recipe[] = allRecipes()): Recipe | undefined {
  return id ? recipes.find(r => r.id === id) : undefined
}

/** A role's own recipes. Admin can do everything, so admin sees every recipe; `everyone` shows all roles' recipes to anyone. */
export function recipesForRole(recipes: readonly Recipe[], role: string, everyone = false): Recipe[] {
  if (everyone || role === 'admin') return recipes.slice()
  return recipes.filter(r => (r.roles as string[]).includes(role))
}

/** Recipes offered on this screen: a `screens:` prefix matches the path (on a segment boundary), most specific first. */
export function recipesForPath(recipes: readonly Recipe[], pathname: string, role: string): Recipe[] {
  const depth = (r: Recipe) =>
    Math.max(-1, ...r.screens.filter(s => pathname === s || pathname.startsWith(s.endsWith('/') ? s : `${s}/`)).map(s => s.length))
  return recipesForRole(recipes, role)
    .map(r => ({ r, d: depth(r) }))
    .filter(x => x.d >= 0)
    .sort((a, b) => b.d - a.d)
    .map(x => x.r)
}

/** The app's areas, in tab order: a recipe is listed under the area of its first `screens:` entry. */
const AREAS: ReadonlyArray<readonly [prefix: string, area: string]> = [
  ['/todo', 'To do'],
  ['/jobs', 'Jobs'],
  ['/rfqs', 'RFQs'],
  ['/companies', 'Companies'],
  ['/money', 'Money'],
  ['/settings', 'Team and settings'],
]

/** Recipes grouped by area, so a long list (admin sees every recipe) reads like the app's tabs. Empty areas are left out. */
export function groupByArea(recipes: readonly Recipe[]): Array<{ area: string; recipes: Recipe[] }> {
  const groups = new Map<string, Recipe[]>([...AREAS.map(([, area]) => [area, []] as [string, Recipe[]]), ['Other', []]])
  for (const r of recipes) {
    const first = r.screens[0] ?? ''
    const area = AREAS.find(([prefix]) => first === prefix || first.startsWith(`${prefix}/`))?.[1] ?? 'Other'
    groups.get(area)?.push(r)
  }
  return [...groups].filter(([, list]) => list.length > 0).map(([area, list]) => ({ area, recipes: list }))
}

/** The words a recipe is found by: title, keywords and steps. */
function haystack(r: Recipe): string {
  return `${r.title} ${r.keywords.join(' ')} ${plainText(parseInline(r.body))}`.toLowerCase()
}

/**
 * Search, for the panel and the palette: every typed word must appear (title, keywords or steps). Title matches first.
 * "how", "do", "i" and "help" on their own are not search words, so "how do I quote" finds the quotation recipes and
 * "help" alone lists everything. Text with no letter or digit we can search by ("%", "_", Urdu) finds nothing, not everything.
 */
export function searchRecipes(recipes: readonly Recipe[], query: string): Recipe[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9&']+/)
    .filter(w => /[a-z0-9]/.test(w))
  if (!tokens.length) return []
  const words = tokens.filter(w => !STOP.has(w))
  if (!words.length) return recipes.slice()
  const scored = recipes
    .map(r => {
      const hay = haystack(r)
      if (!words.every(w => hay.includes(w))) return null
      const title = r.title.toLowerCase()
      const inTitle = words.filter(w => title.includes(w)).length
      const inKeywords = words.filter(w => r.keywords.some(k => k.toLowerCase().includes(w))).length
      return { r, score: inTitle * 2 + inKeywords }
    })
    .filter((x): x is { r: Recipe; score: number } => x !== null)
  return scored.sort((a, b) => b.score - a.score).map(x => x.r)
}

const STOP = new Set(['how', 'do', 'i', 'help', 'a', 'an', 'the', 'to', 'my', 'is', 'can', 'what', 'where'])
