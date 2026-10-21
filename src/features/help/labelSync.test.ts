import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ALONE, FIRST_USE_COPY } from '@/features/help/firstUseCopy'
import { HOW_IT_WORKS } from '@/features/help/howItWorks'
import { MAX_STEPS, parseRecipe, type Recipe } from '@/features/help/recipes'
import { norm, screenFiles, sourceFiles, visibleStrings, type Piece } from '@/test/visibleStrings'

/*
 * Help stays true to the screens (learnability spec 2.5; the audit found the one-page guides already disagreeing with the
 * labels). For every recipe in docs/help/*.md:
 *   1. every [Label] is a user-visible string ON THE SCREENS THE RECIPE NAMES in its `screens:` line (a string literal, a
 *      template literal or JSX text in the screen's module, anything it imports, static or lazy, or the app shell; never tests,
 *      the dev gallery or this help folder). A label that exists only on another screen fails, naming where it really is.
 *      "N" in a label stands for a number, "<anything>" for any value, so "[Copy message for N suppliers]" matches
 *      `Copy message for ${n} suppliers`;
 *   2. at most MAX_STEPS numbered steps, each at most 30 words;
 *   3. every recipe named in code (howItWorks.ts, firstUseCopy.ts) or in a `related:` line exists;
 *   4. every primary-button label (rfqs/lib/nextAction.ts, orders/lib/primaryAction.ts, once those files exist) is a
 *      [Label] in at least one recipe, so a new green button cannot ship without help.
 *
 * PENDING lists labels that are only on screen on an unmerged branch. Each one is skipped (and named in the test title)
 * until it reaches main; from then on the test FAILS until the entry is deleted, so the list empties itself as the
 * branches merge. HELP_LABEL_SRC (paths joined by the OS path separator) scans other source trees, whole, instead of the
 * screens of ./src, for checking the labels against a branch checkout.
 */

/** Label -> the unmerged branch it is on. Delete an entry once that branch is merged: the test says when ("is on main now"). */
const PENDING: Record<string, string> = {}

const here = __dirname
const repo = path.resolve(here, '../../..')
const DOCS = path.join(repo, 'docs/help')
const OTHER_ROOTS = process.env.HELP_LABEL_SRC ? process.env.HELP_LABEL_SRC.split(path.delimiter).map(p => path.resolve(p)) : null
const MAX_WORDS = 30

/** This help folder names labels on purpose, so its own strings never count as "on the screen". */
const HELP_DIR = path.join(repo, 'src', 'features', 'help') + path.sep
const notHelp = (f: string) => !f.startsWith(HELP_DIR)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface Corpus {
  /** Strings with nothing inserted, normalised. */
  exact: Set<string>
  /** Strings with holes, as patterns over a label: a hole matches N, a <placeholder>, a number or one of its literal words. */
  patterns: Array<{ shown: string; re: RegExp }>
}

/** Marks a hole while the pieces are joined and normalised: ⟦0⟧, ⟦1⟧ (characters no screen text uses). */
const HOLE_MARK = /⟦(\d+)⟧/g

function toEntry(pieces: Piece[], c: Corpus) {
  const alts: string[][] = []
  const joined = norm(pieces.map(p => (typeof p === 'string' ? p : `⟦${alts.push(p.alts) - 1}⟧`)).join(''))
  if (!joined) return
  if (!alts.length) {
    c.exact.add(joined)
    return
  }
  // A string that is mostly holes ("{a} {b}") would match anything: it needs a real word of its own.
  if (!/[A-Za-z]{3}/.test(joined.replace(HOLE_MARK, ''))) return
  const source = joined
    .split(/⟦(\d+)⟧/)
    .map((part, i) => (i % 2 ? `(?:N|<[^>]+>|\\d+${alts[Number(part)].map(a => `|${escape(norm(a))}`).join('')})` : escape(part)))
    .join('')
  c.patterns.push({ shown: joined.replace(HOLE_MARK, '{…}'), re: new RegExp(`^${source}$`) })
}

function corpusOf(files: Iterable<string>): Corpus {
  const c: Corpus = { exact: new Set(), patterns: [] }
  for (const file of files) for (const pieces of visibleStrings(file)) toEntry(pieces, c)
  return c
}

const has = (c: Corpus, label: string) => {
  const l = norm(label)
  return c.exact.has(l) || c.patterns.some(p => p.re.test(l))
}

/* ---------- the corpora: the whole source (for "where is it then?") and one per screen ---------- */

const allFiles = () =>
  OTHER_ROOTS
    ? OTHER_ROOTS.flatMap(root => sourceFiles(root, (dir, name) => name === 'help' && path.basename(dir) === 'features'))
    : sourceFiles(path.join(repo, 'src')).filter(notHelp)

