import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { formatPaisa } from '@/lib/money'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { InvoiceDoc } from '@/features/money/invoices/pdf/doc'
import { COPY_LABEL, qtyText, rateText } from '@/features/money/invoices/pdf/model'

/*
 * The sales-tax invoice PDF (owner decision 2026-10-20, item 2). A4, Geist, the quotation's letterhead (company_profile and the
 * wordmark), so the three documents the CRM prints look like one family. PKR is the text "PKR": Geist has no rupee glyph.
 *
 * What section 23(1) of the Sales Tax Act, 1990 asks for, and where it is:
 *   (a) supplier name, address, registration number  the letterhead: legal name, address, NTN and STRN (all required to print)
 *   (b) recipient name, address, registration number  the Buyer box: name, address, NTN or CNIC, STRN or "Not registered"
 *   (c) date of issue; serial number                  the title block: Invoice no. and Date
 *   (d) description and quantity of goods             the lines
 *   (e) value exclusive of tax                        "Value excl. tax" per line and in the totals
 *   (f) amount of sales tax (and its rate)            "Rate" and "Sales tax" per line, "Sales tax at 18%" in the totals
 *   (g) value inclusive of tax                        "Value incl. tax" per line and the total, also in words
 * The copy mark (Original for the buyer, Duplicate for the office) keeps to "one tax invoice per supply".
 *
 * The totals are the invoice's stored figures, never recomputed; the lines add up to them exactly (model.ts, the +/- Rs 1 rule).
 * This module imports @react-pdf/renderer, so it is only reached through generate.ts's dynamic import (its own chunk).
 * No lineHeight on the page: react-pdf drops render-prop text when a page sets one, and the page number needs it.
 * Colours are the design tokens' hex values (docs/design/tokens.css), as in the quotation: a PDF has no CSS variables.
 */
const C = {
  ink: '#111113', // --neutral-900
  muted: '#5a5a63', // --neutral-600
  strong: '#d2d2d8', // --neutral-200
  sunken: '#f4f4f6', // --neutral-50
}

