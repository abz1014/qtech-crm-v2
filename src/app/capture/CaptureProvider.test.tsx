import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CaptureProvider } from '@/app/capture/CaptureProvider'
import { SessionContext } from '@/app/session'

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

function mount(at: string, role = 'sales') {
  return render(
    <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Test', role } }}>
      <MemoryRouter initialEntries={[at]}>
        <CaptureProvider>
          <Where />
        </CaptureProvider>
      </MemoryRouter>
    </SessionContext.Provider>,
  )
}

const drag = (type: 'dragenter' | 'dragleave', target: EventTarget = document.body) => {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown }
  e.dataTransfer = { types: ['Files'], files: [], items: [] }
  target.dispatchEvent(e)
  return e
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

  it('dragging a file over Home or the Jobs list covers the window with "Drop to start a New RFQ"; leaving or dropping takes it away', async () => {
    const file = new File(['%PDF'], 'enquiry.pdf', { type: 'application/pdf' })
    for (const at of ['/todo', '/jobs']) {
      const view = mount(at)
      expect(screen.queryByTestId('drop-overlay')).toBeNull()
      act(() => void drag('dragenter'))
      expect(screen.getByTestId('drop-overlay')).toBeInTheDocument()
      expect(within(screen.getByTestId('drop-overlay')).getByRole('status')).toHaveTextContent('Drop to start a New RFQ')
      act(() => void drag('dragleave'))
      expect(screen.queryByTestId('drop-overlay')).toBeNull()
      act(() => void drag('dragenter'))
      act(() => void drop(file))
      expect(screen.queryByTestId('drop-overlay')).toBeNull()
      await waitFor(() => expect(screen.getByLabelText('where')).toHaveTextContent('/enquiries/new'))
      view.unmount()
    }
  })

  it('no overlay for an engineer, on a job page, or on the intake screens', () => {
    const cases: [string, string][] = [['/todo', 'engineer'], ['/jobs/139', 'sales'], ['/enquiries/new', 'admin'], ['/rfqs/new', 'admin'], ['/companies', 'admin']]
    for (const [at, role] of cases) {
      const view = mount(at, role)
      act(() => void drag('dragenter'))
      expect(screen.queryByTestId('drop-overlay'), `${at} as ${role}`).toBeNull()
      view.unmount()
    }
  })
})
