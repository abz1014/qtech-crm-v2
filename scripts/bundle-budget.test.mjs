import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasSupabaseClient, initialJs, staticJsRefs } from './bundle-budget.lib.mjs'

describe('bundle budget helpers', () => {
  it('reads script and modulepreload refs from the html', () => {
    const html = '<script type="module" crossorigin src="/assets/index-A.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-B.js">'
    expect(staticJsRefs(html, { html: true }).sort()).toEqual(['/assets/index-A.js', '/assets/vendor-B.js'])
  })

  it('follows static imports and ignores dynamic ones', () => {
    const js = 'import{a as b}from"./vendor-B.js";import"./side-C.js";const l=()=>import("./lazy-D.js");export{b}'
    expect(staticJsRefs(js).sort()).toEqual(['./side-C.js', './vendor-B.js'])
  })

  it('sums the initial files of a built dist', () => {
    const dist = mkdtempSync(join(tmpdir(), 'budget-'))
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/index-A.js"></script>')
    writeFileSync(join(dist, 'assets', 'index-A.js'), 'import"./vendor-B.js";import("./lazy-D.js");' + 'x'.repeat(1000))
    writeFileSync(join(dist, 'assets', 'vendor-B.js'), 'y'.repeat(500))
    writeFileSync(join(dist, 'assets', 'lazy-D.js'), 'z'.repeat(5000))
    const r = initialJs(dist)
    expect([...r.files.keys()].sort()).toEqual(['assets/index-A.js', 'assets/vendor-B.js'])
  })

  it('refuses a build without the Supabase client (built without VITE_SUPABASE_*, it under-measures production)', () => {
    const build = withClient => {
      const dist = mkdtempSync(join(tmpdir(), 'budget-'))
      mkdirSync(join(dist, 'assets'))
      writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/index-A.js"></script>')
      writeFileSync(join(dist, 'assets', 'index-A.js'), 'import"./vendor-B.js";')
      writeFileSync(join(dist, 'assets', 'vendor-B.js'), withClient ? 'const a=new URL("auth/v1",b);' : 'const getSupabase=()=>null;')
      return dist
    }
    const withIt = build(true)
    const without = build(false)
    expect(hasSupabaseClient(withIt, initialJs(withIt))).toBe(true)
    expect(hasSupabaseClient(without, initialJs(without))).toBe(false)
  })
})
