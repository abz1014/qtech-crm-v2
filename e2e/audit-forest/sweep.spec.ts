import { test, type Page } from '@playwright/test'
import { axe, engineerMoney, focusSweep, inspect, type Raw } from './checks'
import { bounded, coarse, combo, contextAs, fullShot, isPhone, makeEmpty, makeError, makeLoading, record, rel, settle, shotPath, spaGo, waitAnimations, writeFirewall, type State, type TextSize, type Where } from './lib'
import { AUDIT_ROUTES, at, WIDE, WIDTHS, type AuditRoute, type Role, type Width } from './routes'
import { ensureSeed, fillPath, type AuditSeed } from './seed'

/*
 * The Forest final audit (project / suite key "forest-audit"): every screen of routes.ts, for every role that may open it, at 320, 375,
 * 768, 1024 and 1440 (1920 for wide tables), Smaller and Larger text at 375 and 1440, and the empty, loading, error and long-text
 * states at 375 and 1440 (long text also at 320 and 768), plus every dialog, sheet and menu one click away (375 and 1440; 320 for the
 * admin) and the command palette at every width. Each view is checked by checks.ts (layout, clipping, overlap, touch size, input size,
 * axe WCAG 2.1 AA + best practice, rendered-HTML validity, focus visibility, console errors, and money on an engineer's screen) and
 * photographed into test-results/forest-audit/<route>/<role>-<w>-<text>-<state>.png.
 *
 * It never fails on a finding: findings go to test-results/forest-audit/findings/*.jsonl (merged by scripts/audit/forest-merge.mjs into
 * findings.json and summary.json). A test fails only when the harness itself breaks. Tests are independent, so CI splits them
 * over shards (.github/e2e-suites.yml "shards=N"), each shard with its own stack and its own seed.
 */
test.describe.configure({ mode: 'parallel' })

let seed: AuditSeed
test.beforeAll(async () => {
  test.setTimeout(900_000)
  seed = await ensureSeed()
})

const PHONE_DESK = [at(375), at(1440)]

interface ViewOpts {
  scope?: string | null
  full?: boolean
  focus?: boolean
  focusCount?: number
  axe?: boolean
}

class Console {
  lines: Raw[] = []
  constructor(page: Page, state: () => State) {
    page.on('console', m => {
      const t = m.text()
      const s = state()
      if (m.type() === 'error') {
        if ((s === 'error' || s === 'loading' || s === 'empty' || s.startsWith('dialog')) && /Failed to load resource|net::ERR|ERR_FAILED|blockedbyclient|TypeError: Failed to fetch|FetchError|406/.test(t)) return
        // the write firewall's own refusals (writeFirewall)
        if (/ERR_BLOCKED_BY_CLIENT/.test(t)) return
        this.lines.push({ rule: /Warning:|React|validateDOMNesting|Each child in a list/.test(t) ? 'react-warning' : 'console-error', selector: 'console', detail: t.slice(0, 400) })
      } else if (m.type() === 'warning' && /Warning:|React|validateDOMNesting|Each child in a list|aria|DialogContent|Description/.test(t)) {
        this.lines.push({ rule: 'react-warning', selector: 'console', detail: t.slice(0, 400) })
      }
    })
    page.on('pageerror', e => this.lines.push({ rule: 'page-error', selector: 'window', detail: `${e.name}: ${e.message}`.slice(0, 400) }))
  }
  take(): Raw[] {
    const l = this.lines
    this.lines = []
    return l
  }
}

/** Marks the open modal dialog (or menu / popover) and returns a selector for it, or null when none is open. */
async function openOverlay(page: Page): Promise<string | null> {
  const found = await page.evaluate(() => {
    document.querySelectorAll('[data-audit-scope]').forEach(e => e.removeAttribute('data-audit-scope'))
    const cands = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper] > *')).filter(e => {
      const r = e.getBoundingClientRect()
      return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden'
    })
    const d = cands[cands.length - 1]
    if (!d) return null
    d.setAttribute('data-audit-scope', '1')
    return d.getAttribute('role') ?? 'popover'
  })
  return found ? '[data-audit-scope]' : null
}

