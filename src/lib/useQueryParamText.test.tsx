import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { matchesAllWords, useQueryParamText } from '@/lib/useQueryParamText'

function Harness({ k }: { k?: string }) {
  const [q, setQ] = useQueryParamText(k)
  const where = useLocation()
  return (
    <>
      <input aria-label="Search" value={q} onChange={e => setQ(e.target.value, { page: null })} />
      <p data-testid="where">{where.search}</p>
    </>
  )
}

describe('useQueryParamText', () => {
  it('reads ?q= on load, writes it as you type, keeps other params, and drops it when cleared', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/list?tab=done&q=acme&page=3']}>
        <Harness />
      </MemoryRouter>,
    )
    const box = screen.getByRole('textbox', { name: 'Search' })
    expect(box).toHaveValue('acme')
    await user.type(box, ' x')
    expect(screen.getByTestId('where')).toHaveTextContent('?tab=done&q=acme+x')
    await user.clear(box)
    expect(screen.getByTestId('where')).toHaveTextContent(/^\?tab=done$/)
  })

  it('takes another key', () => {
    render(
      <MemoryRouter initialEntries={['/list?search=pump']}>
        <Harness k="search" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('pump')
  })
})

describe('matchesAllWords', () => {
  it('needs every word, in any order, ignoring case; no words match everything', () => {
    expect(matchesAllWords('Punjab Cement · RFQ-0177 · Belimo valve', 'belimo  punjab')).toBe(true)
    expect(matchesAllWords('Punjab Cement', 'punjab dairy')).toBe(false)
    expect(matchesAllWords('anything', '   ')).toBe(true)
  })
})
