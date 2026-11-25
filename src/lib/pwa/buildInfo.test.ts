import { describe, expect, it } from 'vitest'
import { formatBuildDate, shortBuild, versionCode, versionLabel } from '@/lib/pwa/buildInfo'

describe('build label', () => {
  it('shortens a commit to 7 characters and leaves a short id alone', () => {
    expect(shortBuild('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')).toBe('a1b2c3d')
    expect(shortBuild('dev')).toBe('dev')
  })

  it('writes the date as day, month name, year; anything that is not a date gives nothing', () => {
    expect(formatBuildDate('2026-10-26T14:03:11+05:00')).toBe('26 Oct 2026')
    expect(formatBuildDate('')).toBe('')
    expect(formatBuildDate('yesterday')).toBe('')
  })

  it('reads "Version <short sha> · <date>"', () => {
    // review 21: the date for everyone, the commit code only for an admin (and in the tooltip)
    expect(versionLabel('a1b2c3d4e5f6', '2026-10-26T09:00:00Z')).toBe('Build 26 Oct 2026')
    expect(versionLabel('a1b2c3d4e5f6', '2026-10-26T09:00:00Z', true)).toBe('Build 26 Oct 2026 · a1b2c3d')
    expect(versionLabel('dev', '')).toBe('Build dev')
    expect(versionCode('a1b2c3d4e5f6')).toBe('Version a1b2c3d')
  })
})
