import { readFileSync } from 'node:fs'
import path from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { AppShell } from '@/app/shell/AppShell'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { KEY_WORDS, handledKeys, shortcutList } from '@/app/shell/shortcuts'
import { setSingleKeyShortcuts } from '@/ui/useShortcutsSetting'
import { Avatar } from '@/ui/Avatar'
import { installFakeDb } from '@/test/fakeSupabase'

installFakeDb(() => ({ data: [] })) // the shell reads the nav counts
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

vi.mock('@/features/capture/CaptureSheet', () => ({ default: () => <div role="dialog" aria-label="Capture" /> }))
vi.mock('@/features/search/api', () => ({ searchAll: () => Promise.resolve([]) }))


function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}

function BarPage() {
  useMobileBar({ title: 'Team', back: { to: '/todo' }, action: <button type="button">Add</button> })
  return <p>Bar page</p>
}

function shell(path = '/todo', role: 'admin' | 'sales' | 'engineer' = 'sales') {
  const session: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role } }
  return render(
    <QueryClientProvider client={client}>
    <SessionProvider value={session}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            element={
              <>
                <Where />
                <AppShell />
              </>
            }
          >
            <Route path="/todo" element={<input aria-label="Notes" />} />
            <Route path="/enquiries/new" element={<p>Intake</p>} />
            <Route path="/rfqs" element={<p>RFQs page</p>} />
            <Route path="/orders" element={<p>Orders page</p>} />
            <Route path="/bar" element={<BarPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>
    </QueryClientProvider>,
  )
}

const press = (key: string, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })

afterEach(() => {
  window.localStorage.clear()
  setSingleKeyShortcuts(true)
})

