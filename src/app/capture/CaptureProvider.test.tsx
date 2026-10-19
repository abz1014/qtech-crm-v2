import { act, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptureProvider } from '@/app/capture/CaptureProvider'
import { useCapture } from '@/app/capture/useCapture'
import { createCapture } from '@/lib/capture/store'
import { ToastContext } from '@/ui/useToast'
import type { AddedFile } from '@/lib/fileIntake'

// Turning the kept item's files back into draft files is slow on a phone (photos are decoded and shrunk); hold it open.
const intake = vi.hoisted(() => ({ release: [] as (() => void)[] }))
vi.mock('@/lib/fileIntake', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/fileIntake')>()
  return {
    ...real,
    intakeFiles: (files: readonly File[]) =>
      new Promise<AddedFile[]>(resolve => intake.release.push(() => resolve(files.map(f => ({ id: crypto.randomUUID(), file: f, originalSize: f.size }))))),
  }
})

let typeText: (t: string) => void = () => {}
function Probe() {
  const cap = useCapture()
  typeText = cap.setText
  return <output aria-label="draft">{cap.draft.text}</output>
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  intake.release = []
})
afterEach(() => {
  delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
})

describe('Capture provider: picking up the kept item on start', () => {
  it('does not overwrite what the person typed while the kept item was still loading', async () => {
    await createCapture({ source: 'share', text: 'old shared text', files: [{ name: 'a.jpg', type: 'image/jpeg', size: 1, blob: new Blob(['x']) }] })
    render(
      <MemoryRouter>
        <ToastContext.Provider value={{ toast: vi.fn(() => 't'), dismiss: vi.fn() }}>
          <CaptureProvider>
            <Probe />
          </CaptureProvider>
        </ToastContext.Provider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(intake.release).toHaveLength(1))
    act(() => typeText('typed just now'))
    await act(async () => intake.release[0]())
    expect(screen.getByLabelText('draft')).toHaveTextContent('typed just now')
  })
})
