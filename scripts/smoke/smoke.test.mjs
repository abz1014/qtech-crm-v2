import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listPublicObjects } from './objects.mjs'
import { READ_ACCESS } from './expectations.mjs'

const objs = listPublicObjects(path.resolve(__dirname, '../../src/types/database.ts'))

describe('smoke object list (generated from the types)', () => {
  it('finds the tables, views and functions', () => {
    expect(objs.tables).toContain('users')
    expect(objs.tables).toContain('orders')
    expect(objs.tables.length).toBeGreaterThanOrEqual(28)
    expect(objs.views).toContain('v_order_state')
    expect(objs.functions.map((f) => f.name)).toContain('close_month')
    expect(objs.functions.find((f) => f.name === 'close_month').args).toEqual(['p_month'])
  })
  it('every object named in the Part 2 expectations exists (a rename must update expectations.mjs)', () => {
    const all = new Set([...objs.tables, ...objs.views])
    const missing = Object.values(READ_ACCESS).flat().filter((n) => !all.has(n))
    expect(missing).toEqual([])
  })
})
