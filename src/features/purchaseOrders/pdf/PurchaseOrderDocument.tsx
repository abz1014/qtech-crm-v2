import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { PoPdfData } from '@/features/purchaseOrders/api'
import { currencyInWords, poLineAmounts, STANDARD_TERMS, unitPriceText } from '@/features/purchaseOrders/lib/prefill'
import { termLines } from '@/features/quotations/lib/termLines'
import { wholeInWords } from '@/features/quotations/lib/totals'
import { formatPaisa, toPaisa } from '@/lib/money'
import { poRef } from '@/lib/refs'

/*
 * The supplier PO PDF (g2-po-pdf.html, decision D11). A4, Geist, the same letterhead and wordmark as the quotation. The amounts are in
 * the leg's currency, written as its code (Geist has no currency glyphs). Only filled profile fields print. The app blocks making the
 * PDF while the legal name or address is missing from the company profile (profileGaps), so the mockup's dashed placeholders never reach
 * a supplier.
 *
 * "Terms of this order" print the PO's own notes when it has any, else STANDARD_TERMS (lib/prefill.ts): the mockup's sample wording,
 * which the owner replaces (open question Q5). Colours are the design tokens' hex values (docs/design/tokens.css).
 *
 * This module imports @react-pdf/renderer, so it is only ever loaded through generate.ts's dynamic import: its own chunk.
 */

const C = {
  ink: '#111113',
  body: '#3d3d44',
  muted: '#5a5a63',
  line: '#e3e3e7',
  strong: '#d2d2d8',
  sunken: '#f4f4f6',
}

const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 10, color: C.ink, paddingTop: 36, paddingBottom: 40, paddingHorizontal: 36 },
  mono: { fontFamily: 'Geist Mono' },
  muted: { color: C.muted },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 1.5, borderBottomColor: C.ink },
  logo: { width: 150, height: 36.5, objectFit: 'contain' },
  company: { alignItems: 'flex-end', maxWidth: 270 },
  companyName: { fontSize: 10.5, fontWeight: 600 },
  right: { textAlign: 'right' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  h1: { fontSize: 22, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.1, marginBottom: 4 },
  meta: { width: 200 },
  metaRow: { flexDirection: 'row', marginBottom: 3 },
  metaLabel: { width: 90, textAlign: 'right', color: C.muted, paddingRight: 10 },
  metaValue: { flex: 1 },
  boxes: { flexDirection: 'row', marginTop: 16, borderTopWidth: 0.75, borderTopColor: C.strong, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  box: { flex: 1, paddingVertical: 8 },
  boxL: { paddingRight: 14, borderRightWidth: 0.75, borderRightColor: C.strong },
  boxR: { paddingLeft: 14 },
  boxLabel: { fontSize: 9.5, fontWeight: 500, color: C.muted, marginBottom: 4 },
  strongText: { fontWeight: 600 },
  th: { flexDirection: 'row', backgroundColor: C.sunken, borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: C.strong, marginTop: 12, paddingVertical: 5, fontWeight: 600, fontSize: 9.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.strong, paddingVertical: 6 },
  cNo: { width: 22, paddingLeft: 4 },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 34, textAlign: 'right' },
  cUnit: { width: 36, paddingLeft: 8 },
  cPrice: { width: 84, textAlign: 'right' },
  cAmt: { width: 92, textAlign: 'right', paddingRight: 2 },
  total: { alignSelf: 'flex-end', width: 240, marginTop: 14, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1.5, borderTopColor: C.ink, borderBottomWidth: 0.75, borderBottomColor: C.ink },
  words: { alignSelf: 'flex-end', marginTop: 6, fontSize: 9.5, color: C.muted },
  two: { flexDirection: 'row', marginTop: 12 },
  twoCol: { flex: 1 },
  secTitle: { fontWeight: 600, paddingBottom: 3, marginBottom: 5, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  terms: { marginTop: 10 },
  termRow: { flexDirection: 'row', marginBottom: 2, fontSize: 9.5 },
  termNo: { width: 14, color: C.muted },
  sign: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  thanks: { width: 230, color: C.muted, fontSize: 9.5 },
  signBox: { width: 230, borderTopWidth: 0.75, borderTopColor: C.ink, paddingTop: 4 },
  foot: { position: 'absolute', left: 36, right: 36, bottom: 20, width: 523, flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: C.strong, paddingTop: 5, fontSize: 9.5, color: C.muted },
})

