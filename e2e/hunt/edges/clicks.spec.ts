import { test, type Locator, type Page } from '@playwright/test'
import { fill, seedWorld, type World } from '../../verify-roles/fixtures'
import { ROUTES } from '../../verify-roles/routes'
import { contextAs, layout, recordLayout, settle, shot, vp, Watcher } from './lib'

/*
 * Exploration: click every button on every screen (and every item of every menu it opens), as each role. For each overlay that
 * opens: screenshot, layout check, Tab x 30 stays inside it (focus trap), an empty submit (the primary button, errors recorded),
 * Esc closes it and focus goes back to the button. Sign out and the account-wide actions are skipped so the run keeps its user.
 * Records only; confirmed bugs are pinned in bugs.spec.ts.
 */
let world: World
test.beforeAll(async () => {
  world = await seedWorld('HC')
})

const SKIP = /^(Sign out|Q-Tech|Search or jump to|Search)$|Deactivate|Reset password|Remove access|Close \w+( \d{4})?$|^Reopen \w+ \d{4}$/
const OVERLAY = '[role="dialog"]:visible, [role="alertdialog"]:visible, [role="menu"]:visible, [role="listbox"]:visible'

/** Tags every visible button and tab with data-hunt="<name>#<n>" (n counts repeats of the same name) and returns the tags. */
async function buttons(page: Page): Promise<string[]> {
  return page.locator('button:visible, [role="button"]:visible, [role="tab"]:visible').evaluateAll(els => {
    const count = new Map<string, number>()
    const out: string[] = []
    for (const e of els) {
      const name = (e.getAttribute('aria-label') ?? (e as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
      if (!name) continue
      const n = count.get(name) ?? 0
      count.set(name, n + 1)
      const tag = `${name}#${n}`
      e.setAttribute('data-hunt', tag)
      out.push(tag)
    }
    return out
  })
}

const byTag = (page: Page, tag: string): Locator => page.locator(`[data-hunt="${tag.replace(/["\\]/g, '\\$&')}"]`)
const firstLine = (e: unknown, n: number) => String(e).split(/\r?\n/)[0].slice(0, n)
const nameOf = (tag: string) => tag.replace(/#\d+$/, '')

async function overlayCheck(page: Page, w: Watcher, where: string, trigger: Locator, keyBase: string): Promise<void> {
  const ov = page.locator(OVERLAY).last()
  const role = await ov.getAttribute('role').catch(() => null)
  const label = ((await ov.getAttribute('aria-label').catch(() => null)) ?? (await ov.locator('h2').first().innerText({ timeout: 500 }).catch(() => '')) ?? '').slice(0, 60)
  recordLayout(w, await layout(page), `${where} > ${role} "${label}"`)
  await shot(page, `${keyBase}_${role}_${label}`)
  if (role === 'dialog' || role === 'alertdialog') {
    // Focus trap: 30 Tabs must never leave the dialog.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => {
        const a = document.activeElement
        return !!a && a !== document.body && !!a.closest('[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]')
      })
      if (!inside) {
        w.add('focus-escapes', `${where} > dialog "${label}": Tab ${i + 1} leaves the dialog`)
        break
      }
    }
    // Empty submit with the primary (submit) button, if there is one.
    const submit = ov.locator('button[type="submit"]:visible').last()
    if ((await submit.count()) > 0 && (await submit.isEnabled().catch(() => false))) {
      const before = await ov.innerText().catch(() => '')
      await submit.click({ timeout: 2000 }).catch(() => undefined)
      await page.waitForTimeout(700)
      const still = await page.locator(OVERLAY).count()
      const alerts = (await page.locator('[role="alert"]:visible, [aria-invalid="true"] ~ *:visible, [id$="-error"]:visible').allInnerTexts().catch(() => [])).join(' | ').slice(0, 300)
      w.add('empty-submit', `${where} > "${label}": ${still ? 'stays open' : 'CLOSED (saved?)'}; messages: ${alerts || '(none)'}${before.length === 0 ? '' : ''}`)
      await shot(page, `${keyBase}_${label}_empty-submit`)
    }
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  if ((await page.locator(OVERLAY).count()) > 0) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if ((await page.locator(OVERLAY).count()) > 0) w.add('esc-does-not-close', `${where} > ${role} "${label}"`)
  } else if (role !== 'listbox') {
    const back = await trigger.evaluate(el => el === document.activeElement || el.contains(document.activeElement)).catch(() => null)
    if (back === false) {
      const now = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        return a ? `${a.tagName} ${(a.getAttribute('aria-label') ?? a.innerText ?? '').slice(0, 40)}` : 'none'
      })
      w.add('focus-not-returned', `${where} > ${role} "${label}": after Esc focus is on ${now}`)
    }
  }
}

