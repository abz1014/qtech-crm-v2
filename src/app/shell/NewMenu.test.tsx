import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { NewMenu } from '@/app/shell/NewMenu'
import { newEntries } from '@/app/shell/newEntries'

/* "+ New" (redesign phase 3): each role gets its own list; sales never gets "Payment received" (payments are admin only, 0010). */
function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
const mount = (role: string) =>
  render(
    <MemoryRouter initialEntries={['/todo']}>
      <Routes>
        <Route path="*" element={<><NewMenu role={role} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )

describe('Create (the rail menu), by role', () => {
  it('admin: New enquiry, Expense, Payment received, Order without enquiry', () => {
    expect(newEntries('admin').map(e => e.label)).toEqual(['New RFQ', 'Expense', 'Payment received', 'Order without RFQ'])
    // Payment received asks "Which order?" first, on To collect (?pay=1)
    expect(newEntries('admin').find(e => e.id === 'payment')?.to).toBe('/money/receivables?pay=1')
  })
  it('sales: New enquiry and Order without enquiry, no Payment received and no Expense', () => {
    expect(newEntries('sales').map(e => e.label)).toEqual(['New RFQ', 'Order without RFQ'])
  })
  it('the rail button reads Create, and keeps that name while the rail is 72 wide (the word read out only)', () => {
    const { unmount } = mount('admin')
    expect(screen.getByRole('button', { name: 'Create' })).toHaveTextContent('Create')
    unmount()
    render(<MemoryRouter><NewMenu role="admin" collapsed /></MemoryRouter>)
    const b = screen.getByRole('button', { name: 'Create' })
    expect(b.querySelector('span')?.className).toContain('sr-only')
  })
  it('engineer: nothing, and no button is drawn', () => {
    expect(newEntries('engineer')).toEqual([])
    mount('engineer')
    expect(screen.queryByRole('button', { name: /New|Create/ })).toBeNull()
  })
  it('opens a menu whose items go to their screens', async () => {
    mount('admin')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('menuitem', { name: /Payment received/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Order without RFQ/ }))
    expect(screen.getByTestId('where').textContent).toBe('/orders?new=1')
  })
  it('a salesperson\'s menu has no Payment received', async () => {
    mount('sales')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('menuitem', { name: /New RFQ/ })
    expect(screen.queryByRole('menuitem', { name: /Payment received/ })).toBeNull()
  })
})