describe('palette Actions and global shortcuts (A-89)', () => {
  // The palette is a lazy chunk, and its first import (Radix, cmdk, a Vite transform shared by every worker) can take several seconds when the suite runs in parallel,
  // longer than any findBy. Load it first, with a hook timeout of its own, so the tests only exercise opening it.
  beforeAll(async () => {
    await import('@/ui/CommandPalette')
  }, 60_000)

  it('idle lists Actions: New enquiry (N), Paste or photo (C), Go to To do (G T)', async () => {
    const user = userEvent.setup()
    shell()
    await user.click(screen.getAllByRole('button', { name: /^Search or jump to/ })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Search or jump to' })
    expect(await within(dlg).findByText('Actions')).toBeInTheDocument()
    const text = within(dlg).getAllByRole('option').map(r => r.textContent)
    expect(text).toEqual(expect.arrayContaining(['New enquiryGo to intakeN', 'Paste or photoActionC', 'Go to To doG T']))
  })

  it('N opens intake, C opens the capture surface, G then T goes to To do', async () => {
    shell('/rfqs')
    press('n')
    expect(await screen.findByText('Intake')).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('/enquiries/new')
    press('g')
    press('t')
    expect(screen.getByTestId('where').textContent).toBe('/todo')
    // From the page, as a real key press is: CaptureProvider's document listener answers C (PaletteHost no longer does).
    press('c', document.body)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('/todo')
  })

  it('O starts an order without an enquiry (admin and sales)', () => {
    shell('/todo', 'sales')
    press('o')
    expect(screen.getByTestId('where').textContent).toBe('/orders?new=1')
  })

  it('O does nothing for an engineer', () => {
    shell('/todo', 'engineer')
    press('o')
    expect(screen.getByTestId('where').textContent).toBe('/todo')
  })

  it('E opens Quick add expense for the admin, anywhere; sales and engineers get nothing', async () => {
    const { unmount } = shell('/rfqs', 'admin')
    press('e')
    expect(await screen.findByRole('dialog', { name: 'Add an expense' })).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('/rfqs')
    unmount()
    shell('/rfqs', 'sales')
    press('e')
    expect(screen.queryByRole('dialog', { name: 'Add an expense' })).toBeNull()
  })

  it('E, O and N never fire while typing in a field or in a rich-text box', () => {
    shell('/todo', 'admin')
    const field = screen.getByRole('textbox', { name: 'Notes' })
    for (const k of ['e', 'o', 'n']) press(k, field)
    expect(screen.getByTestId('where').textContent).toBe('/todo')
    expect(screen.queryByRole('dialog', { name: 'Add an expense' })).toBeNull()
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    // jsdom does not implement isContentEditable: the shortcut code reads it, so give the node the same answer a browser would
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    document.body.appendChild(editable)
    for (const k of ['e', 'o', 'n']) press(k, editable)
    expect(screen.getByTestId('where').textContent).toBe('/todo')
    editable.remove()
  })

  it('T alone does nothing, and typing in a field never triggers a shortcut', async () => {
    shell('/todo')
    press('t')
    expect(screen.getByTestId('where').textContent).toBe('/todo')
    const field = screen.getByRole('textbox', { name: 'Notes' })
    press('n', field)
    expect(screen.getByTestId('where').textContent).toBe('/todo')
  })
})

describe('Keyboard shortcuts sheet (round 2, 4.4)', () => {
  it('? opens the sheet, drawn from shortcuts.ts: every shortcut and its keys appear in it', async () => {
    shell('/rfqs')
    press('?')
    const dlg = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    for (const g of ['Anywhere', 'Lists and tables', 'Search box', 'Writing', 'Add expenses'])
      expect(within(dlg).getByRole('heading', { name: g })).toBeInTheDocument()
    const rows = [...dlg.querySelectorAll('dt')].map(dt => ({
      what: dt.textContent ?? '',
      keys: [...(dt.nextElementSibling?.children ?? [])].map(k => k.textContent),
    }))
    for (const s of shortcutList()) {
      const row = rows.find(r => r.what === s.what + (s.where ?? '') && r.keys.join(' ') === s.keys.join(' '))
      expect(row, `${s.group}: ${s.what}`).toBeTruthy()
    }
    // Joining words are text; every other key is a key cap.
    const caps = [...dlg.querySelectorAll('kbd')].map(k => k.textContent)
    for (const k of shortcutList().flatMap(s => s.keys).filter(k => !KEY_WORDS.has(k))) expect(caps).toContain(k)
  })

  it('? does nothing while typing, with a dialog open, or with single-key shortcuts off', async () => {
    const user = userEvent.setup()
    shell('/todo')
    press('?', screen.getByRole('textbox', { name: 'Notes' }))
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()

    await user.click(screen.getAllByRole('button', { name: /^Search or jump to/ })[0])
    await screen.findByRole('dialog', { name: 'Search or jump to' })
    press('?', document.body)
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    await user.keyboard('{Escape}')

    setSingleKeyShortcuts(false)
    press('?')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
  })

  it('every key handled in the shell, palette, tables, toasts and Add expenses is listed in shortcuts.ts', () => {
    const root = path.resolve(__dirname, '../../..')
    const files = [
      'src/app/capture/CaptureProvider.tsx',
      'src/app/palette/PaletteHost.tsx',
      'src/ui/CommandPalette.tsx',
      'src/ui/DataTable.tsx',
      'src/ui/Toast.tsx',
      'src/features/money/expenses/BurstSheet.tsx',
    ]
    // e.key === 'x', e.key.toLowerCase() !== 'x', k === "x" (PaletteHost reads e.key into k), and switch (e.key) cases.
    const compare = /\b(?:e\.key(?:\.toLowerCase\(\))?|k)\s*[!=]==\s*(['"])(.+?)\1/g
    const listed = handledKeys()
    const missing: string[] = []
    for (const f of files) {
      const src = readFileSync(path.join(root, f), 'utf8')
      const found = [...src.matchAll(compare)].map(m => m[2])
      for (const sw of src.matchAll(/switch \(e\.key\) \{([\s\S]*?)\n {4}\}/g))
        found.push(...[...sw[1].matchAll(/case (['"])(.*?)\1:/g)].map(m => m[2]))
      expect(found.length, f).toBeGreaterThan(0)
      for (const key of found) if (!listed.has(key.toLowerCase())) missing.push(`${f}: '${key}'`)
    }
    expect(missing).toEqual([])
  })
})

describe('phone bar (A-82)', () => {
  it('useMobileBar swaps in back + title + action, and the default returns on unmount', async () => {
    const user = userEvent.setup()
    shell('/bar')
    const back = await screen.findByRole('button', { name: 'Back' })
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    await user.click(back)
    expect(screen.getByTestId('where').textContent).toBe('/todo')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Search' }).length).toBeGreaterThan(0)
  })

})

describe('Avatar sizes (A-84)', () => {
  it.each([
    ['sm', 'size-[28px]'],
    ['md', 'size-[32px]'],
    ['lg', 'size-[36px]'],
    ['xl', 'size-[40px]'],
    ['2xl', 'size-[44px]'],
  ] as const)('%s is %s', (size, cls) => {
    render(<Avatar name="Ayesha Rana" size={size} />)
    expect(screen.getByRole('img', { name: 'Ayesha Rana' }).className).toContain(cls)
  })
})
