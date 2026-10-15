import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { PdfData } from '@/features/quotations/api'
import { amountInWords, computeTotals } from '@/features/quotations/lib/totals'
import { quotationRef } from '@/features/quotations/lib/refs'
import { formatPaisa, toPaisa } from '@/lib/money'
import { termLines } from '@/features/quotations/lib/termLines'

/*
 * The quotation PDF (g2-quotation-pdf.html, decision D10). A4, Geist, one letterhead from company_profile and the
 * wordmark from public/brand. PKR is written as the text "PKR": Geist has no rupee glyph. Only filled profile fields
 * print (bank details are optional; an empty NTN is a missing line, never a dashed placeholder).
 *
 * This module imports @react-pdf/renderer, so it is only ever loaded through generate.ts's dynamic import: it is its
 * own chunk and the main bundle does not carry it.
 *
 * No lineHeight on the page: react-pdf drops dynamic (render) text when a page sets one, and the page number needs it.
 * Colours are the design tokens' hex values (docs/design/tokens.css): a PDF has no CSS variables.
 */
const C = {
  ink: '#111113', // --neutral-900
  body: '#3d3d44', // --neutral-700
  muted: '#5a5a63', // --neutral-600
  line: '#e3e3e7', // --neutral-150
  strong: '#d2d2d8', // --neutral-200
  sunken: '#f4f4f6', // --neutral-50
}

const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 9, color: C.ink, paddingTop: 36, paddingBottom: 40, paddingHorizontal: 36 },
  mono: { fontFamily: 'Geist Mono' },
  muted: { color: C.muted },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 1.5, borderBottomColor: C.ink },
  logo: { width: 150, height: 36.5, objectFit: 'contain' },
  company: { alignItems: 'flex-end', maxWidth: 270 },
  companyName: { fontSize: 10.5, fontWeight: 600 },
  right: { textAlign: 'right' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  h1: { fontSize: 22, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.1, marginBottom: 4 },
  meta: { width: 190 },
  metaRow: { flexDirection: 'row', marginBottom: 3 },
  metaLabel: { width: 78, textAlign: 'right', color: C.muted, paddingRight: 10 },
  metaValue: { flex: 1 },
  boxes: { flexDirection: 'row', marginTop: 16, borderTopWidth: 0.75, borderTopColor: C.strong, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  box: { flex: 1, paddingVertical: 8 },
  boxL: { paddingRight: 14, borderRightWidth: 0.75, borderRightColor: C.strong },
  boxR: { paddingLeft: 14 },
  boxLabel: { fontSize: 8.5, fontWeight: 500, color: C.muted, marginBottom: 4 },
  strongText: { fontWeight: 600 },
  refRow: { flexDirection: 'row', marginBottom: 2.5 },
  refLabel: { width: 82, color: C.muted },
  th: { flexDirection: 'row', backgroundColor: C.sunken, borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: C.strong, marginTop: 12, paddingVertical: 5, fontWeight: 600, fontSize: 8.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.strong, paddingVertical: 6 },
  cNo: { width: 22, paddingLeft: 4 },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 30, textAlign: 'right' },
  cUnit: { width: 32, paddingLeft: 6 },
  cPrice: { width: 66, textAlign: 'right' },
  cGst: { width: 44, textAlign: 'right' },
  cNet: { width: 84, textAlign: 'right' },
  cLead: { width: 78, paddingLeft: 10, paddingRight: 4 },
  totals: { alignSelf: 'flex-end', width: 330, marginTop: 12 },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  gross: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingVertical: 6, borderTopWidth: 1.5, borderBottomWidth: 0.75, borderTopColor: C.ink, borderBottomColor: C.ink },
  words: { alignSelf: 'flex-end', marginTop: 6, fontSize: 8, color: C.muted },
  two: { flexDirection: 'row', marginTop: 10 },
  twoCol: { flex: 1 },
  secTitle: { fontWeight: 600, paddingBottom: 3, marginBottom: 5, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  terms: { marginTop: 8 },
  termRow: { flexDirection: 'row', marginBottom: 2, fontSize: 8 },
  termNo: { width: 14, color: C.muted },
  sign: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  thanks: { width: 230, color: C.muted, fontSize: 8 },
  signBox: { width: 230, borderTopWidth: 0.75, borderTopColor: C.ink, paddingTop: 4 },
  run: { position: 'absolute', top: 14, left: 36, right: 36 },
  runInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  runLogo: { width: 60, height: 14.6, objectFit: 'contain' },
  foot: { position: 'absolute', left: 36, right: 36, bottom: 20, width: 523, flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: C.strong, paddingTop: 5, fontSize: 7.5, color: C.muted },
})

