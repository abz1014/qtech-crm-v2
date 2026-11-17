import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastContext } from '@/ui/useToast'
import { ExportPage } from './ExportPage'
import { EXPORTS } from './exportData'

const csv = vi.hoisted(() => ({ downloadCSV: vi.fn() }))
vi.mock('@/lib/csvExport', async orig => ({ ...(await orig<typeof import('@/lib/csvExport')>()), downloadCSV: csv.downloadCSV }))

const archivedOn = (c: FakeCall) => c.ops.some(([n, a]) => n === 'eq' && a[0] === 'archived' && a[1] === false)
const TRANSACTIONS = ['rfqs', 'orders', 'invoices', 'payments', 'expenses'] as const
const TABLE: Record<string, string> = { rfqs: 'rfqs', orders: 'orders', invoices: 'invoices', payments: 'payments_in', expenses: 'expenses' }
// the main read of a kind has a long column list; the name and number lookups ('id, number') are short
const isMainRead = (c: FakeCall) => c.ops.some(([n, a]) => n === 'select' && String(a[0]).length > 25)

let fake: ReturnType<typeof installFakeDb> | undefined
afterEach(() => fake?.uninstall())

describe('export data: Include Archive', () => {
  it.each([false, true])('includeArchive=%s: transaction tables are filtered only when it is off, lookups never', async include => {
    for (const id of TRANSACTIONS) {
      fake = installFakeDb(() => ({ data: [] }))
      await EXPORTS.find(e => e.id === id)!.run({ includeArchive: include })
      const main = fake.calls.filter(c => c.target === TABLE[id] && isMainRead(c))
      expect(main.length, id).toBeGreaterThan(0)
      expect(main.every(archivedOn), id).toBe(!include)
      expect(fake.calls.filter(c => !isMainRead(c)).some(archivedOn), id).toBe(false)
      fake.uninstall()
    }
  })

  it('the checkbox is off by default and the filter goes away when it is ticked', async () => {
    fake = installFakeDb(() => ({ data: [] }))
    render(
      <ToastContext.Provider value={{ toast: vi.fn() } as never}>
        <ExportPage />
      </ToastContext.Provider>,
    )
    const box = screen.getByRole('checkbox', { name: /include archive/i })
    expect(box).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV, Expenses' }))
    await vi.waitFor(() => expect(csv.downloadCSV).toHaveBeenCalledTimes(1))
    expect(fake.calls.filter(c => c.target === 'expenses' && isMainRead(c)).every(archivedOn)).toBe(true)
    fake.calls.length = 0
    await userEvent.click(box)
    expect(box).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV, Expenses' }))
    await vi.waitFor(() => expect(csv.downloadCSV).toHaveBeenCalledTimes(2))
    expect(fake.calls.some(c => c.target === 'expenses' && archivedOn(c))).toBe(false)
  })
})
