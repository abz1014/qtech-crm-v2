import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ALONE, FIRST_USE_COPY } from '@/features/help/firstUseCopy'
import { HOW_IT_WORKS } from '@/features/help/howItWorks'
import { MAX_STEPS, parseRecipe, type Recipe } from '@/features/help/recipes'

/*
 * Help stays true to the screens (learnability spec 2.5; the audit found the one-page guides already disagreeing with the
 * labels). For every recipe in docs/help/*.md:
 *   1. every [Label] is a user-visible string in src/ (a string literal, a template literal or JSX text, outside tests,
 *      the dev gallery and this help folder). "N" in a label stands for a number, "<anything>" for any value, so
 *      "[Copy message for N suppliers]" matches `Copy message for ${n} suppliers`;
 *   2. at most MAX_STEPS numbered steps, each at most 30 words;
 *   3. every recipe named in code (howItWorks.ts, firstUseCopy.ts) or in a `related:` line exists;
 *   4. every primary-button label (rfqs/lib/nextAction.ts, orders/lib/primaryAction.ts, once those files exist) is a
 *      [Label] in at least one recipe, so a new green button cannot ship without help.
 *
 * PENDING lists labels that are only on screen on an unmerged ux branch. Each one is skipped (and named in the test title)
 * until it reaches main; from then on the test FAILS until the entry is deleted, so the list empties itself as the
 * branches merge and the check ends up fully on. HELP_LABEL_SRC (paths joined by the OS path separator) scans other source
 * trees instead of ./src, for checking the labels against a branch checkout.
 */

/**
 * Label -> the unmerged branch it is on (checked 2026-10-20 against origin/ux/* with HELP_LABEL_SRC). Delete an entry once
 * that branch is merged: the test says when, by failing with "is on main now".
 */
const PENDING: Record<string, string> = {}

const here = __dirname
const repo = path.resolve(here, '../../..')
const DOCS = path.join(repo, 'docs/help')
const SRC_ROOTS = process.env.HELP_LABEL_SRC ? process.env.HELP_LABEL_SRC.split(path.delimiter).map(p => path.resolve(p)) : [path.join(repo, 'src')]
const MAX_WORDS = 30

/* ---------- the user-visible strings in src ---------- */

/** Folders that are not screens: tests and fixtures, the dev gallery, and this help folder (it names labels on purpose). */
const SKIP_DIRS = new Set(['dev', 'test', '__fixtures__', '__snapshots__', 'node_modules'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) {
      if (SKIP_DIRS.has(name) || (name === 'help' && path.basename(dir) === 'features')) return []
      return sourceFiles(p)
    }
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [p] : []
  })
}

const norm = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\.\.\.|…|:)$/, '')
    .trim()

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A piece of visible text: words, or a hole where code inserts a value (with the literal words that value can be). */
type Piece = string | { alts: string[] }

/** The string literals inside an inserted expression: `${n === 1 ? 'supplier' : 'suppliers'}` can be either word. */
function literalsIn(node: ts.Node): string[] {
  const out: string[] = []
  const walk = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text)
    ts.forEachChild(n, walk)
  }
  walk(node)
  return out
}

/** Strings a person can read: string and template literals, and each run of JSX text (an {expression} in the run is a hole). */
function visibleStrings(file: string): Piece[][] {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Piece[][] = []
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push([node.text])
    else if (ts.isTemplateExpression(node)) {
      out.push([node.head.text, ...node.templateSpans.flatMap(s => [{ alts: literalsIn(s.expression) }, s.literal.text])])
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      let run: Piece[] = []
      const end = () => {
        if (run.some(p => typeof p === 'string' && p.trim())) out.push(run)
        run = []
      }
      for (const child of node.children) {
        if (ts.isJsxText(child)) run.push(child.text)
        else if (ts.isJsxExpression(child)) {
          const e = child.expression
          if (!e) continue
          run.push(ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : { alts: literalsIn(e) })
        } else end()
      }
      end()
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

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

let corpusCache: Corpus | null = null
function corpus(): Corpus {
  if (!corpusCache) {
    const c: Corpus = { exact: new Set(), patterns: [] }
    for (const root of SRC_ROOTS) for (const file of sourceFiles(root)) for (const pieces of visibleStrings(file)) toEntry(pieces, c)
    corpusCache = c
  }
  return corpusCache
}

/** True when the label (N for a number, <placeholder> for a value) is a visible string somewhere in the source. */
function onScreen(label: string): boolean {
  const l = norm(label)
  const c = corpus()
  return c.exact.has(l) || c.patterns.some(p => p.re.test(l))
}

/** Up to three source strings that look like the label, for the failure message. */
function closest(label: string): string[] {
  const words = norm(label).toLowerCase().split(' ').filter(w => w.length > 2)
  const c = corpus()
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
  // The corpus parses every source file with the TypeScript compiler (about 5 s on an idle machine). Built lazily it was charged to
  // whichever recipe test ran first, which hit the 30 s testTimeout when the machine was contended. A hook of its own carries the
  // one-time cost, with room for a contended machine; the per-recipe tests then only look strings up.
  beforeAll(() => {
    corpus()
  }, 180_000)

  it('there are recipes for every role, and ids are unique', () => {
    expect(ids.size).toBe(recipes.length)
    for (const role of ['sales', 'engineer', 'admin']) expect(recipes.filter(r => (r.roles as string[]).includes(role)).length).toBeGreaterThan(2)
  })

  for (const r of recipes) {
    const pending = r.labels.filter(l => PENDING[l])
    const title = pending.length
      ? `${r.id}: every [Label] is on a screen (pending until merged: ${pending.map(l => `[${l}] ${PENDING[l]}`).join(', ')})`
      : `${r.id}: every [Label] is on a screen`
    it(title, () => {
      const missing = r.labels
        .filter(l => !PENDING[l] && !onScreen(l))
        .map(l => `recipe "${r.id}" (docs/help/${r.id}.md): [${l}] is not on any screen. Closest in src: ${closest(l).join(', ') || 'none'}`)
      const landed = pending.filter(onScreen).map(l => `recipe "${r.id}": [${l}] is on main now; delete it from PENDING in labelSync.test.ts`)
      noProblems([...missing, ...landed])
    })

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
    const fromOrders = SRC_ROOTS.map(root => path.join(root, 'features/orders/lib/primaryAction.ts'))
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
    const l = norm(label)
    return c.exact.has(l) || c.patterns.some(p => p.re.test(l))
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