const money = (paisa: bigint) => formatPaisa(paisa, 'always')
const longDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[dt.getUTCDay()]} ${d} ${months[m - 1]} ${y}`
}
const plainDay = (iso: string): string => longDay(iso).replace(/^\w{3} /, '')
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3))))

/** The first line of a description is the item, any further lines are its detail (as in the approved PDF). */
function splitDescription(text: string): { title: string; detail: string | null } {
  const [first, ...rest] = text.split(/\r?\n/)
  const detail = rest.join(' ').trim()
  return { title: first.trim(), detail: detail || null }
}

export function QuotationDocument({ data, profile, logoSrc }: { data: PdfData; profile: CompanyProfile; logoSrc: string }) {
  const q = data.quotation
  // A preview of a first issue has no number yet: it prints QT-YY-NNNN.
  const refOf = (rev?: number): string =>
    q.number === 0 ? `QT-${data.firstIssuedOn.slice(2, 4)}-NNNN${rev === undefined ? '' : ` R${rev}`}` : quotationRef(q.number, data.firstIssuedOn, rev)
  const ref = refOf()
  const refRev = refOf(q.revision)
  const totals = computeTotals(q.lines.map(l => ({ qty: l.qty, unitPrice: l.unit_price_net, gstRate: l.gst_rate })))
  const rates = [...totals.gstByRate.keys()].sort((a, b) => Number(b) - Number(a))
  const contactLine = [profile.phone, profile.email, profile.website].filter(Boolean).join('   ')
  const taxLine = [profile.ntn ? `NTN ${profile.ntn}` : null, profile.strn ? `STRN ${profile.strn}` : null].filter(Boolean).join('   ')
  const terms = termLines(q.notes)
  const bank = [profile.bank_name, profile.bank_account_title, profile.bank_iban].filter(Boolean)
  const companyName = profile.legal_name ?? ''

  return (
    <Document title={refRev} author={companyName} subject={`Quotation ${refRev} for ${data.customer.name}`}>
      <Page size="A4" style={s.page}>
        {/* From page 2 on: a slim running header (small wordmark; document, customer, date). */}
        <View
          fixed
          style={s.run}
          render={({ pageNumber }) =>
            pageNumber > 1 ? (
              <View style={s.runInner}>
                <Image src={logoSrc} style={s.runLogo} />
                <Text style={[s.muted, { fontSize: 7.5, textAlign: 'right' }]}>
                  Quotation {refRev}  {data.customer.name}  {plainDay(q.issuedOn)}
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
            {taxLine ? <Text style={[s.right, s.muted, s.mono]}>{taxLine}</Text> : null}
            {contactLine ? <Text style={[s.right, s.muted]}>{contactLine}</Text> : null}
          </View>
        </View>

        <View style={s.titleRow}>
          <View>
            <Text style={s.h1}>Quotation</Text>
            {data.preview ? <Text style={[s.muted, { marginTop: 3 }]}>Preview, not issued yet</Text> : null}
            {!data.previous && !data.preview ? <Text style={[s.muted, { marginTop: 3 }]}>First issue</Text> : null}
            {data.previous ? (
              <Text style={[s.muted, { marginTop: 3 }]}>
                Supersedes <Text style={s.mono}>{refOf(data.previous.revision)}</Text> of {plainDay(data.previous.issuedOn)}
              </Text>
            ) : null}
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Quotation no.</Text>
              <Text style={[s.metaValue, s.mono]}>{ref}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Revision</Text>
              <Text style={[s.metaValue, s.mono]}>R{q.revision}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Date</Text>
              <Text style={s.metaValue}>{longDay(q.issuedOn)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Valid until</Text>
              <Text style={[s.metaValue, s.strongText]}>{longDay(q.validUntil)}</Text>
            </View>
          </View>
        </View>

        <View style={s.boxes}>
          <View style={[s.box, s.boxL]}>
            <Text style={s.boxLabel}>Prepared for</Text>
            <Text style={[s.strongText, { fontSize: 10 }]}>{data.customer.name}</Text>
            {data.siteName ? <Text>{data.siteName}</Text> : null}
            {data.siteAddress ? <Text>{data.siteAddress}</Text> : null}
            {data.attention ? <Text style={{ marginTop: 3 }}>Attention: {[data.attention, data.attentionTitle].filter(Boolean).join(', ')}</Text> : null}
          </View>
          <View style={[s.box, s.boxR]}>
            <Text style={s.boxLabel}>References</Text>
            {data.customerRef ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Your reference</Text>
                <Text style={[s.strongText, s.mono]}>{data.customerRef}</Text>
              </View>
            ) : null}
            <View style={s.refRow}>
              <Text style={s.refLabel}>Our RFQ</Text>
              <Text style={[s.strongText, s.mono]}>RFQ-{String(data.rfqNumber).padStart(4, '0')}</Text>
            </View>
            <View style={s.refRow}>
              <Text style={s.refLabel}>Currency</Text>
              <Text style={s.strongText}>Pakistani rupees (PKR)</Text>
            </View>
            {data.signatory ? (
              <View style={s.refRow}>
                <Text style={s.refLabel}>Prepared by</Text>
                <Text style={s.strongText}>{[data.signatory.name, data.signatory.phone].filter(Boolean).join(', ')}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.th} fixed>
          <Text style={s.cNo}>#</Text>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cUnit}>Unit</Text>
          <View style={s.cPrice}>
            <Text style={s.right}>Unit price</Text>
            <Text style={[s.right, s.muted, { fontWeight: 400 }]}>PKR, net</Text>
          </View>
          <Text style={s.cGst}>GST</Text>
          <View style={s.cNet}>
            <Text style={s.right}>Line net</Text>
            <Text style={[s.right, s.muted, { fontWeight: 400 }]}>PKR</Text>
          </View>
          <Text style={s.cLead}>Lead time</Text>
        </View>
        {q.lines.map((l, i) => {
          const d = splitDescription(l.description)
          const a = totals.lines[i]
          return (
            <View key={l.rfq_item_id} style={s.tr} wrap={false}>
              <Text style={[s.cNo, s.muted]}>{i + 1}</Text>
              <View style={s.cDesc}>
                <Text style={s.strongText}>{d.title}</Text>
                {d.detail ? <Text style={[s.muted, { fontSize: 8 }]}>{d.detail}</Text> : null}
              </View>
              <Text style={[s.cQty, s.mono]}>{qtyText(l.qty)}</Text>
              <Text style={s.cUnit}>{l.unit ?? ''}</Text>
              <Text style={[s.cPrice, s.mono]}>{money(toPaisa(l.unit_price_net))}</Text>
              <Text style={[s.cGst, s.mono]}>{Number(l.gst_rate) === 0 ? 'Exempt' : `${qtyText(Number(l.gst_rate))}%`}</Text>
              <Text style={[s.cNet, s.mono]}>{money(a.net)}</Text>
              <Text style={s.cLead}>{l.lead_time ?? ''}</Text>
            </View>
          )
        })}

        {/* Totals, terms and the signature stay together on the last page with the final lines. */}
        <View wrap={false}>
        <View style={s.totals}>
          <View style={s.totRow}>
            <Text>Total net</Text>
            <Text style={s.mono}>PKR {money(totals.net)}</Text>
          </View>
          {rates.map(r => (
            <View key={r} style={s.totRow}>
              <Text>{Number(r) === 0 ? 'GST exempt' : `GST at ${r}%`}</Text>
              <Text style={s.mono}>PKR {money(totals.gstByRate.get(r) ?? 0n)}</Text>
            </View>
          ))}
          <View style={s.gross}>
            <Text style={s.strongText}>Total gross</Text>
            <Text style={[s.mono, { fontWeight: 500, fontSize: 11 }]}>PKR {money(totals.gross)}</Text>
          </View>
          <Text style={[s.right, s.muted, { fontSize: 8, marginTop: 5 }]}>{amountInWords(totals.gross)}</Text>
        </View>

        {q.deliveryText || q.paymentTerms ? (
          <View style={s.two} wrap={false}>
            <View style={[s.twoCol, { paddingRight: 12 }]}>
              {q.deliveryText ? (
                <>
                  <Text style={s.secTitle}>Delivery</Text>
                  <Text>{q.deliveryText}</Text>
                </>
              ) : null}
            </View>
            <View style={[s.twoCol, { paddingLeft: 12 }]}>
              {q.paymentTerms ? (
                <>
                  <Text style={s.secTitle}>Payment terms</Text>
                  <Text>{q.paymentTerms}</Text>
                </>
              ) : null}
            </View>
          </View>
        ) : null}

        {bank.length > 0 ? (
          <View style={{ marginTop: 8 }} wrap={false}>
            <Text style={s.secTitle}>Bank details</Text>
            <Text>{[profile.bank_account_title, profile.bank_name].filter(Boolean).join(', ')}</Text>
            {profile.bank_iban ? <Text style={s.mono}>IBAN {profile.bank_iban}</Text> : null}
          </View>
        ) : null}

        {terms.length > 0 ? (
          <View style={s.terms} wrap={false}>
            <Text style={s.secTitle}>Standard terms</Text>
            {terms.map((t, i) => (
              <View key={i} style={s.termRow}>
                <Text style={[s.termNo, s.mono]}>{i + 1}.</Text>
                <Text style={{ flex: 1 }}>{t}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={s.sign} wrap={false}>
          <Text style={s.thanks}>
            Thank you for the enquiry. Please quote <Text style={s.mono}>{refRev}</Text> on your purchase order.
          </Text>
          <View style={s.signBox}>
            <Text style={s.muted}>For {companyName}</Text>
            {data.signatory ? (
              <>
                <Text style={[s.strongText, { fontSize: 10, marginTop: 6 }]}>{data.signatory.name}</Text>
                <Text style={s.muted}>{data.signatory.jobTitle ? `${data.signatory.jobTitle}, ` : ''}authorised signatory</Text>
                {data.signatory.phone ? <Text style={[s.muted, s.mono]}>{data.signatory.phone}</Text> : null}
              </>
            ) : null}
          </View>
        </View>

        </View>

        <View style={s.foot} fixed>
          <Text style={[s.mono, { flex: 1 }]}>{refRev}</Text>
          <Text style={{ flex: 1, textAlign: 'center' }}>Valid until {longDay(q.validUntil)}</Text>
          <Text style={{ flex: 1, textAlign: 'right' }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
