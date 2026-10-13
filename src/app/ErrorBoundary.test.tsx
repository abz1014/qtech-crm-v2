// Ported from src/components/ErrorBoundary.tsx @ 7a29f3a (Q-Tech CRM v1). New render test (v1 had none) that a throwing child shows the fallback.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/app/ErrorBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Boom(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the fallback when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const el = document.createElement('div')
    const root = createRoot(el)
    act(() => root.render(<ErrorBoundary><Boom /></ErrorBoundary>))
    expect(el.textContent).toContain('Something went wrong')
    expect(el.querySelector('button')?.textContent).toBe('Reload page')
    act(() => root.unmount())
  })

  it('renders children when nothing throws', () => {
    const el = document.createElement('div')
    const root = createRoot(el)
    act(() => root.render(<ErrorBoundary><p>ok</p></ErrorBoundary>))
    expect(el.textContent).toBe('ok')
    act(() => root.unmount())
  })
})