const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 10, color: C.ink, paddingTop: 36, paddingBottom: 44, paddingHorizontal: 36 },
  mono: { fontFamily: 'Geist Mono' },
  muted: { color: C.muted },
  strongText: { fontWeight: 600 },
  right: { textAlign: 'right' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 1.5, borderBottomColor: C.ink },
  logo: { width: 150, height: 36.5, objectFit: 'contain' },
  company: { alignItems: 'flex-end', maxWidth: 290 },
  companyName: { fontSize: 10.5, fontWeight: 600 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  h1: { fontSize: 22, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.1, marginBottom: 6 },
  copyTag: { alignSelf: 'flex-start', borderWidth: 1, borderColor: C.ink, paddingVertical: 2.5, paddingHorizontal: 6, fontSize: 9.5, fontWeight: 600 },
  meta: { width: 210 },
  metaRow: { flexDirection: 'row', marginBottom: 3 },
  metaLabel: { width: 82, textAlign: 'right', color: C.muted, paddingRight: 10 },
  metaValue: { flex: 1 },
  boxes: { flexDirection: 'row', marginTop: 16, borderTopWidth: 0.75, borderTopColor: C.strong, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  box: { flex: 1, paddingVertical: 8 },
  boxL: { paddingRight: 14, borderRightWidth: 0.75, borderRightColor: C.strong },
  boxR: { paddingLeft: 14 },
  boxLabel: { fontSize: 9.5, fontWeight: 500, color: C.muted, marginBottom: 4 },
  refRow: { flexDirection: 'row', marginBottom: 2.5 },
  refLabel: { width: 78, color: C.muted },
  th: { flexDirection: 'row', backgroundColor: C.sunken, borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: C.strong, marginTop: 12, paddingVertical: 5, fontWeight: 600, fontSize: 9.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.strong, paddingVertical: 6, fontSize: 9.5 },
  cNo: { width: 18, paddingLeft: 3 },
  cDesc: { flex: 1, paddingRight: 6 },
  // numeric columns fit 10,000,000.00 in mono 8.5 with a 4pt gap, so two amounts never run together (checked in a browser render)
  cQty: { width: 46, textAlign: 'right', paddingLeft: 4 },
  cPrice: { width: 68, textAlign: 'right', paddingLeft: 4 },
  cNet: { width: 78, textAlign: 'right', paddingLeft: 4 },
  cRate: { width: 32, textAlign: 'right', paddingLeft: 4 },
  cTax: { width: 70, textAlign: 'right', paddingLeft: 4 },
  cGross: { width: 80, textAlign: 'right', paddingLeft: 4, paddingRight: 3 },
  totals: { alignSelf: 'flex-end', width: 320, marginTop: 12 },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  gross: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingVertical: 6, borderTopWidth: 1.5, borderBottomWidth: 0.75, borderTopColor: C.ink, borderBottomColor: C.ink },
  secTitle: { fontWeight: 600, paddingBottom: 3, marginBottom: 5, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  sign: { marginTop: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  note: { width: 250, color: C.muted, fontSize: 9.5 },
  signBox: { width: 230, borderTopWidth: 0.75, borderTopColor: C.ink, paddingTop: 4, marginTop: 40 },
  run: { position: 'absolute', top: 14, left: 36, right: 36 },
  runInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  runLogo: { width: 60, height: 14.6, objectFit: 'contain' },
  foot: { position: 'absolute', left: 36, right: 36, bottom: 20, width: 523, flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: C.strong, paddingTop: 5, fontSize: 9.5, color: C.muted },
})

const money = (paisa: bigint) => formatPaisa(paisa, 'always')
const longDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]} ${y}`
}

/** The first line of a description is the item, any further lines are its detail (as on the quotation). */
function splitDescription(text: string): { title: string; detail: string | null } {
  const [first, ...rest] = text.split(/\r?\n/)
  const detail = rest.join(' ').trim()
  return { title: first.trim(), detail: detail || null }
}

export function InvoiceDocument({ doc, profile, logoSrc }: { doc: InvoiceDoc; profile: CompanyProfile; logoSrc: string }) {
  const f = doc.figures
  const companyName = profile.legal_name ?? ''
  const taxLine = [profile.ntn ? `NTN ${profile.ntn}` : null, profile.strn ? `STRN ${profile.strn}` : null].filter(Boolean).join('   ')
  const contactLine = [profile.phone, profile.email, profile.website].filter(Boolean).join('   ')
  const bank = [profile.bank_name, profile.bank_account_title, profile.bank_iban].filter(Boolean)
  const copy = COPY_LABEL[doc.copy]
  const exempt = f.byRate.find(r => r.ratePercent === 0)

  return (
    <Document language="en-GB" title={`Sales tax invoice ${doc.number}`} author={companyName} subject={`Sales tax invoice ${doc.number} for ${doc.buyer.name}`}>
      <Page size="A4" style={s.page}>
        {/* From page 2 on: a slim running header (small wordmark; document, buyer, date). */}
        <View
          fixed
          style={s.run}
          render={({ pageNumber }) =>
            pageNumber > 1 ? (
              <View style={s.runInner}>
                <Image src={logoSrc} style={s.runLogo} />
                <Text style={[s.muted, { fontSize: 9.5, textAlign: 'right' }]}>
                  Sales tax invoice {doc.number}  {doc.buyer.name}  {longDay(doc.invoiceDate)}
                </Text>
              </View>
            ) : null
          }
        />
        <View style={s.head}>
          <Image src={logoSrc} style={s.logo} />
          <View style={s.company}>
            <Text style={[s.companyName, s.right]}>{companyName}</Text>
            {profile.address ? <Text style={[s.right, s.muted]}>{profile.address}</Text> : null}
            {taxLine ? <Text style={[s.right, s.mono]}>{taxLine}</Text> : null}
            {contactLine ? <Text style={[s.right, s.muted]}>{contactLine}</Text> : null}
          </View>
        </View>

        <View style={s.titleRow}>
          <View>
            <Text style={s.h1}>Sales Tax Invoice</Text>
            <Text style={s.copyTag}>{copy}</Text>
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Invoice no.</Text>
              <Text style={[s.metaValue, s.mono, s.strongText]}>{doc.number}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Date</Text>
              <Text style={s.metaValue}>{longDay(doc.invoiceDate)}</Text>
            </View>
            {doc.dueOn ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Payment due</Text>
                <Text style={s.metaValue}>{longDay(doc.dueOn)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.boxes}>
          <View style={[s.box, s.boxL]}>
            <Text style={s.boxLabel}>Buyer</Text>
            <Text style={[s.strongText, { fontSize: 10 }]}>{doc.buyer.name}</Text>
            <Text>{doc.buyer.address}</Text>
            <View style={[s.refRow, { marginTop: 4 }]}>
              <Text style={s.refLabel}>NTN / CNIC</Text>
              <Text style={s.mono}>{doc.buyer.ntn ?? ''}</Text>
            </View>
            <View style={s.refRow}>
              <Text style={s.refLabel}>STRN</Text>
              {doc.buyer.registered && doc.buyer.strn ? <Text style={s.mono}>{doc.buyer.strn}</Text> : <Text>Not registered for sales tax</Text>}
            </View>
          </View>
          <View style={[s.box, s.boxR]}>
            <Text style={s.boxLabel}>References</Text>
            {doc.customerPo ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Your PO</Text>
                <Text style={[s.strongText, s.mono]}>
                  {doc.customerPo}
                  {doc.poDate ? <Text style={[s.muted, { fontFamily: 'Geist', fontWeight: 400 }]}>{`  of ${longDay(doc.poDate)}`}</Text> : null}
                </Text>
              </View>
            ) : null}
            {doc.orderRef ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Our order</Text>
                <Text style={[s.strongText, s.mono]}>{doc.orderRef}</Text>
              </View>
            ) : null}
            {doc.siteName ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Delivered to</Text>
                <Text style={s.strongText}>{doc.siteName}</Text>
              </View>
            ) : null}
            <View style={s.refRow}>
              <Text style={s.refLabel}>Currency</Text>
              <Text style={s.strongText}>Pakistani rupees (PKR)</Text>
            </View>
          </View>
        </View>

        <View style={s.th} fixed>
          <Text style={s.cNo}>#</Text>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
          <View style={s.cPrice}>
            <Text>Unit price</Text>
            <Text>excl. tax</Text>
          </View>
          <Text style={s.cNet}>Value excl. tax</Text>
          <Text style={s.cRate}>Rate</Text>
          <Text style={s.cTax}>Sales tax</Text>
          <Text style={s.cGross}>Value incl. tax</Text>
        </View>
        {f.lines.map(l => {
          const d = splitDescription(l.description)
          return (
            <View key={l.id} style={s.tr} wrap={false}>
              <Text style={[s.cNo, s.muted]}>{l.no}</Text>
              <View style={s.cDesc}>
                <Text style={s.strongText}>{d.title}</Text>
                {d.detail ? <Text style={[s.muted, { fontSize: 9.5 }]}>{d.detail}</Text> : null}
              </View>
              <Text style={[s.cQty, s.mono]}>{l.unit ? `${qtyText(l.qty)} ${l.unit}` : qtyText(l.qty)}</Text>
              <Text style={[s.cPrice, s.mono]}>{money(l.unitPrice)}</Text>
              <Text style={[s.cNet, s.mono]}>{money(l.net)}</Text>
              <Text style={[s.cRate, s.mono]}>{rateText(l.ratePercent)}</Text>
              <Text style={[s.cTax, s.mono]}>{money(l.gst)}</Text>
              <Text style={[s.cGross, s.mono]}>{money(l.gross)}</Text>
            </View>
          )
        })}

        {/* Totals, bank details and the signature stay together on the last page with the final lines. */}
        <View wrap={false}>
          <View style={s.totals}>
            <View style={s.totRow}>
              <Text>Value excluding sales tax</Text>
              <Text style={s.mono}>PKR {money(f.net)}</Text>
            </View>
            {f.byRate
              .filter(r => r.ratePercent > 0)
              .map(r => (
                <View key={r.ratePercent} style={s.totRow}>
                  <Text>Sales tax at {rateText(r.ratePercent)}</Text>
                  <Text style={s.mono}>PKR {money(r.gst)}</Text>
                </View>
              ))}
            {exempt ? (
              <View style={s.totRow}>
                <Text style={s.muted}>Exempt supplies (value, no sales tax)</Text>
                <Text style={[s.mono, s.muted]}>PKR {money(exempt.net)}</Text>
              </View>
            ) : null}
            <View style={s.gross}>
              <Text style={s.strongText}>Value including sales tax</Text>
              <Text style={[s.mono, { fontWeight: 500, fontSize: 11 }]}>PKR {money(f.gross)}</Text>
            </View>
            <Text style={[s.right, s.muted, { fontSize: 9.5, marginTop: 5 }]}>{doc.words}</Text>
          </View>

          {bank.length > 0 ? (
            <View style={{ marginTop: 10 }} wrap={false}>
              <Text style={s.secTitle}>Bank details</Text>
              <Text>{[profile.bank_account_title, profile.bank_name].filter(Boolean).join(', ')}</Text>
              {profile.bank_iban ? <Text style={s.mono}>IBAN {profile.bank_iban}</Text> : null}
            </View>
          ) : null}

          <View style={s.sign} wrap={false}>
            <Text style={s.note}>
              Sales tax invoice issued under section 23 of the Sales Tax Act, 1990. Please quote <Text style={s.mono}>{doc.number}</Text> with your payment.
            </Text>
            <View style={s.signBox}>
              <Text style={s.muted}>For {companyName}</Text>
              <Text style={[s.muted, { marginTop: 2 }]}>Authorised signatory and stamp</Text>
            </View>
          </View>
        </View>

        <View style={s.foot} fixed>
          <Text style={[s.mono, { flex: 1 }]}>{doc.number}</Text>
          <Text style={{ flex: 1, textAlign: 'center' }}>{copy}</Text>
          <Text style={{ flex: 1, textAlign: 'right' }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