async function pageKind(page: Page): Promise<'ok' | 'not-found' | 'no-access' | 'signed-out' | 'crashed'> {
  const h = (await page.locator('h1').allInnerTexts().catch(() => [])).join(' ')
  const main = await page.locator('#main').innerText({ timeout: 2_000 }).catch(() => '')
  if (/page stopped working|something went wrong/i.test(main)) return 'crashed'
  if (/not found|doesn.t exist|no such/i.test(h)) return 'not-found'
  if (/no access|not for your role|can.t open|is for admins?\b|for admin and sales|Your role is/i.test(`${h} ${main.slice(0, 300)}`)) return 'no-access'
  if (page.url().includes('/login')) return 'signed-out'
  return 'ok'
}

function put(where: Where, list: Raw[], url: string, shot: string): void {
  for (const r of list) record({ ...where, ...r, url, shot })
}

/** One view: picture(s), then the rules. */
async function audit(page: Page, where: Where, con: Console, o: ViewOpts = {}): Promise<void> {
  const url = page.url().replace(/^https?:\/\/[^/]+/, '')
  const scope = o.scope === undefined ? await openOverlay(page).then(s => (s ? s : null)) : o.scope
  const scoped = scope
  const shot = shotPath(where)
  await page.screenshot({ path: shot, timeout: 15_000, animations: 'disabled', caret: 'hide' }).catch(e => put(where, [{ rule: 'harness', selector: '', detail: `screenshot: ${String(e).slice(0, 200)}` }], url, ''))
  if (o.full) await fullShot(page, shotPath(where, '-full')).catch(() => undefined)
  const found: Raw[] = []
  if (isPhone(where.width) && !(await page.evaluate(() => matchMedia('(pointer: coarse)').matches).catch(() => true)))
    found.push({ rule: 'harness', selector: 'html', detail: 'phone page without (pointer: coarse): touch sizes are the desktop ones' })
  const step = async (name: string, ms: number, fn: () => Promise<Raw[]>) => {
    try {
      found.push(...(await bounded(ms, fn)))
    } catch (e) {
      found.push({ rule: 'harness', selector: '', detail: `${name}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200)}` })
    }
  }
  await step('inspect', 20_000, () => page.evaluate(inspect, { phone: isPhone(where.width), scope: scoped }))
  if (o.axe !== false) await step('axe', 30_000, () => axe(page, scoped))
  if (where.role === 'engineer') await step('engineer', 5_000, () => engineerMoney(page, seed.secrets))
  if (o.focus) await step('focus', 30_000, () => focusSweep(page, o.focusCount ?? 15, scoped))
  found.push(...con.take())
  put(where, found, url, rel(shot))
  combo(where, rel(shot), { url, findings: found.length })
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await settle(page)
}

/** Clicks every closed fold in <main> (up to 14): the content a person opens, measured open. */
async function expandAll(page: Page): Promise<number> {
  let n = 0
  for (; n < 14; n++) {
    const b = page.locator('#main button[aria-expanded="false"]:not([aria-haspopup]):not([data-audit-tried]):not([data-infotip] *):not([data-infotip])').filter({ visible: true }).first()
    if (!(await b.count())) break
    // marked first, so a fold that does not open (or re-renders closed) is tried once, not forever; a data attribute leaves aria alone
    await b.evaluate(e => e.setAttribute('data-audit-tried', '')).catch(() => undefined)
    await b.click({ timeout: 3_000 }).catch(() => undefined)
    await page.waitForTimeout(400)
  }
  await settle(page)
  return n
}

const OPENER =
  /^(New|Add|Create|Edit|Delete|Remove|Record|Issue|Send|Mark|Pay|Merge|Lock|Reopen|Close (the )?month|Change|Enter|Log|Ask|Statement|Deactivate|Reactivate|Repeat|Split|Invite|Rename|Cancel (the )?(job|order|invoice)|More|Actions|Filters?|Filter|Sort|Show details|History|Search|Export|Upload|Attach|Import|Set|Choose|Pick|Help|Account|Your account|Menu|Open menu|Capture|Photo|Camera|I paid|Write|Make|Approve|Reject|Reply|Paste|Find|Compare|Chase|Follow up|Visit|Challan|Commission)\b/i
const SKIP = /^(Close|Cancel|Back|Done|Save|Sign in|Sign out|Log out|Skip|Dismiss|Undo|Next|Previous|Show password|Hide password)$/i
const MENU_ITEM = /^(Edit|Delete|Remove|History|Deactivate|Reactivate|Merge|Rename|Record|Pay|Cancel|Reopen|Split|Repeat|Add|Statement|Change|Move|Mark|Reset|Export|Issue|Send)/i

