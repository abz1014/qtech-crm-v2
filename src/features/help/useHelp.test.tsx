import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { helpHref, useHelp, withHelp, type HelpApi } from '@/features/help/useHelp'

let api: HelpApi
let go: ReturnType<typeof useNavigate>

function Probe() {
  api = useHelp()
  go = useNavigate()
  const loc = useLocation()
  return <p data-testid="at">{`${loc.pathname}${loc.search}`}</p>
}

const at = () => screen.getByTestId('at').textContent

function mount(path = '/rfqs?tab=mine') {
  render(
    <MemoryRouter initialEntries={['/today', path]} initialIndex={1}>
      <Probe />
    </MemoryRouter>,
  )
}

describe('useHelp: Help lives in ?help=', () => {
  it('builds addresses that keep the other parameters', () => {
    expect(withHelp('?tab=mine', 'new-rfq')).toBe('?tab=mine&help=new-rfq')
    expect(withHelp('?tab=mine&help=x', null)).toBe('?tab=mine')
    expect(withHelp('', '')).toBe('?help=')
    expect(helpHref('/orders', 'mark-won')).toBe('/orders?help=mark-won')
  })

  it('opening pushes one entry, so Back closes Help and stays on the page', () => {
    mount()
    expect(api.open).toBe(false)
    act(() => api.openHelp('new-rfq'))
    expect(at()).toBe('/rfqs?tab=mine&help=new-rfq')
    expect(api).toMatchObject({ open: true, recipeId: 'new-rfq' })
    // Moving between recipes swaps the entry: Back still closes Help in one step.
    act(() => api.openHelp('ask-suppliers'))
    act(() => api.openHelp(null))
    expect(api).toMatchObject({ open: true, recipeId: null })
    act(() => go(-1))
    expect(at()).toBe('/rfqs?tab=mine')
    expect(api.open).toBe(false)
  })

  it('closeHelp goes back over the entry it pushed', () => {
    mount()
    act(() => api.openHelp('snooze'))
    act(() => api.closeHelp())
    expect(at()).toBe('/rfqs?tab=mine')
    act(() => go(-1))
    expect(at()).toBe('/today')
  })

  it('a page opened on ?help= (a link) closes by removing the parameter, not by leaving the page', () => {
    mount('/orders?help=mark-won')
    expect(api).toMatchObject({ open: true, recipeId: 'mark-won' })
    act(() => api.closeHelp())
    expect(at()).toBe('/orders')
    act(() => go(-1))
    expect(at()).toBe('/today')
  })
})
