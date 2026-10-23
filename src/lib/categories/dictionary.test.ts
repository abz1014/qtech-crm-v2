import { describe, expect, it } from 'vitest'
import { CATEGORY_NAMES, inferCategory, normaliseItemText } from './dictionary'

const sure = (d: string) => {
  const r = inferCategory(d)
  expect(r.confidence, d).toBe('sure')
  return r.name
}

describe("the owner's real examples", () => {
  it.each([
    ['MCB S/P 32A (Schneider)', 'MCB'],
    ['Thimble 10x25mm Tin Coated', 'Cable lugs/thimbles'],
    ['DIG TEMP CONTROLLER TCN4S-24R', 'Temperature controllers'],
    ['MOTORIZED ROTARY LEVEL SWITCH (BIN LEVEL SWITCH)', 'Level switches'],
    ['Capacitor 3.5Uf', 'Capacitors'],
    ['MS DB 300x300x150, 16SWG', 'Enclosures/DBs'],
    ['UNDER/OVER RMS MONITORING RELAY (ABB CM-PVS-41-S)', 'Protection/monitoring relays'],
    ['Control Relay with base 11pin, 240VDC', 'Control relays'],
    ['PUSH BUTTON - 30 MM GREEN', 'Push buttons'],
    ['SOFT STARTER - 30KW', 'Soft starters'],
    ['PLC MITSUBISHI FX2N-128MR', 'PLC'],
    ['THERMAL O/LOAD RELAY 110~135A (SIEMENS 3RU5156)', 'Overload relays'],
    ['PRESSURE TRANSMITTER TRANSDUCER', 'Pressure transmitters'],
  ])('%s -> %s', (d, name) => {
    expect(sure(d)).toBe(name)
  })

  it('"Multi Show 3 in 2" is not guessed', () => {
    expect(inferCategory('Multi Show 3 in 2')).toEqual({ name: null, confidence: 'none', candidates: [], matched: '' })
  })

  // A level SWITCH that is also a RADAR: a radar is a continuous level transmitter, a switch is on/off. The text contradicts itself,
  // so the answer is unsure with both, and the engineer decides. Guessing either would route the RFQ to the wrong suppliers.
  it('"WATER LEVEL SWITCH RADAR ST-70AB" is unsure between Level switches and Level transmitters', () => {
    const r = inferCategory('WATER LEVEL SWITCH RADAR ST-70AB')
    expect(r.name).toBeNull()
    expect(r.confidence).toBe('unsure')
    expect([...r.candidates].sort()).toEqual(['Level switches', 'Level transmitters'])
  })
})

describe('longest and most specific wins', () => {
  it('MCCB beats MCB, and MCB does not match inside MCCB', () => {
    expect(sure('MCCB 3P 250A')).toBe('MCCB')
    expect(sure('mcb 1 pole')).toBe('MCB')
  })
  it('"overload relay" beats "relay"', () => {
    expect(sure('Overload relay 9-13A')).toBe('Overload relays')
    expect(sure('OLR 5-8A')).toBe('Overload relays')
  })
  it('"temperature controller" beats a bare controller, "rotary level switch" is a level switch', () => {
    expect(sure('Temperature controller PID')).toBe('Temperature controllers')
    expect(sure('Rotary level switch')).toBe('Level switches')
  })
  it('a protection word keeps a relay out of Control relays', () => {
    expect(sure('Phase failure relay')).toBe('Protection/monitoring relays')
    expect(sure('Safety relay PILZ')).toBe('Protection/monitoring relays')
    expect(sure('Relay 24VDC 8 pin')).toBe('Control relays')
  })
  it('cable, gland and lug are told apart', () => {
    expect(sure('Cable gland PG21')).toBe('Cable glands')
    expect(sure('Copper cable lug 70 sqmm')).toBe('Cable lugs/thimbles')
    expect(sure('Armoured cable 4C x 16')).toBe('Cables')
  })
  it('instruments by kind', () => {
    expect(sure('Radar level transmitter 0-10m')).toBe('Level transmitters')
    expect(sure('PT100 sensor 6x100')).toBe('RTD/thermocouples')
    expect(sure('Digital pressure gauge 0-10 bar')).toBe('Pressure gauges')
    expect(sure('Pressure switch 0-16 bar')).toBe('Pressure switches')
    expect(sure('Solenoid valve 24VDC 1/2 inch')).toBe('Solenoid valves')
    expect(sure('pH analyser')).toBe('Analysers')
    expect(sure('Electromagnetic flow meter DN50')).toBe('Flow meters')
    expect(sure('VFD 7.5kW')).toBe('VFD/drives')
    expect(sure('SMPS 24VDC 10A')).toBe('Power supplies')
    expect(sure('Current transformer 100/5')).toBe('CT/PT')
    expect(sure('Rotary encoder 1024ppr')).toBe('Encoders')
    expect(sure('Inductive proximity sensor M18')).toBe('Proximity sensors')
    expect(sure('Commissioning of drive panel')).toBe('Commissioning service')
  })
})

