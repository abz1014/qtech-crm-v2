// Builds import/fixtures/legacy/dump.json: a SYNTHETIC copy of the old database, shaped like the old schema.
//   node import/fixtures/build-legacy-dump.mjs
// Every name, number and amount here is made up. gst_invoices.amount INCLUDES GST (net = amount - gst_amount), as in the old register.
//  Only the shapes the acceptance rows name are reused ("Northgate Glass" with
// three rows, "Red Lion USA (via Four Stars)", the "31/01/2024" due date, PO 000001 Unit A and Unit B). Phone numbers
// and e-mail addresses are obviously fake (reserved .invalid domain).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const PREFIX = {
  users: 'a1', clients: 'c1', prospects: 'c2', vendors: 'd1', rfqs: 'f1', lines: 'f2', inquiries: 'f3', quotes: 'f4',
  orders: '01', engineers: '02', gst: '03', invoices: '04', pay: '05', payrec: '06', suppay: '07', payables: '08',
  payablepay: '09', expenses: '0a', recurring: '0b',
}
const id = (kind, n) => `${PREFIX[kind]}000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ts = (n) => `2024-10-01T${String(8 + Math.floor(n / 60) % 12).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00+00:00`

const tables = {}

// ---------------------------------------------------------------- users
tables.users = [
  { id: id('users', 1), name: 'Old Admin', email: 'admin@example.invalid', role: 'admin' },
  { id: id('users', 2), name: 'Old Sales', email: 'sales@example.invalid', role: 'sales' },
  { id: id('users', 3), name: 'Old Engineer', email: 'engineer@example.invalid', role: 'engineer' },
  { id: id('users', 4), name: 'Former Staff', email: 'former@example.invalid', role: 'sales' },
]
const ADMIN = id('users', 1)
const SALES = id('users', 2)
const ENG = id('users', 3)
const GONE = id('users', 4)

// ---------------------------------------------------------------- clients (11 rows -> 9 companies)
const clientNames = [
  ['Alpha Textile Mills Head Office', 'Textile', 'Test Contact One', '+92 300 0000001', 'one@example.invalid', 'Plot 1, Test Road, Karachi'],
  ['Northgate Glass (KHI)', 'Glass', 'Test Contact Two', '+92 300 0000002', '', 'Test Estate, Karachi'],
  ['Northgate Glass (LHR)', 'Glass', '', '', '', 'Test Estate, Lahore'],
  ['Northgate Glass', 'Glass', '', '', '', 'Pakistan'],
  ['Beta Dairy Foods', 'Dairy', 'Test Contact Three', '', 'three@example.invalid', 'Pakistan'],
  ['Gamma Cement', 'Cement', '', '', '', 'Pakistan'],
  ['Delta Chemicals', 'Chemicals', '', '+92 300 0000004', '', 'Pakistan'],
  ['Epsilon Weaving', 'Textile', '', '', '', ''],
  ['Zeta Fibres Limited', 'Fibres', 'Test Contact Four', '+92 300 0000005', 'four@example.invalid', 'Pakistan'],
  ['Eta Foods', 'Food', '', '', '', 'Pakistan'],
  ['Theta Finishing Mills', 'Textile', '', '', '', 'Pakistan'],
]
tables.clients = clientNames.map((c, i) => ({
  id: id('clients', i + 1), company_name: c[0], industry: c[1], contact_person: c[2], phone: c[3], email: c[4], address: c[5],
  created_by: ADMIN, created_at: ts(i),
}))
const C = Object.fromEntries(['alpha', 'ghkhi', 'ghlhr', 'gh', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'].map((k, i) => [k, id('clients', i + 1)]))

tables.prospects = [
  { id: id('prospects', 1), company_name: 'Gamma Cement', contact_person: '', phone: '', email: '', lead_source: 'Referral', status: 'warm', follow_up_date: '', assigned_to: ADMIN, converted_client_id: C.gamma, created_at: ts(1) },
  { id: id('prospects', 2), company_name: 'Iota Packaging', contact_person: 'Test Contact Five', phone: '+92 300 0000006', email: '', lead_source: 'Trade fair', status: 'hot', follow_up_date: '2025-03-01', assigned_to: SALES, converted_client_id: null, created_at: ts(2) },
  { id: id('prospects', 3), company_name: 'ZETA FIBRES LTD', contact_person: '', phone: '', email: '', lead_source: '', status: 'cold', follow_up_date: '', assigned_to: null, converted_client_id: null, created_at: ts(3) },
]

// ---------------------------------------------------------------- vendors
const vendorRows = [
  ['Meacon Instruments', 'China', 'Ultrasonic Flow Meters, Flow Meter'],
  ['Eurofilter GmbH', 'Germany', 'Pneumatics / Air Filters, Filter inserts'],
  ['PORTVIEW TONGDA (Moxa Taiwan)', 'China / Taiwan', 'Industrial Networking'],
  ['ORVEN China (Siemens Distributor)', 'China', 'Automation / PLC'],
  ['Red Lion USA (via Four Stars)', 'USA', 'Sensors'],
  ['Strongman Meters', 'China', 'Flow Meter'],
  ['Heibi Analytics', 'China', 'Analyser'],
  ['Goffran Sensors / ECIS UAE', 'Italy / UAE', 'Sensors, Position Transmitters'],
  ['Shandong Safety Co', 'China', 'Safety Equipment'],
  ['Tecto Systems', 'Turkey', 'Pumps'],
]
tables.vendors = vendorRows.map((v, i) => ({
  id: id('vendors', i + 1), name: v[0], country: v[1], contact_person: '', phone: '', email: '', products_supplied: v[2], created_at: ts(i),
}))
const V = Object.fromEntries(['meacon', 'euro', 'portview', 'orven', 'redlion', 'strong', 'heibi', 'goffran', 'shandong', 'tecto'].map((k, i) => [k, id('vendors', i + 1)]))

// ---------------------------------------------------------------- orders (17 -> 16)
const O = {}
const ord = (key, n, o) => {
  O[key] = id('orders', n)
  return {
    id: O[key], client_id: null, vendor_id: null, sales_person_id: ADMIN, product_type: '', order_value: 0, cost_value: 0,
    status: 'po_received', notes: '', confirmed_date: null, rfq_id: null, customer_po_number: null, customer_po_date: null,
    payment_terms_days: 30, delivery_date: null, payment_due_date: null, invoice_number: null, invoice_date: null,
    order_gst_amount: null, ops_dismissed: false, created_at: ts(100 + n), updated_at: ts(100 + n), ...o,
  }
}
tables.orders = [
  ord('o1', 1, { client_id: C.zeta, vendor_id: V.meacon, product_type: 'Flow Meter', order_value: 370000, cost_value: 87150, status: 'completed', notes: 'PO# 251809. Wallmount Ultrasonic Flow Meter x1. Received & delivered.', confirmed_date: '2024-10-11T00:00:00+00:00', customer_po_number: '251809' }),
  ord('o2', 2, { client_id: C.zeta, vendor_id: V.meacon, product_type: 'Flow Meter', order_value: 1244310, cost_value: 387420, status: 'completed', notes: 'PO# 252446. Wallmount Ultrasonic Flow Meter x3. Received & delivered.', customer_po_date: '2024-10-25', customer_po_number: '252446', delivery_date: '2024-11-20' }),
  ord('o3', 3, { client_id: C.beta, vendor_id: V.meacon, product_type: 'Flow Meter', order_value: 240000, cost_value: 159390, status: 'payment_received', notes: 'PO# 225. Portable Ultrasonic Flow Meter x1. Received, delivered & payment received.', confirmed_date: '2024-10-11', customer_po_number: '225' }),
  ord('o4', 4, { client_id: C.gamma, vendor_id: V.strong, product_type: 'Flow Meter', order_value: 355319, cost_value: 261784, status: 'payment_received', notes: 'PO# 010395-1. Electromagnetic Flow Meter x1. Final remaining payment received 08-01-2025.', confirmed_date: '2024-09-20', customer_po_number: '010395-1' }),
  ord('o5', 5, { client_id: C.zeta, vendor_id: V.euro, product_type: 'Pneumatics / Air Filters', order_value: 650163, cost_value: 370000, status: 'completed', notes: 'PO# 248504. Compressed Air Filters and Filter Inserts x5. Received, delivered & payment received.', confirmed_date: '2024-08-02', customer_po_number: '248504', invoice_number: 'INV-0004', invoice_date: '2024-08-20' }),
  ord('o6', 6, { client_id: C.delta, vendor_id: V.heibi, product_type: 'Analyser', order_value: 212659, cost_value: 116950, status: 'procurement', notes: 'PO# PO250105. Conductivity Meter and Sensor x1. Arrangement for delivery in process.', customer_po_number: 'PO250105', delivery_date: '2025-02-10', rfq_id: null }),
  ord('o7', 7, { client_id: C.zeta, vendor_id: V.portview, product_type: 'Industrial Networking', order_value: 73986, cost_value: 50108, status: 'completed', notes: 'PO# 000001 (Unit A). Moxa Serial-Ethernet Converter x2. Received & delivered.', customer_po_date: '2024-12-02', customer_po_number: '000001', delivery_date: '2024-12-20' }),
  ord('o8', 8, { client_id: C.zeta, vendor_id: V.portview, product_type: 'Industrial Networking', order_value: 73986, cost_value: 50108, status: 'completed', notes: 'PO# 000001 (Unit B). Moxa Serial-Ethernet Converter x2. Received & delivered.', customer_po_date: '2024-12-05', customer_po_number: '000001', delivery_date: '2024-12-24' }),
  ord('o9', 9, { client_id: C.zeta, vendor_id: V.portview, product_type: 'Industrial Networking', order_value: 73986, cost_value: 50108, status: 'completed', notes: 'Batch A. Moxa Serial-Ethernet Converter x2. Received & delivered.', confirmed_date: '2024-12-10T00:00:00+00:00' }),
  ord('o10', 10, { client_id: C.zeta, vendor_id: V.portview, product_type: 'Industrial Networking', order_value: 73986, cost_value: 50108, status: 'completed', notes: 'Batch B. Moxa Serial-Ethernet Converter x2. Received & delivered.', customer_po_date: '2024-12-12', customer_po_number: '90222' }),
  ord('o11', 11, { client_id: C.gamma, vendor_id: V.orven, product_type: 'Automation / PLC', order_value: 617258, cost_value: 464712, status: 'completed', notes: 'PO# 010801-1. Siemens CPU x1. Received & delivered. Remaining receivable pending.', confirmed_date: '2024-10-07', customer_po_number: '010801-1' }),
  ord('o12', 12, { client_id: C.beta, vendor_id: V.shandong, product_type: 'Safety Equipment', order_value: 290222, cost_value: 238260, status: 'completed', notes: 'X-Ray Curtains x2. Received & delivered.', confirmed_date: '2024-11-02' }),
  ord('o13', 13, { client_id: C.theta, vendor_id: V.tecto, product_type: 'Pumps', order_value: 177000, cost_value: 200000, status: 'in_transit', notes: 'PO# TF-7788. Dosing pump x2. Note: 200,000 total landing.', confirmed_date: '2025-01-15', customer_po_number: 'TF-7788', delivery_date: '2025-03-01' }),
  ord('o14', 14, { client_id: C.epsilon, vendor_id: null, product_type: 'Valves', order_value: 95000, cost_value: 60000, status: 'po_received', notes: 'PO# EW-1. Control valves x4.', confirmed_date: '2025-01-20', customer_po_number: 'EW-1' }),
  ord('o15', 15, { client_id: C.eta, vendor_id: V.goffran, product_type: 'Sensors', order_value: 120000, cost_value: 80000, status: 'payment_received', notes: 'PO# EF-22. Position sensors x6.', confirmed_date: '2025-01-05', customer_po_number: 'EF-22' }),
  ord('o16', 16, { client_id: C.alpha, vendor_id: V.redlion, sales_person_id: SALES, product_type: 'Actuators', order_value: 88000, cost_value: 50000, status: 'completed', notes: 'PO# AT-501. Actuators x2 with commissioning.', confirmed_date: '2025-01-12', customer_po_number: 'AT-501', delivery_date: '2025-02-02' }),
  ord('o17', 17, { client_id: C.alpha, vendor_id: null, sales_person_id: SALES, product_type: 'Gauges', order_value: 40000, cost_value: 30000, status: 'po_received', notes: 'PO# AT-502. Pressure gauges x10.', confirmed_date: '2025-02-15', customer_po_number: 'AT-502' }),
  // Paid status with no payment rows, and bookkeeping invoices that repeat the GST register (owner decision 2026-10-19).
  ord('o18', 18, { client_id: C.ghlhr, product_type: 'Sensors', order_value: 100000, cost_value: 60000, status: 'payment_received', notes: 'PO# 7001. Level sensors x2.', confirmed_date: '2025-01-02', customer_po_number: '7001' }),
  ord('o19', 19, { client_id: C.ghkhi, product_type: 'Sensors', order_value: 50000, cost_value: 30000, status: 'delivered', notes: 'PO# 7002. Flow switches x2.', confirmed_date: '2025-01-03', customer_po_number: '7002' }),
  ord('o20', 20, { client_id: C.delta, product_type: 'Analyser', order_value: 30000, cost_value: 20000, status: 'delivered', notes: 'PO# 7003. pH probe x1.', confirmed_date: '2025-01-04', customer_po_number: '7003' }),
  ord('o21', 21, { client_id: C.theta, product_type: 'Pumps', order_value: 80000, cost_value: 50000, status: 'payment_received', notes: 'PO# 8100. Pump seals x4.', confirmed_date: '2025-01-06', customer_po_number: '8100', payment_due_date: '2025-02-20' }),
  ord('o22', 22, { client_id: C.epsilon, product_type: 'Valves', order_value: 60000, cost_value: 40000, status: 'payment_received', notes: 'PO# EW-9. Valve kits x3.', confirmed_date: '2025-01-07', customer_po_number: 'EW-9', payment_terms_days: 45 }),
]

// ---------------------------------------------------------------- RFQs, items, inquiries, quotes
const rfq = (n, o) => ({
  id: id('rfqs', n), rfq_number: null, client_id: null, company_name: '', contact_person: '', phone: '', email: '', rfq_date: '2025-01-10',
  estimated_value: 0, assigned_to: ADMIN, priority: 'medium', status: 'new', notes: '', converted_order_id: null, quoted_price: 0,
  quote_sent_date: null, quote_expiry_date: null, quote_deadline: null, loss_reason: null, loss_notes: null, created_at: ts(200 + n), ...o,
})
tables.rfqs = [
  rfq(1, { client_id: C.zeta, rfq_number: 'PR-4521', rfq_date: '2024-09-20', quote_deadline: '2024-10-01', priority: 'high', status: 'converted', quote_sent_date: '2024-09-28', converted_order_id: O.o2, notes: 'Two flow meters.' }),
  rfq(2, { client_id: C.ghkhi, rfq_date: '2025-01-12', status: 'in_progress', notes: 'Proximity sensors. Due: 31/01/2024', contact_person: 'Test Contact Two', phone: '+92 300 0000002' }),
  rfq(3, { client_id: C.beta, rfq_date: '2024-10-20', status: 'lost', quote_sent_date: '2024-11-05', loss_reason: 'competitor_won', loss_notes: 'Went with a local dealer.' }),
  rfq(4, { client_id: C.gamma, rfq_date: '2024-03-01', status: 'quoted', quote_sent_date: null, notes: 'Quoted long ago, no reply.' }),
  rfq(5, { client_id: C.delta, rfq_number: 'RFQ-0005', rfq_date: '2024-12-01', status: 'converted', quote_sent_date: '2024-12-10', converted_order_id: O.o6 }),
  rfq(6, { client_id: null, company_name: 'Kappa Textiles', contact_person: 'Test Contact Six', phone: '+92 300 0000007', email: 'six@example.invalid', rfq_date: '2025-02-01', status: 'new' }),
  rfq(7, { client_id: null, company_name: '', rfq_date: '2025-02-02', status: 'new', notes: 'Nobody known.' }),
  rfq(8, { client_id: C.eta, rfq_date: 'garbage', status: 'new' }),
  rfq(9, { client_id: C.epsilon, rfq_date: '2024-11-01', status: 'lost', loss_reason: 'poor_follow_up' }),
  rfq(10, { client_id: C.theta, rfq_date: '2024-11-03', status: 'lost', loss_reason: 'price', quote_sent_date: '2024-11-09' }),
  rfq(11, { rfq_number: 'RFQ-0177', client_id: C.alpha, rfq_date: '2024-11-04', status: 'lost', loss_reason: null, assigned_to: SALES }),
  rfq(12, { client_id: C.beta, rfq_date: '2025-01-20', status: 'in_progress', notes: 'Floated to 3 suppliers, could not find offer for item 2.' }),
  rfq(13, { client_id: C.zeta, rfq_number: 'PR-4521', rfq_date: '2025-01-22', status: 'new', notes: 'Same customer number as RFQ 1.' }),
  rfq(14, { rfq_number: 'QT-0042', client_id: C.gamma, rfq_date: '2025-02-03', status: 'new', priority: 'low', assigned_to: SALES }),
  rfq(15, { client_id: C.delta, rfq_date: '2025-02-04', status: 'in_progress', assigned_to: SALES }),
  rfq(16, { client_id: C.eta, rfq_date: '2025-02-05', status: 'new', assigned_to: null }),
  rfq(17, { client_id: C.theta, rfq_date: '2025-02-06', status: 'quoted', quote_sent_date: '2025-02-10', assigned_to: SALES }),
]
tables.orders.find(o => o.id === O.o2).rfq_id = id('rfqs', 1)

const line = (n, rfqN, product_type, quantity, specification) => ({ id: id('lines', n), rfq_id: id('rfqs', rfqN), product_type, quantity, specification, target_price: null, created_at: ts(300 + n) })
tables.rfq_line_items = [
  line(1, 1, 'Flow Meter', 2, 'Wallmount ultrasonic flow meter, DN50'),
  line(2, 1, 'Flow Meter', 1, 'Portable ultrasonic flow meter'),
  line(3, 2, 'Sensors', 4, 'Proximity sensor M18 NPN'),
  line(4, 3, 'Pumps', 2, 'Dosing pump 10 bar'),
  line(5, 4, 'Analyser', 1, 'pH analyser with probe'),
  line(6, 5, 'Analyser', 1, 'Conductivity meter and sensor'),
  line(7, 6, 'Valves', 3, 'Ball valve 2 inch SS316'),
  line(8, 9, 'Valves', 2, 'Control valve DN25'),
  line(9, 10, 'Pumps', 1, 'Dosing pump 10 bar'),
  line(10, 12, 'Sensors', 2, 'Pressure transmitter 0-10 bar'),
  line(11, 12, 'Sensors', 2, 'Level sensor 4-20mA'),
  line(12, 13, 'Flow Meter', 1, 'Wallmount ultrasonic flow meter, DN50'),
  line(13, 14, 'Gauges', 10, 'Pressure gauge 0-16 bar'),
  line(14, 17, 'Safety Equipment', 2, 'Light curtain 1200mm'),
  line(15, 15, '', 1, ''),
  { ...line(16, 16, 'Sensors', 0, 'Quantity missing in old data') },
]

const inq = (n, rfqN, vendor, sent_at, status) => ({ id: id('inquiries', n), rfq_id: id('rfqs', rfqN), vendor_id: vendor, sent_at, status, email_draft: 'Dear supplier, please quote...', follow_up_date: null, created_at: ts(400 + n) })
tables.supplier_inquiries = [
  inq(1, 1, V.meacon, '2024-09-21', 'responded'),
  inq(2, 1, V.strong, '2024-09-21', 'responded'),
  inq(3, 1, V.meacon, '2024-09-22', 'pending'),
  inq(4, 2, V.euro, '', 'pending'),
  inq(5, 2, id('vendors', 99), '2025-01-13', 'pending'),
  inq(6, 3, V.tecto, 'sometime in November', 'no_response'),
  inq(7, 4, V.heibi, '2024-03-02', 'pending'),
]
const quote = (n, rfqN, vendor, inquiry, unit_price, currency, lead_time_days, received_at) => ({
  id: id('quotes', n), rfq_id: id('rfqs', rfqN), vendor_id: vendor, inquiry_id: inquiry ? id('inquiries', inquiry) : null,
  received_at, unit_price, currency, lead_time_days, moq: 1, validity_days: 30, notes: '', is_selected: false, created_at: ts(500 + n),
})
tables.supplier_quotes = [
  quote(1, 1, V.meacon, 1, 5000, 'USD', 14, '2024-09-24'),
  quote(2, 1, V.strong, 2, 4200, 'PKR', 0, '2024-09-25'),
  quote(3, 1, V.meacon, 3, 4900, 'USD', 21, '2024-09-30'),
  quote(4, 3, V.tecto, null, 0, 'PKR', 10, '2024-10-30'),
  quote(5, 4, V.heibi, 7, 900, 'us', 30, '2024-03-10'),
  quote(6, 3, V.strong, null, 750, 'EUR', 7, '2024-10-31'),
]

tables.order_engineers = [
  { id: id('engineers', 1), order_id: O.o16, engineer_id: ENG, site_location: 'Karachi plant', start_date: '2025-01-20', expected_completion: '2025-02-05', commissioning_status: 'completed', created_at: ts(600) },
  { id: id('engineers', 2), order_id: O.o17, engineer_id: ENG, site_location: '', start_date: '2025-02-10', expected_completion: '', commissioning_status: 'in_progress', created_at: ts(601) },
  { id: id('engineers', 3), order_id: O.o17, engineer_id: GONE, site_location: '', start_date: '', expected_completion: '', commissioning_status: 'pending', created_at: ts(602) },
  { id: id('engineers', 4), order_id: O.o16, engineer_id: ENG, site_location: 'Karachi plant', start_date: '2025-01-20', expected_completion: '2025-02-05', commissioning_status: 'completed', created_at: ts(603) },
]

// ---------------------------------------------------------------- GST register
const gst = (n, o) => ({
  id: id('gst', n), order_id: null, gst_invoice_number: '', invoice_date: '2024-11-01', client_name: '', supplier_company: 'Q-Tech Test', customer_po_number: '',
  item_name: '', item_number: '', product_detail: '', delivery_challan_number: '', amount: 0, gst_amount: 0, received_date: '', tcs_sent_date: '',
  tcs_receipt_number: '', tcs_receipt_date: '', client_received_date: '', fbr_status: 'Pending', wasif_receipt_received: false, wasif_receipt_date: '',
  wasif_receipt_file_path: null, psid: '', tax_deposit_date: '', tax_deposit_amount: 0, tax_deposit_bank: '', notes: null, created_at: ts(700 + n), ...o,
})
tables.gst_invoices = [
  gst(1, { order_id: O.o1, gst_invoice_number: 'INV-2024-0101', invoice_date: '2024-10-15', amount: 436600, gst_amount: 66600, received_date: '2024-10-20', tcs_sent_date: '2024-10-21', tcs_receipt_number: 'TCS-1', tcs_receipt_date: '2024-10-21', client_received_date: '2024-10-25', fbr_status: 'Deposited', wasif_receipt_received: true, wasif_receipt_date: '2024-11-05', psid: 'PSID-100001', tax_deposit_date: '2024-11-10', tax_deposit_amount: 66600, tax_deposit_bank: 'Test Bank', wasif_receipt_file_path: 'receipts/g1.pdf' }),
  gst(2, { order_id: O.o2, gst_invoice_number: 'INV-2024-0102', invoice_date: '2024-11-22', amount: 1468285.8, gst_amount: 223975.8, fbr_status: 'Receipt Received', wasif_receipt_received: true, wasif_receipt_date: '2024-12-01', psid: 'PSID-100002' }),
  gst(3, { order_id: O.o3, gst_invoice_number: 'INV-2024-0103', invoice_date: '2024-10-30', amount: 283200, gst_amount: 43200, fbr_status: 'Fully Generated', psid: 'PSID-100003', tcs_sent_date: '2024-11-02', tcs_receipt_date: '2024-11-03' }),
  gst(4, { order_id: O.o7, gst_invoice_number: 'INV-0001', invoice_date: '2024-12-22', amount: 87303.48, gst_amount: 13317.48 }),
  gst(5, { order_id: O.o8, gst_invoice_number: 'INV-0009', invoice_date: '2024-12-26', amount: 87303.48, gst_amount: 13317.48 }),
  gst(6, { order_id: O.o16, gst_invoice_number: 'INV-2025-0201', invoice_date: '2025-02-03', amount: 103840, gst_amount: 15840, fbr_status: 'Generated', psid: '', wasif_receipt_file_path: 'receipts/missing.pdf' }),
  gst(7, { order_id: null, gst_invoice_number: 'INV-0077', invoice_date: '2025-02-30', client_name: 'Gamma Cement', amount: 59000, gst_amount: 9000, fbr_status: 'Deposited', psid: 'PSID-100007' }),
  gst(8, { order_id: O.o13, gst_invoice_number: 'INV-2025-0105', invoice_date: '2025-01-30', amount: 177000, gst_amount: 27000, fbr_status: 'Pending' }),
  gst(9, { order_id: null, gst_invoice_number: 'INV-0099', invoice_date: '2025-02-01', client_name: '', amount: 1180, gst_amount: 180 }),
  // One register row for three POs, typed loosely; the Delta PO 7003 belongs to another customer.
  gst(10, { order_id: null, gst_invoice_number: 'INV-2025-0301', invoice_date: '2025-01-20', client_name: 'Northgate Glass (LHR)', customer_po_number: ' po 7001 &7002 & 7003', amount: 177000, gst_amount: 27000 }),
  gst(11, { order_id: null, gst_invoice_number: 'INV-2025-0302', invoice_date: '2025-01-25', client_name: 'Theta Finishing Mills', customer_po_number: '8100', amount: 94400, gst_amount: 14400 }),
]

// ---------------------------------------------------------------- bookkeeping invoices and payments
const inv = (n, o) => ({ invoice_id: id('invoices', n), invoice_number: '', client_id: null, order_id: null, rfq_id: null, invoice_amount: 0, issued_date: '', due_date: '', payment_status: 'Pending', amount_paid: 0, payment_method: null, created_at: ts(800 + n), notes: null, ...o })
tables.invoices = [
  inv(1, { invoice_number: 'INV-B-15', order_id: O.o15, client_id: C.eta, invoice_amount: 120000, issued_date: '2025-01-10', amount_paid: 120000, payment_status: 'Paid' }),
  inv(2, { invoice_number: 'INV-B-11', order_id: O.o11, client_id: C.gamma, invoice_amount: 617258, issued_date: '2024-10-20', amount_paid: 357360, payment_status: 'Partial' }),
  inv(3, { invoice_number: 'INV-0001', order_id: O.o14, client_id: C.epsilon, invoice_amount: 95000, issued_date: '2025-01-25' }),
  inv(4, { invoice_number: 'INV-B-01', order_id: O.o1, client_id: C.zeta, invoice_amount: 370000, issued_date: '2024-10-15' }),
  inv(6, { invoice_number: 'INV-B-77', client_id: C.gamma, invoice_amount: 5000, issued_date: '2025-02-10' }), // no order link
  inv(5, { invoice_number: 'INV-B-05', order_id: O.o5, client_id: C.zeta, invoice_amount: 650163, issued_date: '2024-08-20' }),
  inv(7, { invoice_number: 'INV-B-701', order_id: O.o18, client_id: C.ghlhr, invoice_amount: 100000, issued_date: '2025-01-20', due_date: '2025-02-10', payment_status: 'Paid', amount_paid: 100000, notes: 'PO 7001. Level sensors.' }),
  inv(8, { invoice_number: 'INV-B-702', order_id: O.o19, client_id: C.ghkhi, invoice_amount: 50000, issued_date: '2025-01-20', payment_status: 'Paid', amount_paid: 50000, notes: '  po#7002  ' }),
  inv(9, { invoice_number: 'INV-B-703', order_id: O.o20, client_id: C.delta, invoice_amount: 30000, issued_date: '2025-01-21', notes: 'PO 7003.' }),
  inv(10, { invoice_number: 'INV-B-810', order_id: O.o21, client_id: C.theta, invoice_amount: 80000, issued_date: '2025-01-25', due_date: '2025-04-15', payment_status: 'Partial', amount_paid: 50000, notes: 'PO 8100.' }),
  inv(11, { invoice_number: 'INV-B-22', order_id: O.o22, client_id: C.epsilon, invoice_amount: 60000, issued_date: '2025-01-10' }),
  inv(12, { invoice_number: 'INV-B-31', client_id: C.alpha, invoice_amount: 7000, issued_date: '2025-01-15', payment_status: 'Paid', amount_paid: 7000 }), // paid, no order
]
const pay = (n, order, amount, payment_date, extra = {}) => ({ id: id('pay', n), order_id: order, amount, payment_date, payment_method: 'Bank Transfer', reference: `REF-${n}`, notes: null, recorded_by: ADMIN, created_at: ts(900 + n), ...extra })
tables.order_payments = [
  pay(1, O.o3, 283200, '2024-12-20'),
  pay(2, O.o4, 300000, '2024-11-30'),
  pay(3, O.o4, 119276.42, '08/01/2025'),
  pay(4, O.o5, 767192.34, '2024-09-20'),
  pay(5, O.o7, 87303.48, '2024-12-28'),
  pay(6, O.o8, 87303.48, '2025-01-03'),
  pay(7, O.o1, 436600, '2024-11-20'),
  pay(8, O.o2, 1468285.8, 'not a date'),
  pay(9, O.o11, 357360, '2024-12-15'),
  pay(10, O.o10, 0, '2025-01-01'),
  pay(11, id('orders', 99), 5000, '2025-01-02'),
  pay(12, O.o16, 103840, '2025-02-20'),
]
tables.payment_records = [
  { payment_id: id('payrec', 1), invoice_id: id('invoices', 2), amount: 357360, payment_date: '2024-12-15', payment_method: 'Bank', notes: null, recorded_by: ADMIN, created_at: ts(950) },
  { payment_id: id('payrec', 2), invoice_id: id('invoices', 1), amount: 1000, payment_date: '2025-02-01', payment_method: 'Cash', notes: 'Small adjustment', recorded_by: ADMIN, created_at: ts(951) },
]

// ---------------------------------------------------------------- money out
const sp = (n, order, amount, payment_date) => ({ id: id('suppay', n), order_id: order, amount, payment_date, payment_method: 'Bank Transfer', reference: `SP-${n}`, notes: null, recorded_by: ADMIN, created_at: ts(1000 + n) })
tables.supplier_payments = [
  sp(1, O.o1, 87150, '2024-10-20'),
  sp(2, O.o12, 238260, '2024-11-20'),
  sp(3, O.o7, 50108, '2024-12-10'),
  sp(4, O.o8, 50108, '2024-12-12'),
  sp(5, O.o10, 50108, '2024-12-20'),
]
tables.payables = [
  { payable_id: id('payables', 1), vendor_id: V.meacon, amount: 87150, due_date: '2024-10-30', payment_status: 'Paid', amount_paid: 87150, payment_date: '2024-10-20', linked_expense_id: null, invoice_reference: 'MC-1', payment_method: 'Bank', created_at: ts(1100) },
  { payable_id: id('payables', 2), vendor_id: V.euro, amount: 15000, due_date: '2024-09-05', payment_status: 'Paid', amount_paid: 15000, payment_date: '2024-09-01', linked_expense_id: id('expenses', 3), invoice_reference: 'EU-7', payment_method: 'Bank', created_at: ts(1101) },
]
tables.payable_payments = [
  { payment_id: id('payablepay', 1), payable_id: id('payables', 1), amount: 87150, payment_date: '2024-10-20', payment_method: 'Bank', reference_number: 'PP-1', notes: null, recorded_by: ADMIN, created_at: ts(1110) },
  { payment_id: id('payablepay', 2), payable_id: id('payables', 2), amount: 15000, payment_date: '2024-09-01', payment_method: 'Bank', reference_number: 'PP-2', notes: null, recorded_by: ADMIN, created_at: ts(1111) },
]
const exp = (n, category, amount, date, o = {}) => ({ expense_id: id('expenses', n), date, amount, category, description: `${category} (test)`, vendor_id: null, rfq_id: null, order_id: null, created_by: ADMIN, created_at: ts(1200 + n), notes: null, recurring_id: null, period: null, ...o })
tables.expenses = [
  exp(1, 'Rent', 120000, '2024-10-01'),
  exp(2, 'Petrol', 5000, '2024-10-03'),
  exp(3, 'Inventory/Procurement', 238260, '2024-11-18', { order_id: O.o12 }),
  exp(4, 'Misc stuff', 2000, '2024-10-09'),
  exp(5, 'Salaries', 300000, '2024-10-31', { recurring_id: id('recurring', 1), period: '2024-10' }),
  exp(6, 'Salaries', 300000, '2024-11-30', { recurring_id: id('recurring', 1), period: '2024-11' }),
  exp(7, 'Salaries', 300000, '2024-11-30', { recurring_id: id('recurring', 1), period: '2024-11' }),
  exp(8, 'Rent', -50, '2024-11-01'),
  exp(9, 'Utilities', 15000, 'yesterday'),
  exp(10, 'Salaries', 300000, '31/12/2024'),
  exp(11, 'Freight', 18000, '2024-11-12', { order_id: O.o9, vendor_id: V.portview }),
]
tables.recurring_expenses = [
  { id: id('recurring', 1), label: 'Staff salaries', category: 'Salaries', amount: 300000, day_of_month: 25, active: true, start_month: '', notes: null, created_by: ADMIN, created_at: ts(1300) },
  { id: id('recurring', 2), label: 'Office rent', category: 'Rent', amount: 120000, day_of_month: 31, active: true, start_month: '2024-10', notes: null, created_by: ADMIN, created_at: ts(1301) },
]

// Tables the new model drops by design (rows only so the report can count them).
tables.follow_up_actions = [{ id: id('rfqs', 900), action_type: 'chase', title: 'Chase', status: 'pending', created_at: ts(1400) }]
tables.quarterly_targets = [{ id: id('rfqs', 901), year: 2025, quarter: 1, target_value: 5000000 }]
tables.documents = []

const dump = {
  meta: { made_by: 'import/fixtures/build-legacy-dump.mjs', note: 'SYNTHETIC fixture. Not real data.' },
  tables,
  storage: [{ bucket: 'gst-receipts', path: 'receipts/g1.pdf', size_bytes: 36, mime_type: 'application/pdf' }],
}

const dir = join(here, 'legacy')
mkdirSync(join(dir, 'storage', 'gst-receipts', 'receipts'), { recursive: true })
writeFileSync(join(dir, 'dump.json'), JSON.stringify(dump, null, 1) + '\n')
writeFileSync(join(dir, 'storage', 'gst-receipts', 'receipts', 'g1.pdf'), '%PDF-1.4 synthetic fixture receipt\n')
console.log('wrote', join(dir, 'dump.json'))
