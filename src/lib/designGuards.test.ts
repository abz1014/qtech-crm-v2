import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')
const script = path.join(root, 'scripts/check-token-parity.mjs')

async function lint(filePath: string, code: string) {
  const eslint = new ESLint({ cwd: root })
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) })
  return result.messages.filter(m => m.ruleId === 'no-restricted-syntax').map(m => m.message)
}

describe('lint bans (U01): planted violations fail', () => {
  it('bans text-[...] in features', async () => {
    const m = await lint('src/features/x/Y.tsx', 'export const Y = () => <p className="text-[13px]">x</p>')
    expect(m.join()).toContain('text-[...] is banned')
  })

  it('bans arbitrary colours (hex, rgb, hsl) in features and ui', async () => {
    for (const cls of ['bg-[#fff]', 'text-[rgb(1,2,3)]', 'md:hover:border-[hsl(1,2%,3%)]']) {
      const code = `export const Y = () => <p className="${cls}">x</p>`
      expect((await lint('src/features/x/Y.tsx', code)).join()).toContain('Arbitrary colours')
      expect((await lint('src/ui/Y.tsx', code)).join()).toContain('Arbitrary colours')
    }
  })

  it('bans arbitrary shadows', async () => {
    const m = await lint('src/features/x/Y.tsx', 'export const Y = () => <p className="shadow-[0_1px_2px_black]">x</p>')
    expect(m.join()).toContain('Arbitrary shadows')
  })

  it('bans class strings inside cn() calls', async () => {
    const m = await lint('src/features/x/Y.tsx', 'const c = cn("flex", cond && "gap-2 bg-[#abc]")')
    expect(m.join()).toContain('Arbitrary colours')
  })

  it('bans raw table markup in features', async () => {
    const m = await lint('src/features/x/Y.tsx', 'export const Y = () => <table><tbody><tr><td>x</td></tr></tbody></table>')
    expect(m.join()).toContain('Raw table markup is banned')
  })

  it('allows token classes and non-colour arbitrary values', async () => {
    const m = await lint(
      'src/features/x/Y.tsx',
      'export const Y = () => <p className="text-sm bg-surface shadow-pop grid-cols-[1fr_auto] w-[calc(100%-4px)]">x</p>',
    )
    expect(m).toEqual([])
  })

  it('allows raw tables inside primitives (src/ui)', async () => {
    const m = await lint('src/ui/DataTable.tsx', 'export const T = () => <table><tbody /></table>')
    expect(m).toEqual([])
  })
})

describe('token parity (U01)', () => {
  const index = readFileSync(path.join(root, 'src/index.css'), 'utf8')
  const tailwind = readFileSync(path.join(root, 'tailwind.config.ts'), 'utf8')

  const run = (indexCss: string, tailwindTs: string = tailwind) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'parity-'))
    const idx = path.join(dir, 'index.css')
    const tw = path.join(dir, 'tailwind.config.ts')
    writeFileSync(idx, indexCss)
    writeFileSync(tw, tailwindTs)
    return spawnSync('node', [script, path.join(root, 'docs/design/tokens.css'), idx, tw], { encoding: 'utf8' })
  }

  it('passes on the committed files', () => {
    const r = spawnSync('node', [script], { cwd: root, encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
  })

  it('fails when a token value is changed in index.css', () => {
    const r = run(index.replace('--primary: #1a7b46;', '--primary: #1a7b47;'))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('--primary')
  })

  it('fails when a token is removed or invented', () => {
    expect(run(index.replace('--radius: 4px;', '')).status).toBe(1)
    expect(run(index.replace('--radius: 4px;', '--radius: 4px; --extra: 1px;')).status).toBe(1)
  })

  it('fails when a status-map rule differs', () => {
    expect(run(index.replace('[data-status="goods:late"],', '')).status).toBe(1)
  })

  it('fails when tailwind.config.ts hard-codes a colour', () => {
    const r = run(index, tailwind.replace("transparent: 'transparent'", "transparent: '#123456'"))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('hard-codes a colour')
  })
})
