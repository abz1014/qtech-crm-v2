import { describe, expect, it } from 'vitest'
import type { TeamMember } from '@/features/settings/adminUsers'
import {
  filterTeam,
  firstName,
  isOnlyActiveAdmin,
  passwordGroups,
  roleLabel,
  signInMessage,
  teamCounts,
} from '@/features/settings/teamModel'

const m = (id: string, name: string, role: TeamMember['role'], deactivated = false, email: string | null = `${id}@qtech.example`): TeamMember => ({
  id,
  name,
  email,
  role,
  job_title: null,
  deactivated_at: deactivated ? '2026-01-01T00:00:00Z' : null,
  created_at: '2026-01-01T00:00:00Z',
})

const team = [m('bilal', 'Bilal Chaudhry', 'admin'), m('ayesha', 'Ayesha Rana', 'sales'), m('saad', 'Saad Hussain', 'sales', true)]

describe('team list model', () => {
  it('counts people by status', () => {
    expect(teamCounts(team)).toEqual({ all: 3, active: 2, deactivated: 1 })
  })

  it('filters by status and by name or email, ignoring case', () => {
    expect(filterTeam(team, 'active', '').map(x => x.id)).toEqual(['bilal', 'ayesha'])
    expect(filterTeam(team, 'deactivated', '').map(x => x.id)).toEqual(['saad'])
    expect(filterTeam(team, 'all', ' AYESHA ').map(x => x.id)).toEqual(['ayesha'])
    expect(filterTeam(team, 'all', 'saad@qtech').map(x => x.id)).toEqual(['saad'])
    expect(filterTeam(team, 'active', 'saad')).toEqual([])
  })

  it('knows the only active admin, and that a deactivated admin does not count', () => {
    expect(isOnlyActiveAdmin(team[0], team)).toBe(true)
    expect(isOnlyActiveAdmin(team[1], team)).toBe(false)
    const two = [...team, m('second', 'Second Admin', 'admin')]
    expect(isOnlyActiveAdmin(two[0], two)).toBe(false)
    const second = [...team, m('gone', 'Gone Admin', 'admin', true)]
    expect(isOnlyActiveAdmin(second[0], second)).toBe(true)
  })

  it('labels roles and takes the first name', () => {
    expect(roleLabel('engineer')).toBe('Engineer')
    expect(firstName('  Hira  Siddiqui ')).toBe('Hira')
  })
})

describe('one-time password helpers', () => {
  it('groups for reading aloud without changing the characters', () => {
    expect(passwordGroups('Vk7xmQ3pRt9wHn2e')).toEqual(['Vk7x', 'mQ3p', 'Rt9w', 'Hn2e'])
    expect(passwordGroups('Vk7xmQ3pRt9wHn2e').join('')).toBe('Vk7xmQ3pRt9wHn2e')
    expect(passwordGroups('abcde')).toEqual(['abcd', 'e'])
  })

  it('builds the WhatsApp sign-in message with the raw password', () => {
    const text = signInMessage({ name: 'Hira Siddiqui', email: 'hira@qtech.example', password: 'Vk7xmQ3pRt9wHn2e', signInUrl: 'https://crm.example/login' })
    expect(text).toBe(
      [
        'Hi Hira, your Q-Tech CRM account is ready.',
        'Sign in: https://crm.example/login',
        'Email: hira@qtech.example',
        'Password: Vk7xmQ3pRt9wHn2e',
        'Please keep the password private.',
      ].join('\n'),
    )
  })
})
