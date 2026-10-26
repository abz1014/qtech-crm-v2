import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CaptureProvider } from '@/app/capture/CaptureProvider'

/*
 * What a paste or a drop does outside a field (P4): on To do and the Jobs list it starts a New enquiry with it; on a job's page
 * "Add to this job" listens for it itself; on the intake screens the intake reads it; anywhere else nothing reacts.
 */
function Where() {
  const l = useLocation()
  const s = l.state as { capture?: { text: string; files: File[] } } | null
  return (
    <>
      <output aria-label="where">{l.pathname}</output>
      <output aria-label="carried">{s?.capture ? `${s.capture.text}|${s.capture.files.map(f => f.name).join(',')}` : ''}</output>
    </>
  )
}

function mount(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <CaptureProvider>
        <Where />
      </CaptureProvider>
    </MemoryRouter>,
  )
}

const drop = (file: File) => {
  const e = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown }
  e.dataTransfer = { types: ['Files'], files: [file], items: [file] }
  document.dispatchEvent(e)
  return e
}
const paste = (text: string) => {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown }
  e.clipboardData = { files: [], getData: (t: string) => (t === 'text/plain' ? text : '') }
  document.dispatchEvent(e)
  return e
}

describe('Capture provider', () => {
  it('a dropped file on To do or the Jobs list opens New enquiry with the file', async () => {
    const file = new File(['%PDF'], 'enquiry.pdf', { type: 'application/pdf' })
    for (const at of ['/todo', '/jobs']) {
      const view = mount(at)
      act(() => void drop(file))
      await waitFor(() => expect(screen.getByLabelText('where')).toHaveTextContent('/enquiries/new'))
      expect(screen.getByLabelText('carried')).toHaveTextContent('|enquiry.pdf')
      view.unmount()
    }
  })

  it('a message pasted on To do opens New enquiry with the text', async () => {
    mount('/todo')
    act(() => void paste('Please quote 2 nos level switch'))
    await waitFor(() => expect(screen.getByLabelText('where')).toHaveTextContent('/enquiries/new'))
    expect(screen.getByLabelText('carried')).toHaveTextContent('Please quote 2 nos level switch|')
  })

  it('does nothing on a job page (Add to this job listens there), on the intake screens, or anywhere else', () => {
    const file = new File(['%PDF'], 'enquiry.pdf', { type: 'application/pdf' })
    for (const at of ['/jobs/139', '/enquiries/new', '/rfqs/new', '/money/expenses', '/companies']) {
      const view = mount(at)
      expect(drop(file).defaultPrevented).toBe(false)
      expect(paste('some text').defaultPrevented).toBe(false)
      expect(screen.getByLabelText('where')).toHaveTextContent(at)
      view.unmount()
    }
  })
})
