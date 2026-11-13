import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HelpPanel } from '@/features/help/HelpPanel'
import { allRecipes } from '@/features/help/recipes'
import { axeViolations } from '@/test/axe'

function Harness({ role = 'sales', wide = true, start = null as string | null, pathname = '/rfqs', onClose = () => {} }: {
  role?: string
  wide?: boolean
  start?: string | null
  pathname?: string
  onClose?: () => void
}) {
  const [id, setId] = useState<string | null>(start)
  const [pageClicks, setPageClicks] = useState(0)
  return (
    <>
      <main>
        <button type="button" onClick={() => setPageClicks(n => n + 1)}>
          Page button
        </button>
        <p>Page clicks: {pageClicks}</p>
      </main>
      <HelpPanel recipes={allRecipes()} role={role} pathname={pathname} recipeId={id} onShow={setId} onClose={onClose} wide={wide} />
    </>
  )
}

const panel = () => screen.getByRole('dialog', { name: 'Help' })

describe('Help panel', () => {
  it('lists the screen\'s recipes, then the role\'s own by area; other roles only on request', async () => {
    render(<Harness role="engineer" pathname="/jobs/123" />)
    const forScreen = within(panel()).getByRole('region', { name: 'For this screen' })
    expect(within(forScreen).getAllByRole('button').length).toBeLessThanOrEqual(3)
    const orders = within(panel()).getByRole('region', { name: 'Jobs' })
    expect(within(orders).getByRole('button', { name: 'Mark goods delivered' })).toBeInTheDocument()
    expect(within(panel()).queryByRole('region', { name: 'Money' })).toBeNull()
    expect(within(panel()).queryByRole('button', { name: 'Lock a month' })).toBeNull()
    // An engineer is not offered other roles' help at all (live bug 33).
    expect(within(panel()).queryByRole('checkbox', { name: "Show other roles' help" })).toBeNull()
  })

  it("a sales person can still show other roles' help; admin sees everything with no checkbox", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness role="sales" pathname="/todo" />)
    expect(within(panel()).queryByRole('button', { name: 'Lock a month' })).toBeNull()
    await user.click(within(panel()).getByRole('checkbox', { name: "Show other roles' help" }))
    expect(within(panel()).getByRole('region', { name: 'Money' })).toHaveTextContent('Lock a month')
    unmount()
    render(<Harness role="admin" pathname="/todo" />)
    expect(within(panel()).queryByRole('checkbox', { name: "Show other roles' help" })).toBeNull()
    expect(within(panel()).getByRole('button', { name: 'Lock a month' })).toBeInTheDocument()
  })

  it('an engineer cannot open a non-engineer recipe through a ?help= id or a related link (owner decision D)', () => {
    const recipes = allRecipes()
    const blocked = recipes.find(r => !r.roles.includes('engineer'))!
    render(<Harness role="engineer" pathname="/jobs/123" start={blocked.id} />)
    expect(within(panel()).queryByRole('heading', { name: n => n.includes(blocked.title) })).toBeNull()
    expect(within(panel()).getByText('That help page is not here any more. Pick one below.')).toBeInTheDocument()
  })

  it("an engineer's recipe does not link to a recipe the engineer cannot open", () => {
    const recipes = allRecipes()
    const mine = recipes.filter(r => r.roles.includes('engineer'))
    const withHidden = mine.find(r => r.related.some(id => recipes.find(x => x.id === id && !x.roles.includes('engineer'))))
    if (!withHidden) return // no engineer recipe links to a non-engineer one today; the id test above covers the direct route
    render(<Harness role="engineer" start={withHidden.id} />)
    const next = within(panel()).queryByRole('region', { name: 'Next' })
    for (const id of withHidden.related) {
      const r = recipes.find(x => x.id === id)
      if (r && !r.roles.includes('engineer') && next) expect(within(next).queryByRole('button', { name: r.title })).toBeNull()
    }
  })

  it('an admin can open any recipe by id', () => {
    const blocked = allRecipes().find(r => !r.roles.includes('engineer'))!
    render(<Harness role="admin" start={blocked.id} />)
    expect(within(panel()).getByRole('heading', { name: n => n.includes(blocked.title) })).toBeInTheDocument()
  })

  it('opens a recipe with its steps and labels as chips, focuses its title, and goes back to the list', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(within(panel()).getAllByRole('button', { name: 'Log a new enquiry (RFQ)' })[0])
    const title = within(panel()).getByRole('heading', { name: /Log a new enquiry \(RFQ\)/ })
    expect(title).toHaveFocus()
    const steps = panel().querySelectorAll('ol > li')
    expect(steps.length).toBeGreaterThanOrEqual(3)
    expect(within(panel()).getAllByText('New enquiry')[0]).toHaveAttribute('data-label')
    expect(within(panel()).getByRole('region', { name: 'Next' })).toHaveTextContent('Ask suppliers for prices')
    expect(await axeViolations()).toEqual([])
    await user.click(within(panel()).getByRole('button', { name: 'All help' }))
    expect(within(panel()).getByRole('searchbox', { name: 'Search help' })).toHaveFocus()
  })

  it('search finds recipes by any word in their steps, and says when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Harness role="admin" />)
    const box = within(panel()).getByRole('searchbox', { name: 'Search help' })
    expect(box).toHaveFocus()
    await user.type(box, 'how do I psid')
    const answers = within(panel()).getByRole('region', { name: 'Answers' })
    expect(within(answers).getByRole('button', { name: 'Mark invoices posted and GST paid to FBR' })).toBeInTheDocument()
    await user.clear(box)
    await user.type(box, 'zebra')
    expect(within(panel()).getByRole('status')).toHaveTextContent('Nothing matches “zebra”')
  })

  it('wide: a side panel that leaves the page usable (no focus trap, page not hidden, a page click does not close it)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness wide onClose={onClose} />)
    expect(panel()).not.toHaveAttribute('aria-modal', 'true')
    expect(panel()).toHaveAttribute('data-help-panel', 'side')
    const pageButton = screen.getByRole('button', { name: 'Page button' })
    await user.click(pageButton)
    expect(pageButton).toHaveFocus()
    expect(screen.getByText('Page clicks: 1')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(await axeViolations()).toEqual([])
    await user.click(within(panel()).getByRole('button', { name: 'Close help' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('phone: a full-height modal sheet; the back arrow leaves a recipe, then closes Help; Esc closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness wide={false} start="snooze" onClose={onClose} />)
    expect(panel()).toHaveAttribute('data-help-panel', 'sheet')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Page button', hidden: true }).closest('[aria-hidden="true"]')).not.toBeNull())
    expect(await axeViolations(panel())).toEqual([])
    await user.click(within(panel()).getByRole('button', { name: 'Back to all help' }))
    expect(within(panel()).getByRole('searchbox', { name: 'Search help' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(panel()).getByRole('button', { name: 'Close help' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('an unknown recipe id shows the list with a note; the How this works steps are listed inline with Show me', async () => {
    const user = userEvent.setup()
    render(<Harness start="no-such-recipe" />)
    expect(within(panel()).getByRole('status')).toHaveTextContent('not here any more')
    expect(within(panel()).getByRole('heading', { name: 'How this works' })).toBeInTheDocument()
    await user.click(within(panel()).getAllByRole('button', { name: 'Show me' })[0])
    expect(within(panel()).queryByRole('status')).toBeNull()
  })
})
