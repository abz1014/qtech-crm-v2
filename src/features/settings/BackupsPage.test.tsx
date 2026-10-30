import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { BackupsPage } from '@/features/settings/BackupsPage'
import { settingsLinksFor } from '@/features/settings/settingsLinks'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => fake?.uninstall())

const MB = 1024 * 1024
const NOW = new Date().toISOString()
const row = (o: Record<string, unknown> = {}) => ({
  last_backup_at: null,
  last_backup_bytes: null,
  last_backup_storage_bytes: null,
  last_backup_objects: null,
  last_drill_at: null,
  last_drill_ok: null,
  last_decrypt_test_at: null,
  tracking_since: '2026-10-01T00:00:00Z',
  db_bytes: 40 * MB,
  storage_bytes: 800 * MB,
  storage_objects: 12,
  trash_files: 0,
  trash_oldest: null,
  ...o,
})

function mount(h: Record<string, unknown>) {
  fake = installFakeDb((c: FakeCall) => (c.target === 'rpc:admin_health' ? { data: [h] } : { data: null }))
  const session: SessionState = { status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role: 'admin' } }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <SessionProvider value={session}>
        <MemoryRouter>
          <ToastProvider>
            <BackupsPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('Settings > Backups and usage', () => {
  it('says when no backup has ever reported, and shows both meters against the free limits', async () => {
    mount(row())
    expect(await screen.findByTestId('backup-last')).toHaveTextContent('None recorded yet')
    expect(screen.getByTestId('usage-db')).toHaveTextContent('40.0 MB of 500.0 MB (8%)')
    expect(screen.getByTestId('usage-storage')).toHaveTextContent('800.0 MB of 1.00 GB (78%)')
    expect(screen.getByRole('progressbar', { name: 'File storage' })).toHaveAttribute('aria-valuenow', '78')
  })

  it('shows the last backup, the drill and the trash', async () => {
    mount(row({ last_backup_at: NOW, last_backup_bytes: 3 * MB, last_backup_storage_bytes: 200 * MB, last_backup_objects: 12, last_drill_at: NOW, last_drill_ok: true, trash_files: 4, trash_oldest: '2026-10-01T00:00:00Z' }))
    expect(await screen.findByTestId('backup-last')).toHaveTextContent('(today)')
    expect(screen.getByTestId('backup-status')).toHaveTextContent('3.00 MB database, 200.0 MB files (12)')
    expect(screen.getByTestId('backup-drill')).toHaveTextContent('Passed')
    expect(screen.getByTestId('backup-trash')).toHaveTextContent('4 files')
  })

  it('says plainly when the files were not backed up', async () => {
    mount(row({ last_backup_at: NOW, last_backup_bytes: 3 * MB }))
    expect(await screen.findByTestId('backup-status')).toHaveTextContent('The files were NOT backed up')
  })

  it('records the monthly key check', async () => {
    mount(row())
    fireEvent.click(await screen.findByRole('button', { name: 'I opened a backup with my key today' }))
    await waitFor(() => expect(fake?.calls.some(c => c.target === 'rpc:confirm_backup_decrypt_test')).toBe(true))
  })

  it('is in the admin menu only', () => {
    expect(settingsLinksFor('admin').some(l => l.to === '/settings/backups')).toBe(true)
    expect(settingsLinksFor('sales').some(l => l.to === '/settings/backups')).toBe(false)
    expect(settingsLinksFor('engineer').some(l => l.to === '/settings/backups')).toBe(false)
  })
})