const money = (n: number) => formatPaisa(toPaisa(n), 'always')
const longDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[dt.getUTCDay()]} ${d} ${months[m - 1]} ${y}`
}
const plainDay = (iso: string): string => longDay(iso).replace(/^\w{3} /, '')
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3))))

/** The first line of a description is the item, any further lines are its detail (as on the quotation). */
function splitDescription(text: string): { title: string; detail: string | null } {
  const [first, ...rest] = text.split(/\r?\n/)
  const detail = rest.join(' ').trim()
  return { title: first.trim(), detail: detail || null }
}

export function PurchaseOrderDocument({ data, profile, logoSrc }: { data: PoPdfData; profile: CompanyProfile; logoSrc: string }) {
  const po = data.po
  const ref = poRef(po.number, data.firstIssuedOn)
  const refRev = `${ref} R${po.revision}`
  const ccy = po.currency
  // exact decimals, the same rounding as the stored purchase_orders.total (0022)
  const amounts = poLineAmounts(po.lines.map(l => ({ qty: l.qty, unit_price: l.unit_price })))
  const lines = po.lines.map((l, i) => ({ ...l, amount: amounts.amounts[i] }))
  const total = amounts.total
  const contactLine = [profile.phone, profile.email, profile.website].filter(Boolean).join('   ')
  const taxLine = [profile.ntn ? `NTN ${profile.ntn}` : null, profile.strn ? `STRN ${profile.strn}` : null].filter(Boolean).join('   ')
  const companyName = profile.legal_name ?? ''
  const shipLines = (po.shipTo ?? profile.address ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const terms = termLines(po.notes)
  const printedTerms = terms.length > 0 ? terms : STANDARD_TERMS
  const place = [data.supplier.city, data.supplier.country].filter(Boolean).join(', ')
  const contactFor = data.signatory ? [data.signatory.name, data.signatory.phone].filter(Boolean).join(', ') : null

  return (
    <Document language="en-GB" title={refRev} author={companyName} subject={`Purchase order ${refRev} to ${data.supplier.name}`}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <Image src={logoSrc} style={s.logo} />
          <View style={s.company}>
            <Text style={[s.companyName, s.right]}>{companyName}</Text>
            {profile.address ? <Text style={[s.right, s.muted]}>{profile.address}</Text> : null}
            {taxLine ? <Text style={[s.right, s.muted, s.mono]}>{taxLine}</Text> : null}
            {contactLine ? <Text style={[s.right, s.muted]}>{contactLine}</Text> : null}
          </View>
        </View>

        <View style={s.titleRow}>
          <View>
            <Text style={s.h1}>Purchase order</Text>
            {data.previous ? (
              <Text style={[s.muted, { marginTop: 3 }]}>
                Supersedes <Text style={s.mono}>{`${ref} R${data.previous.revision}`}</Text> of {plainDay(data.previous.issuedOn)}
              </Text>
            ) : (
              <Text style={[s.muted, { marginTop: 3 }]}>First issue</Text>
            )}
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>PO number</Text>
              <Text style={[s.metaValue, s.mono]}>{ref}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Revision</Text>
              <Text style={[s.metaValue, s.mono]}>R{po.revision}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Date</Text>
              <Text style={s.metaValue}>{longDay(po.issuedOn)}</Text>
            </View>
            {data.supplierReference ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Your proforma</Text>
                <Text style={[s.metaValue, s.mono]}>{data.supplierReference}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.boxes}>
          <View style={[s.box, s.boxL]}>
            <Text style={s.boxLabel}>Supplier</Text>
            <Text style={[s.strongText, { fontSize: 10 }]}>{data.supplier.name}</Text>
            {data.supplier.address ? <Text>{data.supplier.address}</Text> : null}
            {place ? <Text>{place}</Text> : null}
            {data.supplier.attention ? <Text style={{ marginTop: 3 }}>Attention: {data.supplier.attention}</Text> : null}
            {data.supplier.brands.length > 0 ? <Text style={[s.strongText, { marginTop: 3 }]}>Authorised agent for {data.supplier.brands.join(', ')}</Text> : null}
          </View>
          <View style={[s.box, s.boxR]}>
            <Text style={s.boxLabel}>Ship to</Text>
            {shipLines.map((l, i) => (
              <Text key={i} style={i === 0 ? [s.strongText, { fontSize: 10 }] : undefined}>
                {l}
              </Text>
            ))}
            {companyName ? <Text style={{ marginTop: 3 }}>Consignee and notify party: {companyName}</Text> : null}
            {contactFor ? <Text>Contact for delivery: {contactFor}</Text> : null}
          </View>
        </View>

        <View style={s.th} fixed>
          <Text style={s.cNo}>#</Text>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cUnit}>Unit</Text>
          <View style={s.cPrice}>
            <Text style={s.right}>Unit price</Text>
            <Text style={[s.right, s.muted, { fontWeight: 400 }]}>{ccy}</Text>
          </View>
          <View style={s.cAmt}>
            <Text style={s.right}>Amount</Text>
            <Text style={[s.right, s.muted, { fontWeight: 400 }]}>{ccy}</Text>
          </View>
        </View>
        {lines.map((l, i) => {
          const d = splitDescription(l.description)
          return (
            <View key={l.order_item_id} style={s.tr} wrap={false}>
              <Text style={[s.cNo, s.muted]}>{i + 1}</Text>
              <View style={s.cDesc}>
                <Text style={s.strongText}>{d.title}</Text>
                {d.detail ? <Text style={[s.muted, { fontSize: 9.5 }]}>{d.detail}</Text> : null}
              </View>
              <Text style={[s.cQty, s.mono]}>{qtyText(Number(l.qty))}</Text>
              <Text style={s.cUnit}>{l.unit ?? ''}</Text>
              <Text style={[s.cPrice, s.mono]}>{unitPriceText(Number(l.unit_price))}</Text>
              <Text style={[s.cAmt, s.mono]}>{money(l.amount)}</Text>
            </View>
          )
        })}

        <View style={s.total} wrap={false}>
          <Text style={s.strongText}>Total ({ccy})</Text>
          <Text style={[s.mono, { fontWeight: 500, fontSize: 11 }]}>
            {ccy} {money(total)}
          </Text>
        </View>
        <Text style={s.words}>{currencyInWords(toPaisa(total), ccy, wholeInWords)}</Text>

        <View style={s.two} wrap={false}>
          <View style={[s.twoCol, { paddingRight: 12 }]}>
            {po.incoterm ? (
              <>
                <Text style={s.secTitle}>Incoterm</Text>
                <Text>{po.incoterm}</Text>
              </>
            ) : null}
          </View>
          <View style={[s.twoCol, { paddingLeft: 12 }]}>
            {po.paymentTerms ? (
              <>
                <Text style={s.secTitle}>Payment terms</Text>
                <Text>{po.paymentTerms}</Text>
              </>
            ) : null}
          </View>
        </View>
        <View style={s.two} wrap={false}>
          <View style={[s.twoCol, { paddingRight: 12 }]}>
            {po.deliveryTerms ? (
              <>
                <Text style={s.secTitle}>Delivery</Text>
                <Text>{po.deliveryTerms}</Text>
              </>
            ) : null}
          </View>
          <View style={[s.twoCol, { paddingLeft: 12 }]}>
            <Text style={s.secTitle}>Documents with the shipment</Text>
            <Text>Commercial invoice, packing list, certificate of origin, factory test certificates and airway bill, each quoting {ref}.</Text>
          </View>
        </View>

        <View style={s.terms} wrap={false}>
          <Text style={s.secTitle}>Terms of this order</Text>
          {printedTerms.map((t, i) => (
            <View key={i} style={s.termRow}>
              <Text style={[s.termNo, s.mono]}>{i + 1}.</Text>
              <Text style={{ flex: 1 }}>{t}</Text>
            </View>
          ))}
        </View>

        <View style={s.sign} wrap={false}>
          <Text style={s.thanks}>Please confirm receipt and the dispatch date by reply.</Text>
          <View style={s.signBox}>
            <Text style={s.muted}>For {companyName}</Text>
            {data.signatory ? (
              <>
                <Text style={[s.strongText, { fontSize: 10, marginTop: 6 }]}>{data.signatory.name}</Text>
                <Text style={s.muted}>{data.signatory.jobTitle ? `${data.signatory.jobTitle}, ` : ''}authorised signatory</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={s.foot} fixed>
          <Text style={[s.mono, { flex: 1 }]}>{refRev}</Text>
          <Text style={{ flex: 1, textAlign: 'center' }}>{data.supplier.name}</Text>
          <Text style={{ flex: 1, textAlign: 'right' }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
