import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HelpPanel } from '@/features/help/HelpPanel'
import { allRecipes } from '@/features/help/recipes'
import { axeViolations } from '@/test/axe'

function Harness({ role = 'sales', wide = true, start = null as string | null, pathname = '/rfqs', onClose = () => {}, onShowHowItWorks }: {
  role?: string
  wide?: boolean
  start?: string | null
  pathname?: string
  onClose?: () => void
  onShowHowItWorks?: () => void
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
      <HelpPanel recipes={allRecipes()} role={role} pathname={pathname} recipeId={id} onShow={setId} onClose={onClose} wide={wide} onShowHowItWorks={onShowHowItWorks} />
    </>
  )
}

const panel = () => screen.getByRole('dialog', { name: 'Help' })

describe('Help panel', () => {
  it('lists the screen\'s recipes, then the role\'s own by area; other roles only on request', async () => {
    const user = userEvent.setup()
    render(<Harness role="engineer" pathname="/orders/123" />)
    const forScreen = within(panel()).getByRole('region', { name: 'For this screen' })
    expect(within(forScreen).getAllByRole('button').length).toBeLessThanOrEqual(3)
    const orders = within(panel()).getByRole('region', { name: 'Orders' })
    expect(within(orders).getByRole('button', { name: 'Mark goods delivered' })).toBeInTheDocument()
    expect(within(panel()).queryByRole('region', { name: 'Money' })).toBeNull()
    expect(within(panel()).queryByRole('button', { name: 'Close a month' })).toBeNull()
    await user.click(within(panel()).getByRole('checkbox', { name: "Show other roles' help" }))
    expect(within(panel()).getByRole('region', { name: 'Money' })).toHaveTextContent('Close a month')
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

  it('an unknown recipe id shows the list with a note; "Show How this works again" is offered when asked for', async () => {
    const user = userEvent.setup()
    const again = vi.fn()
    render(<Harness start="no-such-recipe" onShowHowItWorks={again} />)
    expect(within(panel()).getByRole('status')).toHaveTextContent('not here any more')
    await user.click(within(panel()).getByRole('button', { name: 'Show “How this works” again' }))
    expect(again).toHaveBeenCalledTimes(1)
  })
})
