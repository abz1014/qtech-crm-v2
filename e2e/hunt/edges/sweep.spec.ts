import { test } from '@playwright/test'
import { fill, seedWorld, type World } from '../../verify-roles/fixtures'
import { ROUTES } from '../../verify-roles/routes'
import { contextAs, layout, recordLayout, settle, shot, VIEWPORTS, Watcher } from './lib'

/*
 * Exploration sweep: every route the app answers (e2e/verify-roles/routes.ts, the one list of routes), as admin, sales and engineer,
 * at 1920x1080, 1366x768, 768x1024, 375x812, 320x640 and 200% zoom. Each stop records console errors, page errors, 4xx/5xx,
 * sideways scroll, controls past the edge, cut-off text, text under 12px and phone targets under 24px, and keeps a screenshot.
 * It never fails on a finding (that is what findings.jsonl is for); the confirmed bugs are pinned in bugs.spec.ts.
 */
let world: World
test.beforeAll(async () => {
  world = await seedWorld('HE')
})

const FULL = new Set(['w1366', 'w375', 'w320'])
const KEY = new Set(['/today', '/rfqs', '/rfqs/new', '/rfqs/{rfq}', '/orders', '/orders/{order}', '/companies', '/companies/{company}', '/companies/{supplier}', '/money', '/money/gst-register', '/money/receivables', '/money/expenses', '/money/month-end', '/money/margins', '/money/reports', '/settings', '/settings/team', '/settings/targets', '/settings/exchange-rates', '/settings/company'])

for (const v of VIEWPORTS) {
  for (const role of ['admin', 'sales', 'engineer'] as const) {
    test(`sweep ${role} @ ${v.key}`, async ({ browser }, info) => {
      test.setTimeout(900_000)
      const context = await contextAs(browser, info, role, v)
      const page = await context.newPage()
      const w = new Watcher(page, { role, vp: v.key })
      const routes = ROUTES.filter(r => r[role] !== 'no' && (FULL.has(v.key) || KEY.has(r.path)))
      for (const r of routes) {
        const path = fill(r.path, world)
        w.at(r.path)
        const t0 = Date.now()
        await page.goto(path).catch(e => w.add('goto', String(e).slice(0, 200)))
        await page.locator('#main').waitFor({ timeout: 15_000 }).catch(() => w.add('no-shell', 'the shell (#main) never appeared'))
        await settle(page)
        const ms = Date.now() - t0
        if (ms > 6000) w.add('slow', `${ms} ms to settle`)
        const h1 = (await page.locator('h1').allInnerTexts().catch(() => [])).join(' | ')
        const main = await page.locator('#main').innerText().catch(() => '')
        if (/Something went wrong|Couldn.t load|could not load/i.test(main)) w.add('error-state', `error text on screen (h1 "${h1}")`)
        const bad = main.match(/.{0,40}\b(NaN|undefined|null|Infinity|Invalid Date)\b.{0,40}/)
        if (bad) w.add('bad-text', `"${bad[0].replace(/\s+/g, ' ')}"`)
        recordLayout(w, await layout(page), r.path)
        await shot(page, `sweep_${v.key}_${role}_${r.path}`, v.width < 768)
      }
      await context.close()
    })
  }
}