/** Normalised opener names on the page (one per kind: "More for <row>" once), marked data-audit-opener="<name>". */
async function markOpeners(page: Page, shell: boolean): Promise<string[]> {
  return page.evaluate(
    ({ shell, opener, skip }) => {
      const reO = new RegExp(opener, 'i')
      const reS = new RegExp(skip, 'i')
      document.querySelectorAll('[data-audit-opener]').forEach(e => e.removeAttribute('data-audit-opener'))
      const roots = [document.getElementById('main'), ...(shell ? Array.from(document.querySelectorAll('header, nav, [role="banner"], aside')) : [])].filter(Boolean) as Element[]
      const seen: string[] = []
      for (const root of roots) {
        for (const b of Array.from(root.querySelectorAll('button, [role="button"]'))) {
          const r = b.getBoundingClientRect()
          if (r.width < 2 || r.height < 2 || (b as HTMLButtonElement).disabled || b.closest('[role="dialog"], [inert]')) continue
          if (b.hasAttribute('aria-expanded') && !b.hasAttribute('aria-haspopup') && !/filter|sort/i.test(b.textContent ?? '')) continue
          const name = (b.getAttribute('aria-label') || (b as HTMLElement).innerText || b.getAttribute('title') || '').replace(/\s+/g, ' ').trim()
          if (!name || reS.test(name) || !reO.test(name)) continue
          const norm = name.replace(/,.*$/, '').replace(/\s+(for|of|on|to)\s.*$/i, '').replace(/\s+\d.*$/, '').slice(0, 40)
          if (seen.includes(norm)) continue
          seen.push(norm)
          b.setAttribute('data-audit-opener', norm)
        }
      }
      return seen.slice(0, 14)
    },
    { shell, opener: OPENER.source, skip: SKIP.source },
  )
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)

async function discoverOpeners(page: Page, path: string, base: Where, con: Console, shell: boolean): Promise<void> {
  await writeFirewall(page)
  await open(page, path)
  const names = await markOpeners(page, shell)
  const reset = async () => {
    const overlay = await page.locator('[role="dialog"], [role="alertdialog"], [role="menu"]').filter({ visible: true }).count()
    if (overlay || page.url().replace(/^https?:\/\/[^/]+/, '') !== path) await open(page, path)
    await markOpeners(page, shell)
  }
  const click = async (name: string) => {
    await page.locator(`[data-audit-opener="${name.replace(/"/g, '\\"')}"]`).first().click({ timeout: 4_000 })
    await page.waitForTimeout(500)
    await settle(page)
  }
  for (const name of names) {
    try {
      await bounded(60_000, async () => {
        await reset()
        const before = page.url()
        await click(name)
        const scope = await openOverlay(page)
        if (!scope) {
          if (page.url() !== before) combo({ ...base, state: `dialog-${slug(name)}` }, '', { navigated: page.url() })
          return
        }
        const role = await page.locator(scope).getAttribute('role').catch(() => null)
        await audit(page, { ...base, state: `dialog-${slug(name)}` }, con, { scope, focus: role === 'dialog' || role === 'alertdialog', focusCount: 10 })
        if (role !== 'menu') return
        const items = (await page.locator(`${scope} [role="menuitem"]`).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).filter(t => MENU_ITEM.test(t)).slice(0, 5)
        for (const item of items) {
          await page.keyboard.press('Escape').catch(() => undefined)
          await reset()
          await click(name)
          await page.getByRole('menuitem', { name: item, exact: true }).first().click({ timeout: 4_000 })
          await page.waitForTimeout(500)
          await settle(page)
          const s2 = await openOverlay(page)
          if (!s2) continue
          const r2 = await page.locator(s2).getAttribute('role').catch(() => null)
          if (r2 === 'menu') continue
          await audit(page, { ...base, state: `dialog-${slug(name)}-${slug(item)}` }, con, { scope: s2, focus: true, focusCount: 10 })
        }
      })
    } catch (e) {
      record({ ...base, state: `dialog-${slug(name)}`, rule: 'harness', selector: name, detail: `opener: ${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200)}` })
    } finally {
      await page.keyboard.press('Escape').catch(() => undefined)
    }
  }
}

