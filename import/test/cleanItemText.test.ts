import { describe, expect, it } from 'vitest'
import { cleanItemText } from '../src/lib/cleanItemText'
import { itemDescription } from '../src/transform/orders'

// The same cases as supabase/tests/0135_imported_text_private.test.sql (a). Fictional suppliers and items only.
const SAMPLE =
  'Supplier breakdown: • ITEM#30: IC TLC0838C 20PIN SMD ×6 — Acme Components Ltd @ Rs 2,505/unit • ITEM#31: Relay 12V DPDT ×2 — Borealis Traders @ Rs 410/unit • ITEM#32: Fuse 5A ×10 — Acme Components Ltd @ Rs 12/unit'

describe('cleanItemText (twin of qtech_private.clean_item_text, migration 0135)', () => {
  it('keeps the first item and counts the rest, with no supplier and no price', () => {
    expect(cleanItemText(SAMPLE)).toBe('IC TLC0838C 20PIN SMD ×6 +2 more')
  })
  it('copes with text cut at 200 characters in the middle of a supplier name', () => {
    expect(cleanItemText('Supplier breakdown: • ITEM#30: IC TLC0838C 20PIN SMD ×6 — Acme Components Ltd @ Rs 2,505/unit • ITEM#31: Relay 12V DPDT ×2 — Borealis Trad')).toBe(
      'IC TLC0838C 20PIN SMD ×6 +1 more',
    )
  })
  it('one bullet has no "+N more"; two have "+1 more"', () => {
    expect(cleanItemText('Supplier breakdown: • ITEM#1: Alpha gauge ×1 — Some Supplier @ Rs 5/unit')).toBe('Alpha gauge ×1')
    expect(cleanItemText('Supplier breakdown: • ITEM#1: Alpha gauge ×1 — Some Supplier @ Rs 5/unit • ITEM#2: Beta valve — Other Co @ PKR 9/unit')).toBe('Alpha gauge ×1 +1 more')
  })
  it('leaves plain text alone, including the import\'s own "item — Unit label"', () => {
    expect(cleanItemText('Gauge x1 — Batch B')).toBe('Gauge x1 — Batch B')
    expect(cleanItemText('Wallmount Ultrasonic Flow Meter x1 — Unit A')).toBe('Wallmount Ultrasonic Flow Meter x1 — Unit A')
    expect(cleanItemText('RS-485 converter, 2 RS-485 ports')).toBe('RS-485 converter, 2 RS-485 ports')
    expect(cleanItemText('Cars and Doors')).toBe('Cars and Doors')
  })
  it('cuts an "@ price" tail and drops a part that names a price', () => {
    expect(cleanItemText('Pump 5HP @ Rs 300/unit')).toBe('Pump 5HP')
    expect(cleanItemText('Valve — Rs 5000/unit')).toBe('Valve')
  })
  it('does not take a serial port for a price, with or without a space or hyphen', () => {
    for (const t of ['Flow meter RS485 output', 'Flow meter RS 485 output', 'Flow meter RS-485 output', 'Gateway RS232 and RS422 ports', 'Gateway, 2 RS 485 ports', 'Gateway 2 RS485 ports']) {
      expect(cleanItemText(t)).toBe(t)
    }
  })
  it('does not cut an "@" that is not followed by a price', () => {
    expect(cleanItemText('Transmitter 4-20mA @ 24V')).toBe('Transmitter 4-20mA @ 24V')
    expect(cleanItemText('Sensor 0-10V @ 24V DC — Unit C')).toBe('Sensor 0-10V @ 24V DC — Unit C')
  })
  it('recognises more ways to write a price', () => {
    for (const price of ['Rs: 2505', 'Rs.2505', 'Rs 2,505', '2505/-', '$ 40', '$40', '£30', '€30', 'USD 40', '40 USD', '40 EUR', 'GBP 30', '90 AED', '500 rupees', 'rupees 500', '2 lakh', '2 lac', '3 lacs']) {
      expect(cleanItemText(`Cable — ${price}`), price).toBe('Cable')
      expect(cleanItemText(`Cable @ ${price}`), price).toBe('Cable')
    }
    expect(cleanItemText('Cable 40 USD')).toBe('Imported item')
  })
  it('never returns the price: a neutral placeholder when nothing is left', () => {
    expect(cleanItemText('Cable 2500 PKR')).toBe('Imported item')
  })
  it('is idempotent and passes null through', () => {
    const once = cleanItemText(SAMPLE)
    expect(cleanItemText(once)).toBe(once)
    expect(cleanItemText(null)).toBeNull()
  })
  it('the item text the import writes comes out clean', () => {
    const d = itemDescription({ product_type: 'Boards', notes: SAMPLE })
    expect(d).toBe('IC TLC0838C 20PIN SMD ×6 +2 more')
    expect(d).not.toMatch(/Rs|PKR|\/unit|@|Acme|Borealis/i)
  })
})
