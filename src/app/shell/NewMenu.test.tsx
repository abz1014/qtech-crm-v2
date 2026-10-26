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

describe('the + New menu, by role', () => {
  it('admin: New enquiry, Expense, Payment received, Order without enquiry', () => {
    expect(newEntries('admin').map(e => e.label)).toEqual(['New enquiry', 'Expense', 'Payment received', 'Order without enquiry'])
  })
  it('sales: New enquiry and Order without enquiry, no Payment received and no Expense', () => {
    expect(newEntries('sales').map(e => e.label)).toEqual(['New enquiry', 'Order without enquiry'])
  })
  it('engineer: nothing, and no button is drawn', () => {
    expect(newEntries('engineer')).toEqual([])
    mount('engineer')
    expect(screen.queryByRole('button', { name: /New/ })).toBeNull()
  })
  it('opens a menu whose items go to their screens', async () => {
    mount('admin')
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    expect(await screen.findByRole('menuitem', { name: /Payment received/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Order without enquiry/ }))
    expect(screen.getByTestId('where').textContent).toBe('/orders?new=1')
  })
  it('a salesperson\'s menu has no Payment received', async () => {
    mount('sales')
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    await screen.findByRole('menuitem', { name: /New enquiry/ })
    expect(screen.queryByRole('menuitem', { name: /Payment received/ })).toBeNull()
  })
})