type Group = 'widths' | 'text' | 'states' | 'long' | 'openers'

function groupsFor(r: AuditRoute, role: Role): Group[] {
  const g: Group[] = ['widths']
  if (!r.light) g.push('text')
  if (!r.light && !r.dialog && !r.noStates && role !== 'anon') g.push('states')
  if (r.long) g.push('long')
  if (!r.light && !r.dialog && role !== 'anon') g.push('openers')
  return g
}

for (const r of AUDIT_ROUTES) {
  for (const role of r.roles) {
    for (const group of groupsFor(r, role)) {
      test(`${r.id} ${role} ${group}`, async ({ browser }, info) => {
        test.setTimeout(group === 'openers' ? 600_000 : 360_000)
        const path = fillPath(r.path, seed, false)
        if (!path) {
          record({ route: r.id, path: r.path, role, width: 0, text: 'normal', state: 'ok', rule: 'harness', selector: '', detail: `no record for ${r.path} (fx seed: ${seed.fxError ?? 'ok'})` })
          return
        }
        // Sell is for admin and sales: an engineer gets the lane's own "Sell is for admin and sales" page
        const expectPage = r.id === 'not-found' || r.id === 'job-missing' ? 'not-found' : r.id === 'no-access' || (r.id === 'jobs-sell' && role === 'engineer') ? 'no-access' : 'ok'
        const view = async (v: Width, text: TextSize, state: State, body: (page: Page, where: Where, con: Console) => Promise<void>) => {
          const context = await contextAs(browser, info, role, v, text)
          const page = await context.newPage()
          if (isPhone(v.w)) await coarse(page)
          let cur: State = state
          const con = new Console(page, () => cur)
          const where: Where = { route: r.id, path: r.path, role, width: v.w, text, state }
          try {
            await body(page, where, con)
          } catch (e) {
            record({ ...where, rule: 'harness', selector: '', detail: (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300) })
          } finally {
            cur = 'ok'
            await context.close().catch(() => undefined)
          }
        }
        const checkKind = async (page: Page, where: Where) => {
          if (r.dialog || role === 'anon') return
          const kind = await pageKind(page)
          if (kind !== expectPage) record({ ...where, rule: 'wrong-page', selector: 'h1', detail: `expected ${expectPage}, got ${kind} at ${page.url().replace(/^https?:\/\/[^/]+/, '')}` })
        }

        if (group === 'widths') {
          for (const v of r.wide ? [...WIDTHS, WIDE] : WIDTHS) {
            await view(v, 'normal', 'ok', async (page, where, con) => {
              await open(page, path)
              if (r.dialog) await page.locator('[role="dialog"], [role="alertdialog"], aside').filter({ visible: true }).first().waitFor({ timeout: 10_000 }).catch(() => record({ ...where, rule: 'dialog-not-open', selector: '', detail: `${path} did not open a dialog` }))
              await settle(page)
              await checkKind(page, where)
              await audit(page, where, con, { full: v.w === 375 || v.w === 1440, focus: true })
              if (!r.dialog && !r.light && (v.w === 375 || v.w === 1440) && role !== 'anon') {
                const n = await expandAll(page)
                if (n > 0) await audit(page, { ...where, state: 'expanded' }, con, { full: true, focus: false })
              }
            })
          }
        } else if (group === 'text') {
          for (const v of PHONE_DESK) {
            for (const text of ['small', 'large'] as const) {
              await view(v, text, 'ok', async (page, where, con) => {
                await open(page, path)
                await page.waitForFunction(t => document.documentElement.dataset.text === t, text, { timeout: 5_000 }).catch(() => record({ ...where, rule: 'harness', selector: 'html', detail: `text size ${text} not applied` }))
                await audit(page, where, con, { full: true, focus: false })
              })
            }
          }
        } else if (group === 'states') {
          for (const v of PHONE_DESK) {
            for (const state of ['empty', 'loading', 'error'] as const) {
              await view(v, 'normal', state, async (page, where, con) => {
                // the shell loads as normal; the screen's own data is then refused, emptied or held, and the screen opened by a tap
                await open(page, path.startsWith('/todo') ? '/settings/password' : '/todo')
                let release: () => void = () => undefined
                if (state === 'empty') await makeEmpty(page)
                if (state === 'error') await makeError(page)
                // Home and Weekly review show the Today read the shell's nav counts made a moment ago (features/today/hooks.ts
                // JUST_READ_MS, 10 s): opened at once they rightly make no request, so nothing of theirs failed. Wait the window out,
                // so the screen reads again and its error state is what is measured (L5, audit round 1 false positive).
                if (state === 'error' && path.startsWith('/todo')) await page.waitForTimeout(10_500)
                if (state === 'loading') release = await makeLoading(page)
                await spaGo(page, path)
                if (state === 'loading') await page.waitForTimeout(1_200)
                else if (state === 'error')
                  await page
                    .waitForFunction(() => /could not|couldn.t|try again|went wrong|no connection|offline|failed|did not load/i.test(document.getElementById('main')?.innerText ?? ''), undefined, { timeout: 20_000 })
                    .catch(() => record({ ...where, rule: 'error-state-silent', selector: '#main', detail: 'every data request failed and after 20 s the screen says nothing about it (no "could not", "try again"): a skeleton or a blank page' }))
                else await settle(page)
                await waitAnimations(page)
                await audit(page, where, con, { full: false, focus: false })
                release()
              })
            }
          }
        } else if (group === 'long') {
          const lpath = fillPath(r.path, seed, true)
          if (!lpath) return
          for (const v of [at(320), at(375), at(768), at(1440)]) {
            await view(v, 'normal', 'long', async (page, where, con) => {
              await open(page, lpath)
              await checkKind(page, where)
              await audit(page, where, con, { full: v.w === 375 || v.w === 1440, focus: false })
              if (/^\/(jobs|companies)\/./.test(lpath)) {
                const n = await expandAll(page)
                if (n > 0) await audit(page, { ...where, state: 'long-expanded' }, con, { full: true, focus: false })
              }
            })
          }
        } else if (group === 'openers') {
          const widths = role === 'admin' ? [at(320), ...PHONE_DESK] : PHONE_DESK
          for (const v of widths) {
            await view(v, 'normal', 'ok', async (page, where, con) => {
              await discoverOpeners(page, path, where, con, !!r.shell)
              if (r.shell) {
                // the command palette, its results
                await open(page, path)
                await page.keyboard.press('Control+k')
                const s = await page.locator('[role="dialog"]').first().waitFor({ timeout: 5_000 }).then(() => true, () => false)
                if (!s) {
                  record({ ...where, state: 'dialog-palette', rule: 'harness', selector: '', detail: 'Ctrl+K did not open the palette' })
                  return
                }
                await settle(page)
                await audit(page, { ...where, state: 'dialog-palette' }, con, { focus: true, focusCount: 8 })
                await page.keyboard.type(seed.world.tag.slice(0, 4))
                await page.waitForTimeout(900)
                await settle(page)
                await audit(page, { ...where, state: 'dialog-palette-results' }, con, { focus: false })
              }
            })
          }
        }
      })
    }
  }
}

