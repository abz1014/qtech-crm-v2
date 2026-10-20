import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { useScrollRestoration } from '@/lib/useScrollRestoration'

/*
 * The shell's scroller stands in as a plain <main id="main"> that stays mounted across routes, like AppShell's. jsdom has
 * no layout, so the test gives it a fixed room to scroll and fires the scroll events itself.
 */
let nav: ReturnType<typeof useNavigate>
let setSearch: ReturnType<typeof useSearchParams>[1]

function Frame() {
  useScrollRestoration()
  nav = useNavigate()
  setSearch = useSearchParams()[1]
  return (
    <main id="main" data-testid="main">
      <Routes>
        <Route path="/rfqs" element={<p>list</p>} />
        <Route path="/rfqs/:id" element={<p>detail</p>} />
      </Routes>
    </main>
  )
}

function mount() {
  render(
    <MemoryRouter initialEntries={['/rfqs']}>
      <Frame />
    </MemoryRouter>,
  )
  const main = screen.getByTestId('main')
  Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 5000 })
  Object.defineProperty(main, 'clientHeight', { configurable: true, value: 800 })
  return main
}

function scrollTo(el: HTMLElement, y: number) {
  el.scrollTop = y
  el.dispatchEvent(new Event('scroll'))
}

beforeEach(() => window.sessionStorage.clear())

describe('useScrollRestoration', () => {
  it('a new page starts at the top; Back returns to where the list was left', async () => {
    const main = mount()
    scrollTo(main, 1200)
    await act(async () => nav('/rfqs/7'))
    expect(screen.getByText('detail')).toBeInTheDocument()
    expect(main.scrollTop).toBe(0)

    scrollTo(main, 300)
    await act(async () => nav(-1))
    expect(screen.getByText('list')).toBeInTheDocument()
    expect(main.scrollTop).toBe(1200)

    // Forward returns to the detail's own place.
    await act(async () => nav(1))
    expect(main.scrollTop).toBe(300)
  })

  it('a filter or tab change (query string only) keeps the place', async () => {
    const main = mount()
    scrollTo(main, 640)
    await act(async () => setSearch({ state: 'quoted' }))
    expect(main.scrollTop).toBe(640)
  })

  it('places are kept in sessionStorage, so a reload can restore them', async () => {
    const main = mount()
    scrollTo(main, 900)
    await act(async () => nav('/rfqs/8'))
    const kept = JSON.parse(window.sessionStorage.getItem('qtech.scroll') ?? '[]') as [string, number][]
    expect(kept.map(([, y]) => y)).toContain(900)
  })

  it('a restore waits for the page to grow tall enough', async () => {
    const main = mount()
    scrollTo(main, 2000)
    await act(async () => nav('/rfqs/9'))
    // The list is still loading when Back lands on it: only 1000 px of room.
    Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 1800 })
    await act(async () => nav(-1))
    expect(main.scrollTop).not.toBe(2000)
    Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 5000 })
    await act(async () => new Promise(r => setTimeout(r, 50)))
    expect(main.scrollTop).toBe(2000)
  })
})
