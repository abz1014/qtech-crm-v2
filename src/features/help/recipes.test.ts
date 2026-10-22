import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { allRecipes, findRecipe, groupByArea, parseRecipe, recipesForPath, recipesForRole, searchRecipes } from '@/features/help/recipes'

const recipe = (id: string, roles: string, extra = '', body = '1. Tap [Today].') =>
  parseRecipe(`---\nid: ${id}\ntitle: Title of ${id}\nroles: ${roles}\n${extra}---\n${body}`, `docs/help/${id}.md`)

describe('help recipes (docs/help/*.md)', () => {
  it('bundles every recipe file in docs/help', () => {
    const files = readdirSync(path.resolve(__dirname, '../../../docs/help')).filter(f => f.endsWith('.md') && f !== 'README.md')
    expect(allRecipes().map(r => `${r.id}.md`).sort()).toEqual(files.sort())
  })

  it('reads the front matter and the steps', () => {
    const r = recipe('new-rfq', 'sales, admin', 'keywords: enquiry, paste\nscreens: /rfqs, /today\nrelated: ask-suppliers\n', '1. Tap [RFQs].\n2. Tap [New RFQ].\n\nTip: [Undo].')
    expect(r).toMatchObject({
      id: 'new-rfq',
      title: 'Title of new-rfq',
      roles: ['sales', 'admin'],
      keywords: ['enquiry', 'paste'],
      screens: ['/rfqs', '/today'],
      related: ['ask-suppliers'],
      steps: ['Tap RFQs.', 'Tap New RFQ.'],
      labels: ['RFQs', 'New RFQ', 'Undo'],
    })
  })

  it('refuses a recipe with a broken front matter, naming the file', () => {
    expect(() => parseRecipe('1. no front matter', 'docs/help/x.md')).toThrow(/docs\/help\/x\.md: a recipe starts with a front matter/)
    expect(() => recipe('Bad_Id', 'sales')).toThrow(/lower-case words/)
    expect(() => parseRecipe('---\nid: other\ntitle: T\nroles: sales\n---\n1. x', 'docs/help/mine.md')).toThrow(/must match the file name/)
    expect(() => recipe('x', 'sales, owner')).toThrow(/roles must list/)
    expect(() => parseRecipe('---\nid: x\nroles: sales\n---\n1. x', 'docs/help/x.md')).toThrow(/title is missing/)
  })

  it('a role sees its own recipes; admin sees all; "everyone" shows all to anyone', () => {
    const list = [recipe('a', 'sales'), recipe('b', 'engineer'), recipe('c', 'admin')]
    expect(recipesForRole(list, 'sales').map(r => r.id)).toEqual(['a'])
    expect(recipesForRole(list, 'engineer').map(r => r.id)).toEqual(['b'])
    expect(recipesForRole(list, 'admin').map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(recipesForRole(list, 'sales', true).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('"for this screen" matches route prefixes on a segment boundary, the most specific first', () => {
    const list = [recipe('money', 'sales', 'screens: /money\n'), recipe('gst', 'sales', 'screens: /money/gst-register\n'), recipe('other', 'sales', 'screens: /moneybags\n')]
    expect(recipesForPath(list, '/money/gst-register', 'sales').map(r => r.id)).toEqual(['gst', 'money'])
    expect(recipesForPath(list, '/money', 'sales').map(r => r.id)).toEqual(['money'])
    expect(recipesForPath(list, '/today', 'sales')).toEqual([])
    expect(recipesForPath(list, '/money', 'engineer')).toEqual([])
  })

  it('search needs every word, ignores "how do I" and "help", and ranks title matches first', () => {
    const list = [
      recipe('in-steps', 'sales', '', '1. Then send the quotation.'),
      recipe('quotation', 'sales', 'keywords: quote\n'),
      recipe('payment', 'sales', 'keywords: money\n'),
    ]
    expect(searchRecipes(list, 'how do I quotation').map(r => r.id)).toEqual(['quotation', 'in-steps'])
    expect(searchRecipes(list, 'money').map(r => r.id)).toEqual(['payment'])
    expect(searchRecipes(list, 'help').map(r => r.id)).toHaveLength(3)
    expect(searchRecipes(list, 'quotation money')).toEqual([])
    // No searchable word at all is not "everything" (HW-29).
    expect(searchRecipes(list, '%')).toEqual([])
    expect(searchRecipes(list, '_')).toEqual([])
    expect(searchRecipes(list, 'کوٹیشن')).toEqual([])
  })

  it('groups recipes by the area of their first screen, in tab order', () => {
    const list = [recipe('m', 'admin', 'screens: /money/gst-register, /orders\n'), recipe('t', 'sales', 'screens: /today\n'), recipe('x', 'sales')]
    expect(groupByArea(list).map(g => [g.area, g.recipes.map(r => r.id)])).toEqual([
      ['Today', ['t']],
      ['Money', ['m']],
      ['Other', ['x']],
    ])
  })

  it('finds a recipe by id, or nothing', () => {
    expect(findRecipe('new-rfq')?.title).toBeTruthy()
    expect(findRecipe('no-such-thing')).toBeUndefined()
    expect(findRecipe(null)).toBeUndefined()
  })
})
