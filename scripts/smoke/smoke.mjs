// S16: remote smoke suite against the LIVE Q-Tech CRM v2 Supabase project. READ-ONLY.
//
// Part 1 (needs no secret): reachability pre-flight, then anonymous denial on every public table, view and RPC.
//   The object list is generated from src/types/database.ts, so it cannot fall behind the schema.
//   Uses only the PUBLIC anon key (it ships in every browser bundle).
// Part 2 (needs the A05 test accounts): three-role read checks. Skipped, with a notice, when the credentials are absent.
//
// Env:
//   SMOKE_SUPABASE_URL        optional; must be the new project's URL (default below)
//   SMOKE_SUPABASE_ANON_KEY   optional public anon key. If absent it is read from the deployed app's public bundle
//                             (SMOKE_APP_URL, default https://qtechcrm.vercel.app), where the app itself gets it.
//   SMOKE_MISSING             fail (default) | warn. What to do with an object the types name but the live project lacks
//                             (live is behind main: a migration is not pushed yet). Every other problem always fails.
//   SMOKE_{ADMIN,SALES,ENGINEER}_{EMAIL,PASSWORD}   Part 2 test accounts (secrets)
// Never put a service-role key anywhere near this: it is refused if one is found.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPublicObjects } from './objects.mjs'
import { mayRead } from './expectations.mjs'

const NEW_REF = 'yafbphagorydbitfgfmg'
const OLD_REF = 'vptyhluvgnjpvkcbhxsf'
const here = path.dirname(fileURLToPath(import.meta.url))
const GAP_ID = '00000000-0000-0000-0000-000000000000'

const failures = []
const lines = []
function log(s) {
  console.log(s)
  lines.push(s)
}
function fail(title, detail) {
  failures.push({ title, detail })
  console.log(`::error title=Smoke FAILED - ${title}::${detail}`)
  lines.push(`FAIL ${title}: ${detail}`)
}

function die(title, detail) {
  fail(title, detail)
  finish()
}

function finish() {
  const summary = process.env.GITHUB_STEP_SUMMARY
  const head = failures.length ? `## Smoke FAILED (${failures.length})\n` : '## Smoke passed\n'
  if (summary) fs.appendFileSync(summary, head + '\n```\n' + lines.join('\n') + '\n```\n')
  process.exit(failures.length ? 1 : 0)
}

// ---- configuration guard ---------------------------------------------------------------------------------------
const baseUrl = (process.env.SMOKE_SUPABASE_URL || `https://${NEW_REF}.supabase.co`).replace(/\/+$/, '')
if (baseUrl.includes(OLD_REF)) die('wrong project', 'Refusing: the URL is the OLD CRM project.')
if (baseUrl !== `https://${NEW_REF}.supabase.co`) die('wrong project', 'Refusing: the URL is not the Q-Tech CRM v2 project.')

function jwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

async function http(url, init = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000), ...init })
    const text = await res.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      /* not JSON */
    }
    return { status: res.status, body, text }
  } catch (e) {
    return { status: 0, body: null, text: '', error: String(e?.cause?.code || e?.message || e) }
  }
}

// ---- the public anon key ---------------------------------------------------------------------------------------
async function resolveAnonKey() {
  const given = (process.env.SMOKE_SUPABASE_ANON_KEY || '').trim()
  const candidates = []
  if (given) candidates.push(given)
  else {
    const app = (process.env.SMOKE_APP_URL || 'https://qtechcrm.vercel.app').replace(/\/+$/, '')
    const page = await http(app + '/')
    if (page.status !== 200) {
      die('anon key unavailable', `Could not load ${app}/ (status ${page.status} ${page.error ?? ''}) and SMOKE_SUPABASE_ANON_KEY is not set.`)
    }
    const assets = [...new Set([...page.text.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]))]
    for (const a of assets) {
      const js = await http(app + a)
      for (const m of js.text.matchAll(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g)) candidates.push(m[0])
    }
  }
  let anon = null
  for (const t of candidates) {
    const p = jwtPayload(t)
    if (!p) continue
    if (p.role === 'service_role') {
      die('SERVICE-ROLE KEY EXPOSED', 'A service_role key was found where only the public anon key may be. Rotate it NOW (Dashboard, Project Settings, API).')
    }
    if (p.role === 'anon' && p.ref === NEW_REF) anon = t
  }
  if (!anon) die('anon key unavailable', `No anon key for ${NEW_REF} found. Set the repository variable SMOKE_SUPABASE_ANON_KEY (the public anon key).`)
  return anon
}

const anonKey = await resolveAnonKey()
const H = (token) => ({ apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': 'application/json' })
const objs = listPublicObjects(path.resolve(here, '../../src/types/database.ts'))
log(`objects from types: ${objs.tables.length} tables, ${objs.views.length} views, ${objs.functions.length} RPCs`)

// ---- pre-flight: an unreachable project must FAIL --------------------------------------------------------------
{
  const h = await http(`${baseUrl}/auth/v1/health`, { headers: { apikey: anonKey } })
  if (h.status !== 200) {
    die('project UNREACHABLE', `GET /auth/v1/health returned ${h.status} ${h.error ?? h.text.slice(0, 120)}. A paused or wrong project proves nothing, so this fails.`)
  }
  const r = await http(`${baseUrl}/rest/v1/users?select=id&limit=1`, { headers: H() })
  if (r.status === 0 || r.status >= 500 || !r.body || typeof r.body !== 'object') {
    die('project UNREACHABLE', `PostgREST did not answer with JSON (status ${r.status} ${r.error ?? r.text.slice(0, 120)}).`)
  }
  log('pre-flight: auth and PostgREST reachable')
}

// ---- Part 1: anonymous denial ----------------------------------------------------------------------------------
function isDenied(r) {
  return (
    (r.status === 401 || r.status === 403) &&
    r.body &&
    (r.body.code === '42501' || /permission denied/i.test(String(r.body.message)))
  )
}
function describe(r) {
  return `status ${r.status} ${r.error ?? JSON.stringify(r.body ?? r.text).slice(0, 140)}`
}

async function pool(items, n, fn) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (let it; (it = queue.shift()); ) await fn(it)
    }),
  )
}

