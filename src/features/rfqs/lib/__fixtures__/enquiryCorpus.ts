// R05 / audit E1: synthetic Pakistani B2B enquiry texts (WhatsApp and email) with the items a person would expect.
// No real customer data. Used by parseCorpus.test.ts, which also reports exact-match accuracy.

export interface CorpusItem {
  description: string
  qty: number
  unit: string | null
}
export interface CorpusCase {
  name: string
  text: string
  items: CorpusItem[]
}

const i = (description: string, qty = 1, unit: string | null = null): CorpusItem => ({ description, qty, unit })

export const ENQUIRY_CORPUS: CorpusCase[] = [
  {
    name: 'please quote, one line (the audit E1 case)',
    text: 'Please quote 2 nos pressure transmitter 0-10 bar',
    items: [i('pressure transmitter 0-10 bar', 2, 'nos')],
  },
  {
    name: 'sir please quote, trailing qty',
    text: 'Sir please quote ultrasonic level transmitter 0-10m qty 3',
    items: [i('ultrasonic level transmitter 0-10m', 3)],
  },
  {
    name: 'plz send rate',
    text: 'plz send rate for 5 pcs proximity sensor M18 PNP NO',
    items: [i('proximity sensor M18 PNP NO', 5, 'nos')],
  },
  {
    name: 'kindly quote with a courtesy line after',
    text: 'Kindly quote 10 nos 24V relay 8 pin\nPlease reply soon',
    items: [i('24V relay 8 pin', 10, 'nos')],
  },
  {
    name: 'pure courtesy only',
    text: 'Please reply soon\nKindly share best price\nThanks',
    items: [],
  },
  {
    name: 'salam sir then numbered list',
    text: 'Assalam o alaikum sir,\nplease quote the following:\n1) Siemens S7-1200 CPU 1214C - 1 no\n2) Omron E3Z-D62 photoelectric sensor - 6 nos\n3) 24V DC power supply 10A x 2\nRegards,\nBilal',
    items: [
      i('Siemens S7-1200 CPU 1214C', 1, 'nos'),
      i('Omron E3Z-D62 photoelectric sensor', 6, 'nos'),
      i('24V DC power supply 10A', 2),
    ],
  },
  {
    name: 'whatsapp dash bullets with polite lines',
    text: 'Bhai please quote\n- flow meter DN50 electromagnetic 2 nos\n- pH sensor Hach 1 pc\n- cable 4 core shielded 100 mtr\nkindly send price today',
    items: [i('flow meter DN50 electromagnetic', 2, 'nos'), i('pH sensor Hach', 1, 'nos'), i('cable 4 core shielded', 100, 'm')],
  },
  {
    name: 'plain lines, no markers, mixed qty styles',
    text: 'Hi\ntemperature transmitter PT100 4-20mA - 4 nos\nthermowell SS316 qty 4\n3 x pressure gauge 0-16 bar',
    items: [
      i('temperature transmitter PT100 4-20mA', 4, 'nos'),
      i('thermowell SS316', 4),
      i('pressure gauge 0-16 bar', 3),
    ],
  },
  {
    name: 'kindly quote then bullets with symbols',
    text: 'Kindly quote:\n• Rosemount 3051 transmitter x 2\n• Endress+Hauser Cerabar PMC51 x 1\n• manifold valve 3 way x 2',
    items: [i('Rosemount 3051 transmitter', 2), i('Endress+Hauser Cerabar PMC51', 1), i('manifold valve 3 way', 2)],
  },
  {
    name: 'please quote with qty at the start',
    text: 'Please quote 4 pcs Schneider contactor LC1D25 24V coil',
    items: [i('Schneider contactor LC1D25 24V coil', 4, 'nos')],
  },
  {
    name: 'pls quote qty colon',
    text: 'pls quote vibration sensor 4-20mA, qty: 8',
    items: [i('vibration sensor 4-20mA', 8)],
  },
  {
    name: 'kindly provide quotation for',
    text: 'Kindly provide quotation for 2 sets rotary encoder 1024 PPR',
    items: [i('rotary encoder 1024 PPR', 2, 'set')],
  },
  {
    name: 'urdu mix: bhai rate bata do',
    text: 'Bhai rate bata do\n1. VFD ABB ACS550 15kW - 1 no\n2. Line reactor 15kW - 1 no',
    items: [i('VFD ABB ACS550 15kW', 1, 'nos'), i('Line reactor 15kW', 1, 'nos')],
  },
  {
    name: 'email with headers and signature',
    text: 'From: purchase@plant.example\nTo: sales@supplier.example\nSubject: RFQ pumps\nDear Sir,\nPlease quote the following items.\n1. Grundfos CR5-8 pump - 2 nos\n2. Mechanical seal for CR5-8 - 4 nos\nBest regards\nPurchase Dept',
    items: [i('Grundfos CR5-8 pump', 2, 'nos'), i('Mechanical seal for CR5-8', 4, 'nos')],
  },
  {
    name: 'numbered with hash markers',
    text: '#1 level switch float type 1 no\n#2 solenoid valve 1/2 inch 24VDC 3 nos',
    items: [i('level switch float type', 1, 'nos'), i('solenoid valve 1/2 inch 24VDC', 3, 'nos')],
  },
  {
    name: 'excel paste, tab separated with header',
    text: 'S.No\tDescription\tQty\n1\tPressure switch 0-10 bar\t4\n2\tCheck valve 2 inch\t6',
    items: [i('Pressure switch 0-10 bar', 4), i('Check valve 2 inch', 6)],
  },
  {
    name: 'excel paste, description then qty and unit columns',
    text: 'Gate valve 4 inch class 150\t10\tnos\nGlobe valve 2 inch class 150\t5\tnos',
    items: [i('Gate valve 4 inch class 150', 10, 'nos'), i('Globe valve 2 inch class 150', 5, 'nos')],
  },
  {
    name: 'plz share quotation, courtesy first line',
    text: 'plz share quotation\n2 nos Fluke 87V multimeter\n1 no Fluke 289 logger',
    items: [i('Fluke 87V multimeter', 2, 'nos'), i('Fluke 289 logger', 1, 'nos')],
  },
  {
    name: 'sir with comma then item inline',
    text: 'Sir, 3 nos limit switch Omron D4N',
    items: [i('limit switch Omron D4N', 3, 'nos')],
  },
  {
    name: 'kindly confirm availability is courtesy',
    text: 'Please quote 1 no Yokogawa EJA110E\nKindly confirm availability and delivery',
    items: [i('Yokogawa EJA110E', 1, 'nos')],
  },
  {
    name: 'thanks and regards',
    text: 'Please quote 2 nos gas detector\nThank you\nBest regards',
    items: [i('gas detector', 2, 'nos')],
  },
  {
    name: 'please find attached is courtesy',
    text: 'Dear Sir,\nPlease find attached our enquiry.\nKindly quote at the earliest.',
    items: [],
  },
  {
    name: 'metres and rolls',
    text: 'Please quote\n1) armoured cable 3Cx2.5mm 500 mtr\n2) cable tie 200mm 5 rolls',
    items: [i('armoured cable 3Cx2.5mm', 500, 'm'), i('cable tie 200mm', 5, 'roll')],
  },
  {
    name: 'plzz with brand and model',
    text: 'plzz quote Endress+Hauser Promass 83F DN25 qty 1',
    items: [i('Endress+Hauser Promass 83F DN25', 1)],
  },
  {
    name: 'kindly quote our requirement list, three items',
    text: 'Kindly quote our requirement\n1. Bearing SKF 6205 - 20 pcs\n2. Bearing SKF 6309 - 10 pcs\n3. Grease SKF LGMT2 - 5 kg',
    items: [i('Bearing SKF 6205', 20, 'nos'), i('Bearing SKF 6309', 10, 'nos'), i('Grease SKF LGMT2', 5, 'kg')],
  },
  {
    name: 'sir please arrange rate',
    text: 'Sir please arrange rate for 2 nos load cell 5 ton',
    items: [i('load cell 5 ton', 2, 'nos')],
  },
  {
    name: 'please quote best price for, trailing x',
    text: 'Please quote best price for pH electrode Hach PHC101 x 3',
    items: [i('pH electrode Hach PHC101', 3)],
  },
  {
    name: 'request you to quote the below',
    text: 'We request you to quote the below:\nControl valve 3 inch pneumatic 1 no\nPositioner ABB 1 no',
    items: [i('Control valve 3 inch pneumatic', 1, 'nos'), i('Positioner ABB', 1, 'nos')],
  },
  {
    name: 'sir please quote, one item no qty',
    text: 'Sir please quote Siemens LOGO 8 PLC',
    items: [i('Siemens LOGO 8 PLC')],
  },
  {
    name: 'kindly quote 5 nos plain',
    text: 'Kindly quote 5 nos 4-20mA loop indicator',
    items: [i('4-20mA loop indicator', 5, 'nos')],
  },
]