let wholeCache: Corpus | null = null
const whole = () => (wholeCache ??= corpusOf(allFiles()))

const screenCache = new Map<string, { files: string[]; corpus: Corpus }>()
/** The visible strings of the screens a recipe names (shell included). With HELP_LABEL_SRC, the whole other tree. */
function screensCorpus(screens: readonly string[]): Corpus {
  if (OTHER_ROOTS || !screens.length) return whole()
  const key = [...screens].sort().join(',')
  let hit = screenCache.get(key)
  if (!hit) {
    const files = [...new Set(screens.flatMap(s => [...screenFiles(s)]))].filter(notHelp)
    hit = { files, corpus: corpusOf(files) }
    screenCache.set(key, hit)
  }
  return hit.corpus
}

/** The source files (relative to src) where a label is a visible string, for the failure message. */
function whereIs(label: string): string[] {
  return allFiles()
    .filter(f => has(corpusOf([f]), label))
    .map(f => path.relative(path.join(repo, 'src'), f).split(path.sep).join('/'))
    .slice(0, 3)
}

/** Up to three source strings that look like the label, for the failure message. */
function closest(label: string, c: Corpus): string[] {
  const words = norm(label).toLowerCase().split(' ').filter(w => w.length > 2)
  return [...c.exact, ...c.patterns.map(p => p.shown)]
    .filter(s => s.length < 80)
    .map(s => ({ s, hits: words.filter(w => s.toLowerCase().includes(w)).length }))
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.s.length - b.s.length)
    .slice(0, 3)
    .map(x => `"${x.s}"`)
}

/** Fails with one readable line per problem (the recipe and the label), instead of a truncated array diff. */
function noProblems(lines: string[]) {
  if (lines.length) throw new Error(`\n${lines.join('\n')}`)
}

/* ---------- the recipes ---------- */

const recipes: Recipe[] = readdirSync(DOCS)
  .filter(f => f.endsWith('.md') && f !== 'README.md')
  .sort()
  .map(f => parseRecipe(readFileSync(path.join(DOCS, f), 'utf8'), `docs/help/${f}`))
const ids = new Set(recipes.map(r => r.id))

