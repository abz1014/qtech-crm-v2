import { test } from '@playwright/test'
import { ROUTES } from '../../verify-roles/routes'
import { contextAs, layout, recordLayout, settle, shot, vp, Watcher } from './lib'

/*
 * Exploration: the empty states. Runs FIRST in the suite (file name), on the freshly reset database that holds only the seed's
 * users, so every list, panel and report is empty. Routes with a record placeholder are skipped (there is no record yet).
 */
for (const run of [
  { role: 'admin', v: 'w1366' },
  { role: 'admin', v: 'w375' },
  { role: 'engineer', v: 'w375' },
  { role: 'sales', v: 'w1366' },
] as const) {
  test(`empty ${run.role} @ ${run.v}`, async ({ browser }, info) => {
    test.setTimeout(300_000)
    const context = await contextAs(browser, info, run.role, vp(run.v))
    const page = await context.newPage()
    const w = new Watcher(page, { role: run.role, vp: `${run.v}-empty` })
    for (const r of ROUTES.filter(x => x[run.role] !== 'no' && !x.path.includes('{'))) {
      w.at(r.path)
      await page.goto(r.path)
      await page.locator('#main').waitFor({ timeout: 15_000 }).catch(() => undefined)
      await settle(page)
      const main = await page.locator('#main').innerText().catch(() => '')
      if (/\b(NaN|undefined|null|Infinity|Invalid Date)\b/.test(main)) w.add('bad-text', `"${(main.match(/.{0,40}(NaN|undefined|null|Infinity|Invalid Date).{0,40}/) ?? [''])[0].replace(/\s+/g, ' ')}"`)
      if (main.trim().length < 20) w.add('blank', `main region nearly empty: "${main.trim()}"`)
      recordLayout(w, await layout(page), r.path)
      await shot(page, `empty_${run.v}_${run.role}_${r.path}`, true)
    }
    await context.close()
  })
}