const RUNS = [
  { role: 'admin', v: 'w1366' },
  { role: 'sales', v: 'w375' },
  { role: 'engineer', v: 'w375' },
] as const

for (const run of RUNS) {
  test(`clicks ${run.role} @ ${run.v}`, async ({ browser }, info) => {
    test.setTimeout(600_000)
    const v = vp(run.v)
    const context = await contextAs(browser, info, run.role, v)
    const page = await context.newPage()
    const w = new Watcher(page, { role: run.role, vp: run.v })
    const routes = ROUTES.filter(r => r[run.role] === 'ok' && !/\?(issue|won|new|pay|add|invoice)=/.test(r.path) && !/\/(extra|nope)$|^\/login$|^\/$/.test(r.path))
    const started = Date.now()
    for (const r of routes) {
      if (Date.now() - started > 240_000) {
        w.add('budget', `stopped before ${r.path}: time budget`)
        break
      }
      const path = fill(r.path, world)
      w.at(r.path)
      await page.goto(path)
      await page.locator('#main').waitFor({ timeout: 15_000 }).catch(() => undefined)
      await settle(page)
      const landed = page.url()
      const list = (await buttons(page)).filter(t => !SKIP.test(nameOf(t)))
      for (const tag of list.slice(0, 25)) {
        const name = nameOf(tag)
        if (page.url() !== landed || (await page.locator(OVERLAY).count()) > 0) {
          await page.goto(path)
          await settle(page)
        }
        await buttons(page)
        const btn = byTag(page, tag)
        if (!(await btn.isVisible().catch(() => false)) || !(await btn.isEnabled().catch(() => false))) continue
        const errs = w.seen.length
        await btn.click({ timeout: 3000 }).catch(e => w.add('click-failed', `"${name}": ${firstLine(e, 160)}`))
        await page.waitForTimeout(600)
        const where = `${r.path} "${name}"`
        if ((await page.locator(OVERLAY).count()) > 0) {
          const ov = page.locator(OVERLAY).last()
          if ((await ov.getAttribute('role')) === 'menu') {
            const items = await ov.locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]').allInnerTexts().catch(() => [] as string[])
            await overlayCheck(page, w, where, btn, `click_${run.v}_${run.role}_${r.path}_${name}`)
            for (const item of items.map(x => firstLine(x.trim(), 200)).filter(x => x && !SKIP.test(x))) {
              await page.goto(path)
              await settle(page)
              await buttons(page)
              const again = byTag(page, tag)
              if (!(await again.isVisible().catch(() => false))) break
              await again.click({ timeout: 3000 }).catch(() => undefined)
              const mi = page.locator('[role="menu"]:visible').last().getByText(item, { exact: true }).first()
              if (!(await mi.isVisible().catch(() => false))) continue
              await mi.click({ timeout: 3000 }).catch(e => w.add('click-failed', `menu "${name}" > "${item}": ${firstLine(e, 120)}`))
              await page.waitForTimeout(700)
              if ((await page.locator(OVERLAY).count()) > 0) await overlayCheck(page, w, `${where} > "${item}"`, again, `click_${run.v}_${run.role}_${r.path}_${name}_${item}`)
            }
          } else {
            await overlayCheck(page, w, where, btn, `click_${run.v}_${run.role}_${r.path}_${name}`)
          }
        }
        if (w.seen.slice(errs).some(f => /pageerror|console|http5/.test(f.kind))) await shot(page, `click-error_${run.v}_${run.role}_${r.path}_${name}`)
      }
    }
    await context.close()
  })
}