describe('help recipes stay true to the screens (labelSync)', () => {
  // Every source file is parsed with the TypeScript compiler once (about 5 s on an idle machine). Built lazily it was charged to
  // whichever recipe test ran first, which hit the 30 s testTimeout on a contended machine. A hook of its own carries the
  // one-time cost; the per-recipe tests then only walk imports and look strings up.
  beforeAll(() => {
    whole()
  }, 180_000)

  it('there are recipes for every role, ids are unique, and every recipe names its screens', () => {
    expect(ids.size).toBe(recipes.length)
    for (const role of ['sales', 'engineer', 'admin']) expect(recipes.filter(r => (r.roles as string[]).includes(role)).length).toBeGreaterThan(2)
    noProblems(recipes.filter(r => !r.screens.length).map(r => `recipe "${r.id}" has no screens: line, so its labels cannot be checked against a screen`))
  })

  for (const r of recipes) {
    const pending = r.labels.filter(l => PENDING[l])
    const where = r.screens.join(', ') || 'any screen'
    const title = pending.length
      ? `${r.id}: every [Label] is on ${where} (pending until merged: ${pending.map(l => `[${l}] ${PENDING[l]}`).join(', ')})`
      : `${r.id}: every [Label] is on ${where}`
    it(title, () => {
      const c = screensCorpus(r.screens)
      const missing = r.labels
        .filter(l => !PENDING[l] && !has(c, l))
        .map(l => {
          const elsewhere = has(whole(), l) ? whereIs(l) : []
          return elsewhere.length
            ? `recipe "${r.id}" (docs/help/${r.id}.md): [${l}] is not on ${where}; it is drawn by ${elsewhere.join(', ')}. Add that screen to screens: or fix the label`
            : `recipe "${r.id}" (docs/help/${r.id}.md): [${l}] is not on any screen. Closest on ${where}: ${closest(l, c).join(', ') || 'none'}`
        })
      const landed = pending.filter(l => has(c, l)).map(l => `recipe "${r.id}": [${l}] is on main now; delete it from PENDING in labelSync.test.ts`)
      noProblems([...missing, ...landed])
    }, 60_000)

    it(`${r.id}: at most ${MAX_STEPS} steps of at most ${MAX_WORDS} words`, () => {
      const problems: string[] = []
      if (r.steps.length === 0) problems.push(`recipe "${r.id}" has no numbered steps`)
      if (r.steps.length > MAX_STEPS) problems.push(`recipe "${r.id}" has ${r.steps.length} steps (at most ${MAX_STEPS})`)
      r.steps.forEach((s, i) => {
        const n = s.split(/\s+/).filter(Boolean).length
        if (n > MAX_WORDS) problems.push(`recipe "${r.id}" step ${i + 1} has ${n} words (at most ${MAX_WORDS})`)
      })
      noProblems(problems)
    })
  }

  it('every PENDING label is still used by a recipe', () => {
    const used = new Set(recipes.flatMap(r => r.labels))
    noProblems(Object.keys(PENDING).filter(l => !used.has(l)).map(l => `PENDING lists [${l}], which no recipe uses any more: delete it`))
  })

  it('every recipe named in code or in a related: line exists', () => {
    const named = [
      ...Object.values(HOW_IT_WORKS).flatMap(steps => steps.map(s => ({ where: 'howItWorks.ts', id: s.recipe }))),
      ...Object.entries(FIRST_USE_COPY).flatMap(([screen, byRole]) =>
        Object.values(byRole).flatMap(c => (c?.recipe ? [{ where: `firstUseCopy.ts (${screen})`, id: c.recipe }] : [])),
      ),
      ...(ADMIN_ALONE.recipe ? [{ where: 'firstUseCopy.ts (ADMIN_ALONE)', id: ADMIN_ALONE.recipe }] : []),
      ...recipes.flatMap(r => r.related.map(id => ({ where: `docs/help/${r.id}.md related:`, id }))),
    ]
    noProblems(named.filter(n => !ids.has(n.id)).map(n => `${n.where} names "${n.id}", which is not a recipe`))
  })

  it('every primary (green) button label is explained by at least one recipe', () => {
    const covered = new Set(recipes.flatMap(r => r.labels.map(norm)))
    // The RFQ page's green buttons (rfqs/lib/nextAction.ts names them by kind: ask, issue, won), the top-bar actions, and
    // the order page's steps, read from orders/lib/primaryAction.ts once that file is on main.
    const fixed = ['Ask suppliers', 'Issue quotation', 'Mark won', 'New RFQ', 'Paste or photo']
    const roots = OTHER_ROOTS ?? [path.join(repo, 'src')]
    const fromOrders = roots
      .map(root => path.join(root, 'features/orders/lib/primaryAction.ts'))
      .filter(existsSync)
      .flatMap(f => [...readFileSync(f, 'utf8').matchAll(/\blabel:\s*'([^']+)'/g)].map(m => m[1]))
    const missing = [...new Set([...fixed, ...fromOrders])].filter(l => !covered.has(norm(l)))
    noProblems(missing.map(l => `the green button [${l}] is in no recipe: add a recipe or a step that names it`))
  })
})

describe('label matching', () => {
  const match = (label: string, ...pieces: Piece[]) => {
    const c: Corpus = { exact: new Set(), patterns: [] }
    toEntry(pieces, c)
    return has(c, label)
  }
  it('an inserted value matches N, a <placeholder>, a number or one of the words the code can insert', () => {
    const copy: Piece[] = ['Copy message for ', { alts: [] }, ' ', { alts: ['supplier', 'suppliers'] }]
    expect(match('Copy message for N suppliers', ...copy)).toBe(true)
    expect(match('Copy message for 3 suppliers', ...copy)).toBe(true)
    expect(match('Copy message for N companies', ...copy)).toBe(false)
    expect(match('Close <month>', 'Close ', { alts: [] })).toBe(true)
    expect(match('Open Money', 'Open ', { alts: [] })).toBe(false)
  })
  it('plain strings match whole, ignoring spacing and a trailing colon or ellipsis', () => {
    expect(match('Mark won', 'Mark won')).toBe(true)
    expect(match('Snooze', 'Snooze…')).toBe(true)
    expect(match('Mark won', 'Mark won today')).toBe(false)
    expect(match('Save', 'Saved')).toBe(false)
    expect(match('Anything', { alts: [] }, ' ', { alts: [] })).toBe(false)
  })
})

describe('a screen is what its module draws', () => {
  it('the Today screen does not draw the Orders list, and every screen draws the shell', () => {
    const today = screenFiles('/today')
    const rel = (f: string) => path.relative(path.join(repo, 'src'), f).split(path.sep).join('/')
    const names = [...today].map(rel)
    expect(names).toContain('features/today/TodayScreen.tsx')
    expect(names).toContain('app/shell/TopBar.tsx')
    expect(names).not.toContain('features/orders/OrdersListPage.tsx')
  })
  it('a route no screen owns is an error, not a silent pass', () => {
    expect(() => screenFiles('/nowhere')).toThrow(/no screen owns the route/)
  })
})
