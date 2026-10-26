import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/*
 * The words a person can read in the app, read from the source (tests only: labelSync.test.ts keeps the help recipes true to the
 * screens, oneName.test.ts finds one action under two names). Two questions:
 *   visibleStrings(file)        the string literals, template literals and JSX text runs in one file;
 *   screenFiles(route)          the source files a screen can draw: the screen's entry module and everything it imports
 *                               (static and lazy), plus the app shell (top bar, tabs, palette, Paste or photo, Help).
 */

export const SRC = path.resolve(__dirname, '..')

/** Folders that are not screens: tests and fixtures, the dev gallery. */
const SKIP_DIRS = new Set(['dev', 'test', '__fixtures__', '__snapshots__', 'node_modules'])

const isSource = (name: string) => /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')

/** Every source file under `dir` (screens only: no tests, no gallery). `skip` leaves out more folders by path. */
export function sourceFiles(dir: string, skip: (dir: string, name: string) => boolean = () => false): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(name) || skip(dir, name) ? [] : sourceFiles(p, skip)
    return isSource(name) ? [p] : []
  })
}

export const norm = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\.\.\.|…|:)$/, '')
    .trim()

/** A piece of visible text: words, or a hole where code inserts a value (with the literal words that value can be). */
export type Piece = string | { alts: string[] }

/**
 * The string literals inside an inserted expression: `${n === 1 ? 'supplier' : 'suppliers'}` can be either word. A bare name
 * (`Mark {verb}`) is followed to the `const verb = … ? 'reminded' : 'chased'` declarations of that name in the same file.
 */
function literalsIn(node: ts.Node, consts: Map<string, ts.Expression[]>, depth = 0): string[] {
  const out: string[] = []
  const walk = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text)
    else if (ts.isIdentifier(n) && depth < 3) for (const init of consts.get(n.text) ?? []) out.push(...literalsIn(init, consts, depth + 1))
    ts.forEachChild(n, walk)
  }
  walk(node)
  return out
}

/** Every `const name = <expression>` in a file, by name (a name declared twice keeps both). */
function constsOf(sf: ts.SourceFile): Map<string, ts.Expression[]> {
  const out = new Map<string, ts.Expression[]>()
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) out.set(n.name.text, [...(out.get(n.name.text) ?? []), n.initializer])
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const parsed = new Map<string, Piece[][]>()

/** Strings a person can read: string and template literals, and each run of JSX text (an {expression} in the run is a hole). */
export function visibleStrings(file: string): Piece[][] {
  const hit = parsed.get(file)
  if (hit) return hit
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const consts = constsOf(sf)
  const out: Piece[][] = []
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push([node.text])
    else if (ts.isTemplateExpression(node)) {
      out.push([node.head.text, ...node.templateSpans.flatMap(s => [{ alts: literalsIn(s.expression, consts) }, s.literal.text])])
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
          run.push(ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : { alts: literalsIn(e, consts) })
        } else end()
      }
      end()
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  parsed.set(file, out)
  return out
}

/* ---------- which files a screen can draw ---------- */

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile() && isSource(path.basename(c))) return c
  }
  return null
}

const importsCache = new Map<string, string[]>()
function importsOf(file: string): string[] {
  let hit = importsCache.get(file)
  if (!hit) {
    const text = readFileSync(file, 'utf8')
    hit = [...text.matchAll(IMPORT)].map(m => resolveImport(file, m[1])).filter((p): p is string => p !== null && !p.split(path.sep).includes('dev'))
    importsCache.set(file, hit)
  }
  return hit
}

/** The entry modules and everything they import, static or lazy, inside src (the dev gallery left out). */
export function importGraph(entries: readonly string[]): Set<string> {
  const seen = new Set<string>()
  const queue = entries.map(e => path.join(SRC, e))
  for (const e of queue) if (!existsSync(e)) throw new Error(`screen entry ${path.relative(SRC, e)} does not exist: update SCREEN_ENTRIES in src/test/visibleStrings.ts`)
  while (queue.length) {
    const f = queue.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    queue.push(...importsOf(f))
  }
  return seen
}

/** The app shell, on every screen: top bar, phone tabs, the palette, Paste or photo, Help. */
export const SHELL_ENTRY = 'app/shell/AppShell.tsx'

/** The first path segment of a route to the module(s) that draw it (src/app/routes.tsx). */
export const SCREEN_ENTRIES: Record<string, readonly string[]> = {
  todo: ['features/today/TodayScreen.tsx'],
  rfqs: ['features/rfqs/board/RfqsScreen.tsx', 'features/rfqs/IntakeScreen.tsx'],
  orders: ['features/orders/OrdersScreen.tsx'],
  companies: ['features/companies/CompaniesScreen.tsx'],
  money: ['features/money/MoneyScreen.tsx'],
  /** 0087: an engineer's "I paid" (src/app/routes.tsx, my-expenses). */
  'my-expenses': ['features/money/expenses/MyClaimsPage.tsx'],
  settings: [
    'features/settings/SettingsLayout.tsx',
    'features/settings/TeamPage.tsx',
    'features/settings/TargetsPage.tsx',
    'features/settings/CategoriesPage.tsx',
    'features/settings/ChangePasswordPage.tsx',
    'features/settings/MyDetailsPage.tsx',
    'features/settings/CompanyProfilePage.tsx',
    'features/fx/ExchangeRatesPage.tsx',
  ],
  capture: ['features/capture/CaptureRoute.tsx'],
}

/** The files a route ("/money/expenses") can draw, the shell included. Throws for a route no screen owns. */
export function screenFiles(route: string): Set<string> {
  const key = route.replace(/^\//, '').split(/[/?#]/)[0]
  const entries = SCREEN_ENTRIES[key]
  if (!entries) throw new Error(`no screen owns the route "${route}" (known: ${Object.keys(SCREEN_ENTRIES).map(k => `/${k}`).join(', ')})`)
  return importGraph([SHELL_ENTRY, ...entries])
}