describe('ties and ambiguity', () => {
  it('"PT" alone is unsure between a pressure transmitter and a potential transformer', () => {
    const r = inferCategory('PT 1:1 spare')
    expect(r.confidence).toBe('unsure')
    expect(r.name).toBeNull()
    expect([...r.candidates].sort()).toEqual(['CT/PT', 'Pressure transmitters'])
  })
  it('a context word decides "PT"', () => {
    expect(sure('PT for water pressure loop')).toBe('Pressure transmitters')
    expect(sure('PT 11kV voltage metering')).toBe('CT/PT')
  })
  it('a tie between two categories returns both, never a pick', () => {
    const r = inferCategory('MCB or ACB')
    expect(r.name).toBeNull()
    expect(r.confidence).toBe('unsure')
    expect([...r.candidates].sort()).toEqual(['ACB', 'MCB'])
  })
})

describe('negative and edge cases', () => {
  it('empty, blank and number-only text finds nothing', () => {
    for (const d of ['', '   ', '12345', '- 2 nos']) expect(inferCategory(d).confidence).toBe('none')
  })
  it('needs whole words', () => {
    expect(inferCategory('Dbase license').confidence).toBe('none')
    expect(inferCategory('Rcdx widget').confidence).toBe('none')
    expect(inferCategory('Upstream widget').confidence).toBe('none')
  })
  it('is case-insensitive and ignores punctuation', () => {
    expect(sure('mccb')).toBe('MCCB')
    expect(sure('PLC, s7-1200 CPU 1214C')).toBe('PLC')
  })
  it('a plural matches its singular keyword', () => {
    expect(sure('Contactors 3P 25A')).toBe('Contactors')
  })
  it('cable tray is not a cable', () => {
    expect(inferCategory('Perforated cable tray 300mm').confidence).toBe('none')
  })
  it('a panel-mounted meter is a meter, not a panel', () => {
    expect(sure('Panel mounted ammeter 0-100A')).toBe('Energy meters')
  })
  it('a "capacitive" sensor is not a capacitor', () => {
    expect(sure('Capacitive sensor M30')).toBe('Proximity sensors')
  })
  it('does not crash on odd input', () => {
    expect(inferCategory(undefined as unknown as string).confidence).toBe('none')
    expect(inferCategory('((( ))) ***').confidence).toBe('none')
  })
  it('exposes each canonical name once', () => {
    expect(new Set(CATEGORY_NAMES).size).toBe(CATEGORY_NAMES.length)
    expect(CATEGORY_NAMES.length).toBeGreaterThanOrEqual(45)
  })
})

describe('normaliseItemText (port of item_text_norm)', () => {
  it('drops standalone quantities, keeps model codes, strips punctuation', () => {
    expect(normaliseItemText('MCB S/P 32A (Schneider)')).toBe('mcb s p schneider')
    expect(normaliseItemText('PLC MITSUBISHI FX2N-128MR')).toBe('plc mitsubishi fx2n 128mr')
    expect(normaliseItemText('Hach HQ1110 portable')).toBe('hach hq1110 portable')
  })
})