const anonChecks = [
  ...[...objs.tables, ...objs.views].map((name) => ({
    label: `anon SELECT ${name}`,
    run: () => http(`${baseUrl}/rest/v1/${name}?select=*&limit=1`, { headers: H() }),
  })),
  ...objs.functions.map((f) => ({
    label: `anon EXECUTE ${f.name}()`,
    // every parameter is sent as null: Postgres refuses on the EXECUTE privilege before the body runs.
    run: () =>
      http(`${baseUrl}/rest/v1/rpc/${f.name}`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify(Object.fromEntries(f.args.map((a) => [a, null]))),
      }),
  })),
  {
    label: 'anon UPDATE users.role (impossible id)',
    run: () => http(`${baseUrl}/rest/v1/users?id=eq.${GAP_ID}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ role: 'admin' }) }),
  },
  {
    label: 'anon DELETE orders (impossible id)',
    run: () => http(`${baseUrl}/rest/v1/orders?id=eq.${GAP_ID}`, { method: 'DELETE', headers: H() }),
  },
]
let denied = 0
let missing = 0
await pool(anonChecks, 6, async (c) => {
  const r = await c.run()
  if (isDenied(r)) {
    denied++
    return
  }
  if (r.status === 0 || r.status >= 500) fail('project UNREACHABLE mid-run', `${c.label}: ${describe(r)}`)
  else if (r.status === 404) {
    const msg = `${c.label}: ${describe(r)} (types and live schema disagree: is a migration not pushed yet?)`
    if (process.env.SMOKE_MISSING === 'warn') {
      missing++
      console.log(`::warning title=Smoke - object missing on the live project::${msg}`)
      lines.push(`WARN missing: ${msg}`)
    } else fail('object missing on the live project', msg)
  }
  else if (r.status >= 200 && r.status < 300) fail('ANONYMOUS ACCESS NOT DENIED', `${c.label}: anon was allowed (${describe(r)})`)
  else fail('unexpected anon response', `${c.label}: ${describe(r)}`)
})
log(
  `Part 1: ${denied}/${anonChecks.length} anonymous checks denied as required` +
    (missing ? `, ${missing} objects missing on the live project (warned)` : ''),
)

// ---- Part 2: three-role read checks ----------------------------------------------------------------------------
const ROLES = ['admin', 'sales', 'engineer']
const creds = ROLES.map((role) => ({
  role,
  email: process.env[`SMOKE_${role.toUpperCase()}_EMAIL`] || '',
  password: process.env[`SMOKE_${role.toUpperCase()}_PASSWORD`] || '',
}))
const ready = creds.filter((c) => c.email && c.password)
if (!ready.length) {
  console.log('::notice title=Smoke Part 2 skipped::No SMOKE_*_EMAIL/PASSWORD secrets (task A05). Part 1 ran. See docs/SUPABASE.md, "Smoke test accounts".')
  log('Part 2: SKIPPED (no test-account credentials). Part 1 only.')
} else {
  for (const c of creds.filter((x) => !(x.email && x.password))) log(`Part 2: ${c.role} SKIPPED (credentials not set)`)
  const unclassified = new Set()
  for (const c of ready) {
    console.log(`::add-mask::${c.password}`)
    const tok = await http(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: c.email, password: c.password }),
    })
    if (tok.status !== 200 || !tok.body?.access_token) {
      fail(`${c.role} sign-in`, `Could not sign in the ${c.role} test account (status ${tok.status}). Check the secrets and that the account is active.`)
      continue
    }
    const jwt = tok.body.access_token
    const me = await http(`${baseUrl}/rest/v1/users?select=role&id=eq.${tok.body.user.id}`, { headers: H(jwt) })
    if (me.body?.[0]?.role !== c.role) {
      fail(`${c.role} account has the wrong role`, `The ${c.role} test account reads back role "${me.body?.[0]?.role}".`)
      continue
    }
    let ok = 0
    let n = 0
    await pool([...objs.tables, ...objs.views], 6, async (name) => {
      const expected = mayRead(c.role, name)
      if (expected === null) {
        unclassified.add(name)
        return
      }
      n++
      const r = await http(`${baseUrl}/rest/v1/${name}?select=*&limit=1`, { headers: H(jwt) })
      if (r.status === 0 || r.status >= 500) return fail('project UNREACHABLE mid-run', `${c.role} ${name}: ${describe(r)}`)
      if (expected) {
        if (r.status === 200 && Array.isArray(r.body)) ok++
        else fail(`${c.role} lost read access`, `${c.role} could not read ${name}: ${describe(r)}`)
      } else if (isDenied(r) || (r.status === 200 && Array.isArray(r.body) && r.body.length === 0)) ok++
      else fail(`${c.role} sees data it must not`, `${c.role} reading ${name}: ${describe(r)}`)
    })
    log(`Part 2: ${c.role} ${ok}/${n} read checks as expected`)
  }
  if (unclassified.size) log(`Part 2: not classified (Part 1 only): ${[...unclassified].sort().join(', ')}`)
}

finish()
