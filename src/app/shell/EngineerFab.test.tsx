import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BottomTabs } from '@/app/shell/MobileChrome'
import { EngineerFab } from '@/app/shell/EngineerFab'

/* P7-C: the engineer's phone bar is To do and Jobs with a big Photo or note button between them, and "I paid" beside it. */
function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}
const bar = () =>
  render(
    <MemoryRouter initialEntries={['/todo']}>
      <Routes>
        <Route path="*" element={<><BottomTabs role="engineer" fab={<EngineerFab />} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )

describe('the engineer phone bar', () => {
  it('has To do, then the big button, then Jobs: nothing else, no Money, no Companies', () => {
    bar()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect([...nav.children].map(c => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['To do', 'Photo or noteI paid', 'Jobs'])
    expect(within(nav).queryByRole('link', { name: /Money|Companies/ })).toBeNull()
  })

  it('Photo or note opens the job picker in one tap; I paid goes to the engineer\'s claims', () => {
    bar()
    fireEvent.click(screen.getByRole('button', { name: 'Photo or note' }))
    expect(screen.getByTestId('where').textContent).toBe('/capture')
    fireEvent.click(screen.getByRole('button', { name: 'I paid' }))
    expect(screen.getByTestId('where').textContent).toBe('/my-expenses')
  })

  it('both buttons are at least 44 px tall (a class that sets 56)', () => {
    bar()
    for (const name of ['Photo or note', 'I paid']) expect(screen.getByRole('button', { name }).className).toMatch(/(?<!min-)h-\[56px\]/)
  })
})
