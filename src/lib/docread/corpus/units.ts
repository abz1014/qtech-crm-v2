// Units as customers write them, grouped into families: "Nos", "No." and "NOS" are one unit; "EA" and "PCS" are not "Nos"
// (the customer's unit is kept, docs/IMAGE_OCR.md). Shared by the generator and the scorer.

import type { Rng } from './rng'

export const UNIT_FAMILIES: Record<string, string[]> = {
  nos: ['Nos', 'nos', 'No', 'Nos.', 'NOS', 'No.', 'NO', "No's", 'Numbers', 'adad'],
  ea: ['EA', 'ea', 'Each', 'each'],
  pcs: ['PCS', 'pcs', 'Pcs', 'pc', 'PC', 'pieces', 'Pieces', 'piece'],
  set: ['SET', 'Set', 'Sets', 'set', 'sets', 'SETS'],
  m: ['MTR', 'Mtr', 'mtr', 'Mtrs', 'meters', 'Meters', 'M', 'm', 'metres', 'MTRS', 'RM'],
  kg: ['KG', 'Kg', 'kg', 'kgs', 'KGS', 'Kgs'],
  lot: ['LOT', 'Lot', 'lot'],
  pair: ['PAIR', 'Pair', 'pairs', 'Pairs', 'PR'],
  roll: ['ROLL', 'Roll', 'rolls', 'Rolls', 'ROLLS'],
  box: ['BOX', 'Box', 'boxes', 'Boxes', 'BOXES'],
  l: ['LTR', 'Ltr', 'ltr', 'litres', 'L'],
  unit: ['Unit', 'Units', 'units', 'unit', 'UNIT'],
  drum: ['Drum', 'drums', 'Drums'],
  ft: ['FT', 'ft', 'Ft', 'feet'],
}

const FAMILY_OF = new Map<string, string>()
for (const [fam, list] of Object.entries(UNIT_FAMILIES)) for (const u of list) FAMILY_OF.set(u.toLowerCase(), fam)
FAMILY_OF.set('nos', 'nos')
FAMILY_OF.set('number', 'nos')

/** The family of a unit as written, or as stored ("nos", "m"); unknown words stand for themselves. */
export function unitFamily(u: string | null | undefined): string | null {
  if (!u) return null
  const k = u.trim().toLowerCase().replace(/\.$/, '')
  return FAMILY_OF.get(k) ?? FAMILY_OF.get(`${k}.`) ?? k
}

/** The unit written in a given register: 'caps' (an ERP or Outlook table), 'title' ("Nos"), 'lower' (a chat). */
export function writeUnit(r: Rng, family: string, register: 'caps' | 'title' | 'lower' | 'any'): string {
  const list = UNIT_FAMILIES[family] ?? [family]
  const pool = list.filter(u =>
    register === 'caps' ? u === u.toUpperCase() && /[A-Z]/.test(u) : register === 'title' ? /^[A-Z][a-z]/.test(u) : register === 'lower' ? u === u.toLowerCase() && u !== 'adad' : u !== 'adad',
  )
  return r.pick(pool.length ? pool : list)
}
