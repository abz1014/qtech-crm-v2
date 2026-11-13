import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { navItems } from '@/app/navConfig'
import { parseRecipe, recipesAs } from '@/features/help/recipes'

/*
 * Help speaks the app's words (redesign phase 5, P5-F). labelSync.test.ts proves every [Label] in a recipe is on the screens it names;
 * this one proves a recipe never uses a retired name (the plan's glossary: To collect, Invoices, Lock a month, Bank check, Mistakes
 * to fix, Jobs ...), and that the main-menu words it taps are the menu's real ones. An old word may stay in a recipe's `keywords:`
 * line, because that is what a person types into Help's search.
 */
const DIR = path.resolve(__dirname, '../../../docs/help')
const RETIRED = ['Who owes us', 'Invoices & GST', 'Month end', 'Match bank statement', 'Things to check', 'Close through', 'Close <month>', 'Closed months', 'Close a month', 'Tax deposited', 'Sent to customer', 'Recurring expenses', 'Dismiss', 'closed month', 'in-app enquiry']
/** Spoken words the tone rewrite retired (whole words: "purchase" is fine). */
const RETIRED_WORD = /\b(chase[sd]?|chasing|nudge[sd]?)\b/i
const files = readdirSync(DIR).filter(f => f.endsWith('.md'))
const body = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/^---[\s\S]*?\n---/, '')

describe('help recipes use the current words', () => {
  it('there are recipes to check', () => expect(files.length).toBeGreaterThan(20))

  it.each(files)('%s names no retired word', f => {
    const text = body(f)
    expect(RETIRED.filter(w => text.includes(w)), `${f} says a retired name`).toEqual([])
    expect(RETIRED_WORD.exec(text)?.[0] ?? null, `${f} says a retired spoken word`).toBeNull()
  })

  it('a step never taps RFQs or Orders as a menu item: they are Jobs now', () => {
    const bad = files.filter(f => /\b(Select|Open) \[(RFQs|Orders)\]/.test(body(f)))
    expect(bad).toEqual([])
  })

  it('the menu words a recipe taps are the menu\'s own', () => {
    const menu = new Set(navItems.map(i => i.label))
    const tapped = files.flatMap(f => [...body(f).matchAll(/(Select|Open) \[(To do|Jobs|Money|Companies|Today)\]/g)].map(m => `${f}: ${m[2]}`))
    expect(tapped.filter(t => !menu.has(t.split(': ')[1]))).toEqual([])
  })

  /*
   * An engineer has no money screens, so a recipe they can open never speaks of money (live bug 34). The [I paid] button is their own
   * expense claim and keeps its name. The `keywords:` line is what a person types, so it is not read. i-paid.md is the engineer's own expense claim, so it is about money by design.
   */
  const MONEY = /\b(paid|prices?|POs?|purchase orders?|invoices?|quotations?|payments?|margins?|costs?|owed?|owes?)\b/i
  const engineerFiles = files.filter(f => f !== 'i-paid.md' && /^roles:.*\bengineer\b/m.test(readFileSync(path.join(DIR, f), 'utf8')))

  it('there are engineer recipes to check', () => expect(engineerFiles.length).toBeGreaterThan(8))

  it.each(engineerFiles)('%s (engineer) uses no money word', f => {
    const r = parseRecipe(readFileSync(path.join(DIR, f), 'utf8'), f)
    const text = (r.engineer?.body ?? r.body).replace(/\[I paid\]/g, '').replace(/\bI paid\b/g, '')
    const title = /^title: (.*)$/m.exec(readFileSync(path.join(DIR, f), 'utf8'))?.[1] ?? ''
    expect(MONEY.exec(title + '\n' + text)?.[0] ?? null, `${f} says a money word an engineer should not read`).toBeNull()
  })

  it('the exchange-rate recipe is not for engineers: Settings, Exchange rates is closed to them', () => {
    expect(readFileSync(path.join(DIR, 'exchange-rate.md'), 'utf8')).not.toMatch(/^roles:.*\bengineer\b/m)
  })

  it('engineers keep help for the shared order recipes, in their own words', () => {
    const kept = ['job-order-work', 'supplier-history', 'todo-list', 'read-a-job', 'paste-or-photo']
    const mine = recipesAs('engineer', files.map(f => parseRecipe(readFileSync(path.join(DIR, f), 'utf8'), f)))
    for (const id of kept) {
      const r = mine.find(x => x.id === id)
      expect(r?.roles, `${id} is still for engineers`).toContain('engineer')
      expect(r?.engineer, `${id} reads as the engineer version`).toBeUndefined()
      expect(r?.steps.length, `${id} has steps`).toBeGreaterThan(0)
    }
    expect(recipesAs('sales', mine).length).toBe(mine.length)
  })

  it('sales and admin read the original text: recipesAs leaves their recipes alone', () => {
    const all = files.map(f => parseRecipe(readFileSync(path.join(DIR, f), 'utf8'), f))
    const jo = all.find(r => r.id === 'job-order-work')!
    expect(recipesAs('sales', all).find(r => r.id === 'job-order-work')?.body).toBe(jo.body)
    expect(jo.body).toContain('[Issue PO]')
    expect(recipesAs('engineer', all).find(r => r.id === 'job-order-work')?.body).not.toContain('Issue PO')
  })
})