// The palette at the widths the openers pass does not cover (320 for sales and engineer, 768, 1024, 1920).
for (const role of ['admin', 'sales', 'engineer'] as const) {
  test(`palette ${role} widths`, async ({ browser }, info) => {
    test.setTimeout(240_000)
    for (const v of [at(320), at(768), at(1024), WIDE]) {
      const context = await contextAs(browser, info, role, v, 'normal')
      const page = await context.newPage()
      if (isPhone(v.w)) await coarse(page)
      const con = new Console(page, () => 'ok')
      const where: Where = { route: 'palette', path: '/todo (Ctrl+K)', role, width: v.w, text: 'normal', state: 'dialog-palette' }
      try {
        await open(page, '/todo')
        await page.keyboard.press('Control+k')
        await page.locator('[role="dialog"]').first().waitFor({ timeout: 5_000 })
        await settle(page)
        await audit(page, where, con, { focus: true, focusCount: 8 })
        await page.keyboard.type(seed.world.tag.slice(0, 4))
        await page.waitForTimeout(900)
        await settle(page)
        await audit(page, { ...where, state: 'dialog-palette-results' }, con, { focus: false })
      } catch (e) {
        record({ ...where, rule: 'harness', selector: '', detail: (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300) })
      } finally {
        await context.close().catch(() => undefined)
      }
    }
  })
}
