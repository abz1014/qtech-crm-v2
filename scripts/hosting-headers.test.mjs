// Fails if vercel.json (primary host) and public/_headers (Cloudflare fallback) drift apart.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { resolve } from 'node:path'
const root = process.cwd()
const read = (p) => readFileSync(resolve(root, p), 'utf8')

// Parse _headers into { '/*': {Name: value}, '/assets/*': {...} }
function parseHeadersFile(text) {
  const out = {}
  let cur = null
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    if (!/^\s/.test(raw)) {
      cur = raw.trim()
      out[cur] = {}
    } else {
      const i = raw.indexOf(':')
      out[cur][raw.slice(0, i).trim()] = raw.slice(i + 1).trim()
    }
  }
  return out
}

// Vercel path-to-regexp style source -> _headers style pattern
const toPattern = (s) => s.replace('/(.*)', '/*').replace(/\/\(\.\*\)$/, '/*')

function vercelHeaders(json) {
  const out = {}
  for (const rule of json.headers) {
    const key = toPattern(rule.source)
    out[key] = Object.fromEntries(rule.headers.map((h) => [h.key, h.value]))
  }
  return out
}

describe('hosting headers parity', () => {
  const cf = parseHeadersFile(read('public/_headers'))
  const json = JSON.parse(read('vercel.json'))
  const vc = vercelHeaders(json)

  it('has identical header values for every path pattern', () => {
    expect(vc).toEqual(cf)
  })

  it('pins the CSP to the Supabase project, with wss on the same host', () => {
    const csp = vc['/*']['Content-Security-Policy']
    expect(csp).toContain('https://yafbphagorydbitfgfmg.supabase.co')
    expect(csp).toContain('wss://yafbphagorydbitfgfmg.supabase.co')
    expect(csp).not.toContain('*.supabase.co')
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('caches /assets/* long and rewrites every path to index.html', () => {
    expect(vc['/assets/*']['Cache-Control']).toContain('immutable')
    expect(json.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' })
  })
})
