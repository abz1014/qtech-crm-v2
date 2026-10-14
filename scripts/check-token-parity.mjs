// Token parity check (U01). Fails if any design token in src/index.css differs
// from docs/design/tokens.css, or if tailwind.config.ts hard-codes a colour
// instead of reading a token. Usage: node scripts/check-token-parity.mjs [tokens.css] [index.css] [tailwind.config.ts]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [tokensPath = path.join(root, 'docs/design/tokens.css'), indexPath = path.join(root, 'src/index.css'), tailwindPath = path.join(root, 'tailwind.config.ts')] =
  process.argv.slice(2)

const norm = s => s.replace(/\s+/g, ' ').trim()

/** Flatten a stylesheet to "selector-path :: --name" -> value for every custom property, plus a count of rules. */
export function extractTokens(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map()
  const stack = []
  let buf = ''
  for (const ch of src) {
    if (ch === '{') {
      stack.push(norm(buf))
      buf = ''
    } else if (ch === '}') {
      if (norm(buf)) addDecls(norm(buf))
      stack.pop()
      buf = ''
    } else if (ch === ';') {
      addDecls(norm(buf))
      buf = ''
    } else buf += ch
  }
  function addDecls(decl) {
    const m = /^(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(decl)
    if (m) out.set(`${stack.join(' > ')} :: ${m[1]}`, norm(m[2]))
  }
  return out
}

/** Only the tokens block of index.css is compared (between the markers). */
function tokenBlock(indexCss) {
  const a = indexCss.indexOf('/* tokens:start */')
  const b = indexCss.indexOf('/* tokens:end */')
  if (a < 0 || b < a) throw new Error('src/index.css is missing the /* tokens:start */ ... /* tokens:end */ markers')
  return indexCss.slice(a, b)
}

export function compare(tokensCss, indexCss, tailwindTs) {
  const errors = []
  const want = extractTokens(tokensCss)
  const have = extractTokens(tokenBlock(indexCss))
  for (const [k, v] of want) {
    if (!have.has(k)) errors.push(`missing in src/index.css: ${k}`)
    else if (have.get(k) !== v) errors.push(`value differs: ${k}\n    tokens.css: ${v}\n    index.css:  ${have.get(k)}`)
  }
  for (const k of have.keys()) if (!want.has(k)) errors.push(`not in tokens.css (invented in src/index.css): ${k}`)
  // The Tailwind theme must read tokens, never restate a colour.
  const stripped = tailwindTs.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of stripped.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/g)) {
    errors.push(`tailwind.config.ts hard-codes a colour (${m[0]}); read a token with var(--name)`)
  }
  // Every var(--x) used in the Tailwind config must exist in tokens.css.
  const names = new Set([...want.keys()].map(k => k.split(' :: ')[1]))
  for (const m of stripped.matchAll(/var\((--[\w-]+)/g)) {
    if (!names.has(m[1])) errors.push(`tailwind.config.ts reads an unknown token ${m[1]}`)
  }
  return { errors, count: want.size }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, count } = compare(readFileSync(tokensPath, 'utf8'), readFileSync(indexPath, 'utf8'), readFileSync(tailwindPath, 'utf8'))
  if (errors.length) {
    console.error(`Token parity FAILED (${errors.length}):\n  - ${errors.join('\n  - ')}`)
    process.exit(1)
  }
  console.log(`Token parity OK: ${count} custom properties match docs/design/tokens.css.`)
}
