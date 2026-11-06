import { describe, expect, it } from 'vitest'
import { hidesEngineerFab } from '@/app/shell/hidesEngineerFab'

describe('hidesEngineerFab', () => {
  it.each([
    ['/capture', true],
    ['/capture/', true],
    ['/capture/abc', true],
    ['/my-expenses', true],
    ['/settings/details', true],
    ['/settings/password', true],
    ['/rfqs/new', true],
    ['/enquiries/new', true],
    ['/today', false],
    ['/jobs', false],
    ['/jobs/123', false],
    ['/rfqs', false],
    ['/rfqs/abc', false],
    ['/settings', false],
    ['/settings/company', false],
    ['/captured', false],
    ['/my-expenses-old', false],
  ])('%s -> %s', (path, hidden) => {
    expect(hidesEngineerFab(path)).toBe(hidden)
  })
})
