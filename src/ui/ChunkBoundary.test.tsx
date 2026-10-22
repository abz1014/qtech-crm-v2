import { Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { lazyWithReload } from '@/lib/importWithReload'
import { ChunkBoundary } from '@/ui/ChunkBoundary'

describe('ChunkBoundary', () => {
  it('keeps the placeholder when a part cannot be downloaded offline, and draws it once back online', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    let fail = true
    const Part = lazyWithReload(() =>
      fail ? Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Part.js')) : Promise.resolve({ default: () => <p>the panel</p> }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ChunkBoundary fallback={<p>placeholder</p>}>
        <Suspense fallback={<p>placeholder</p>}>
          <Part />
        </Suspense>
      </ChunkBoundary>,
    )
    expect(await screen.findByText('placeholder')).toBeInTheDocument()
    expect(screen.queryByText('the panel')).not.toBeInTheDocument()
    fail = false
    online.mockReturnValue(true)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByText('the panel')).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('passes any other error on to the page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = () => {
      throw new Error('a bug')
    }
    expect(() =>
      render(
        <ChunkBoundary fallback={null}>
          <Broken />
        </ChunkBoundary>,
      ),
    ).toThrow('a bug')
    vi.restoreAllMocks()
  })
})
