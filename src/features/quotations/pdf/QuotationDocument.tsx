import { Document, Image, Page, Path, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { PdfData } from '@/features/quotations/api'
import { computeTotals } from '@/features/quotations/lib/totals'
import { quotationRef } from '@/features/quotations/lib/refs'
import { formatPaisa, toPaisa } from '@/lib/money'
import { termLines } from '@/features/quotations/lib/termLines'
import { deliveryLine, footerAddress, inquiryDay, itemDetail, paymentLine, quoteDay, toLine, validityLine } from '@/features/quotations/pdf/quoteText'

/*
 * The quotation PDF, laid out as the owner's own Excel quotation (owner, 25 Nov 2026): the letterhead logo and a thick rule, a
 * bordered box with the customer and the quote reference, the greeting, a bordered item table, the gross amount without GST, the
 * terms, the warranty and the signature, and the green contact footer on every page. A4, black on white, the green only in the
 * logo and the footer icons. Geist throughout (no monospace anywhere), Helvetica only for the one bold italic line Geist has no face for.
 * The word "Inquiry" is the owner's own on this document (the screens never use it).
 *
 * This module imports @react-pdf/renderer, so it is only ever loaded through generate.ts's dynamic import: it is its own chunk and the
 * main bundle does not carry it. No lineHeight on the page: react-pdf drops dynamic (render) text when a page sets one.
 */

const INK = '#000000'
const GREEN = '#009a32'
const BLUE = '#0033cc'
const RULE = 0.75

const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 9, color: INK, paddingTop: 22, paddingBottom: 86, paddingHorizontal: 52 },
  logo: { width: 334, height: 46.6, alignSelf: 'center' },
  thickRule: { height: 2.4, backgroundColor: INK, marginTop: 9, marginLeft: 34, marginRight: -12 },
  draft: { position: 'absolute', top: 26, right: 52, fontSize: 8, color: '#555555' },
  box: { marginTop: 18, borderTopWidth: RULE, borderLeftWidth: RULE, borderRightWidth: RULE, borderColor: INK },
  top: { flexDirection: 'row', borderBottomWidth: RULE, borderColor: INK },
  customer: { flex: 1, paddingHorizontal: 2, paddingTop: 2, paddingBottom: 2, justifyContent: 'center' },
  big: { fontSize: 10, lineHeight: 1.25 },
  bold: { fontWeight: 600 },
  refGrid: { width: 172, borderLeftWidth: RULE, borderColor: INK },
  refRow: { flexDirection: 'row', flexGrow: 1 },
  refLabel: { width: 58, paddingHorizontal: 3, paddingVertical: 2.5, borderRightWidth: RULE, borderColor: INK, fontSize: 8.5, justifyContent: 'center' },
  refValue: { flex: 1, paddingHorizontal: 2, paddingVertical: 2.5, fontSize: 8.5, justifyContent: 'center' },
  greet: { paddingHorizontal: 2, paddingTop: 2, paddingBottom: 2.5, borderBottomWidth: RULE, borderColor: INK, fontSize: 10, lineHeight: 1.3 },
  refLine: { flexDirection: 'row', fontSize: 8.5 },
  refLeft: { width: 125, paddingHorizontal: 2, paddingVertical: 1.5, borderRightWidth: RULE, borderColor: INK },
  refRight: { flex: 1, paddingHorizontal: 2, paddingVertical: 1.5 },
  // the header row draws its own top line: on page 1 it closes the box above, on a later page it opens the table
  th: { flexDirection: 'row', borderWidth: RULE, borderColor: INK, fontSize: 9 },
  tr: { flexDirection: 'row', borderBottomWidth: RULE, borderLeftWidth: RULE, borderRightWidth: RULE, borderColor: INK, minHeight: 34 },
  cSr: { width: 27, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  cDesc: { flex: 1, paddingHorizontal: 2.5, paddingVertical: 5, justifyContent: 'center', borderLeftWidth: RULE, borderColor: INK },
  cQty: { width: 37, alignItems: 'center', justifyContent: 'center', paddingVertical: 2, borderLeftWidth: RULE, borderColor: INK },
  cUnit: { width: 67, alignItems: 'center', justifyContent: 'center', paddingVertical: 2, borderLeftWidth: RULE, borderColor: INK },
  cTotal: { width: 68, alignItems: 'flex-end', justifyContent: 'center', paddingVertical: 2, paddingRight: 2, borderLeftWidth: RULE, borderColor: INK },
  thCell: { justifyContent: 'center', alignItems: 'center', paddingVertical: 2 },
  descLine: { fontSize: 9, lineHeight: 1.4 },
  gross: { flexDirection: 'row', alignSelf: 'flex-end', width: 236, borderLeftWidth: RULE, borderRightWidth: RULE, borderBottomWidth: RULE, borderColor: INK, minHeight: 20 },
  grossLabel: { flex: 1, alignItems: 'center', justifyContent: 'center', fontSize: 9.5 },
  grossValue: { width: 68, alignItems: 'center', justifyContent: 'center', borderLeftWidth: RULE, borderColor: INK, fontSize: 10 },
  sectionTitle: { fontSize: 10, fontWeight: 600, marginBottom: 2 },
  termLine: { fontSize: 9, lineHeight: 1.42 },
  para: { fontSize: 9, lineHeight: 1.42 },
  signName: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.4 },
  signLine: { fontSize: 10, lineHeight: 1.4 },
  signCo: { fontWeight: 600, transform: 'skewX(-11deg)', transformOrigin: 'left bottom', fontSize: 10, lineHeight: 1.4 },
  foot: { position: 'absolute', left: 95, right: 50, bottom: 30 },
  footRule: { height: 2.4, backgroundColor: INK },
  footRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  footItem: { flexDirection: 'row', alignItems: 'center', marginRight: 7 },
  footText: { fontSize: 9.5, color: '#1a1a1a', marginLeft: 5, lineHeight: 1.3 },
})

/** The three footer icons: white glyphs on a green square, drawn rather than pictured so they stay sharp at any zoom. */
function Icon({ kind }: { kind: 'phone' | 'mail' | 'pin' }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24">
      <Rect x={0} y={0} width={24} height={24} fill={GREEN} />
      {kind === 'phone' ? (
        <Path
          fill="#ffffff"
          d="M7.2 4.2c.5-.4 1.2-.3 1.6.2l1.9 2.6c.4.5.3 1.2-.1 1.6l-1.2 1.1c.8 1.7 2.2 3.2 3.9 4l1.1-1.2c.4-.5 1.1-.5 1.6-.1l2.6 1.9c.5.4.6 1.1.2 1.6l-1.2 1.6c-.6.8-1.6 1.1-2.5.8-4.3-1.4-7.7-4.8-9.1-9.1-.3-.9 0-1.9.8-2.5z"
        />
      ) : kind === 'mail' ? (
        <>
          <Rect x={4.5} y={7} width={15} height={10.5} rx={1} fill="none" stroke="#ffffff" strokeWidth={1.6} />
          <Path d="M5 7.6l7 5.4 7-5.4" fill="none" stroke="#ffffff" strokeWidth={1.6} />
        </>
      ) : (
        <Path
          fill="#ffffff"
          fillRule="evenodd"
          d="M12 3.5c-3.3 0-5.8 2.5-5.8 5.7 0 4 5.8 11.3 5.8 11.3s5.8-7.3 5.8-11.3c0-3.2-2.5-5.7-5.8-5.7zm0 3.4a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z"
        />
      )}
    </Svg>
  )
}

const money = (n: number) => formatPaisa(toPaisa(n), 'auto')
const qtyText = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(parseFloat(n.toFixed(3))))
/** Counted things print as the bare number, as on the owner's quotes. Any other unit (m, kg, set) is printed after it. */
const COUNT_UNITS = /^(pcs?|nos?|no\.|each|ea|units?|qty)$/i
const qtyWithUnit = (n: number, unit: string | null) => (unit?.trim() && !COUNT_UNITS.test(unit.trim()) ? `${qtyText(n)} ${unit.trim()}` : qtyText(n))

export function QuotationDocument({ data, profile, logoSrc }: { data: PdfData; profile: CompanyProfile; logoSrc: string }) {
  const q = data.quotation
  const currency = data.currency ?? 'PKR'
  // A preview of a first issue has no number yet: it prints QTS-<code>-NNNN.
  const code = q.code ?? (q.number === 0 ? (data.customer.code ?? null) : null)
  const ref = q.number === 0 ? `QTS-${code ?? 'XXX'}-NNNN` : quotationRef(q.number, data.firstIssuedOn, undefined, q.code)
  const docTitle = q.revision > 0 ? `${ref} Rev ${q.revision}` : ref
  const totals = computeTotals(q.lines.map(l => ({ qty: l.qty, unitPrice: l.unit_price_net, gstRate: l.gst_rate })))
  const delivery = deliveryLine(q.deliveryText, q.lines.map(l => l.lead_time))
  const city = data.customer.city?.trim() || null
  const terms = [
    { label: 'Price Validity', text: validityLine(q.issuedOn, q.validUntil) },
    delivery.line ? { label: 'Delivery Time', text: delivery.line } : null,
    { label: null, text: `Prices are in ${currency}, exclusive of GST, and will be charged as per the Govt. Law.` },
    city ? { label: null, text: `Prices are on F-O-R ${city}.` } : null,
    paymentLine(q.paymentTerms, profile.default_payment_terms_days),
    ...termLines(q.notes).map(t => ({ label: null, text: t })),
  ].filter((t): t is { label: string | null; text: string } => t !== null && Boolean(t.text))
  const address = (data.siteAddress ?? data.customer.address ?? '').replace(/\s*\r?\n\s*/g, ', ').trim()
  const greeting = toLine(data.attention, data.attentionTitle)
  const items = q.lines.length === 1 ? 'item' : 'items'
  const companyName = profile.legal_name ?? ''
  const signName = data.signatory ? `${data.signatory.name}${data.signatory.jobTitle ? ` (${data.signatory.jobTitle})` : ''}` : null
  const cell = profile.sales_phone?.trim() || data.signatory?.phone?.trim() || profile.phone?.trim() || null
  const mail = profile.sales_email?.trim() || profile.email?.trim() || null
  const footAddress = footerAddress(profile.address)

  return (
    <Document language="en-GB" title={docTitle} author={companyName} subject={`Quotation ${docTitle} for ${data.customer.name}`}>
      <Page size="A4" style={s.page}>
        <Image src={logoSrc} style={s.logo} />
        <View style={s.thickRule} />
        {data.preview ? <Text style={s.draft}>DRAFT, NOT ISSUED</Text> : null}

        <View style={s.box}>
          <View style={s.top}>
            <View style={s.customer}>
              <Text style={s.big}>
                <Text style={s.bold}>M/s: </Text>
                {data.customer.name}
              </Text>
              <Text style={s.big}>Address: {address}</Text>
            </View>
            <View style={s.refGrid}>
              <View style={[s.refRow, { borderBottomWidth: RULE, borderColor: INK }]}>
                <View style={[s.refLabel, { alignItems: 'center' }]}>
                  <Text>Quote Ref:</Text>
                </View>
                <View style={s.refValue}>
                  <Text>
                    {ref}
                    {q.revision > 0 ? `  Rev ${q.revision}` : ''}
                  </Text>
                </View>
              </View>
              <View style={s.refRow}>
                <View style={s.refLabel}>
                  <Text>Date:</Text>
                </View>
                <View style={s.refValue}>
                  <Text>{quoteDay(q.issuedOn)}</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={s.greet}>
            {greeting ? (
              <Text>
                <Text style={s.bold}>To: </Text>
                {greeting}
              </Text>
            ) : null}
            <Text>Thank you very much for your Inquiry. Please see below our techno/commercial offer for the requested {items}.</Text>
          </View>
          <View style={s.refLine}>
            <View style={s.refLeft}>
              <Text>
                Ref. <Text style={s.bold}>{data.customerRef ?? ''}</Text>
              </Text>
            </View>
            <View style={s.refRight}>
              <Text>{data.receivedOn ? `Inquiry Date: ${inquiryDay(data.receivedOn)}` : 'Inquiry Date:'}</Text>
            </View>
          </View>
        </View>

        {/* The header is fixed inside the table, so it repeats at the top of every page the table runs onto. */}
        <View>
          <View style={s.th} fixed>
            <View style={[s.cSr, s.thCell]}>
              <Text>Sr#</Text>
            </View>
            <View style={[s.cDesc, s.thCell, { paddingVertical: 2 }]}>
              <Text>Item Description</Text>
            </View>
            <View style={[s.cQty, s.thCell]}>
              <Text>Quantity</Text>
            </View>
            <View style={[s.cUnit, s.thCell]}>
              <Text>Unit Pr. ({currency})</Text>
            </View>
            <View style={[s.cTotal, s.thCell, { alignItems: 'center', paddingRight: 0 }]}>
              <Text>Total Pr. ({currency})</Text>
            </View>
          </View>
          {q.lines.map((l, i) => {
            const d = itemDetail(l.description, data.brands?.[l.rfq_item_id] ?? null, delivery.perItem ? l.lead_time : null)
            return (
              <View key={l.rfq_item_id} style={s.tr} wrap={false}>
                <View style={s.cSr}>
                  <Text style={{ fontSize: 9 }}>{i + 1}</Text>
                </View>
                <View style={s.cDesc}>
                  <Text style={s.descLine}>{d.title}</Text>
                  {d.lines.map((x, k) => (
                    <Text key={k} style={s.descLine}>
                      {x.label ? <Text style={s.bold}>{x.label}: </Text> : null}
                      {x.text}
                    </Text>
                  ))}
                </View>
                <View style={s.cQty}>
                  <Text style={{ fontSize: 9 }}>{qtyWithUnit(l.qty, l.unit)}</Text>
                </View>
                <View style={s.cUnit}>
                  <Text style={{ fontSize: 9 }}>{money(l.unit_price_net)}</Text>
                </View>
                <View style={s.cTotal}>
                  <Text style={{ fontSize: 9 }}>{formatPaisa(totals.lines[i].net, 'auto')}</Text>
                </View>
              </View>
            )
          })}
        </View>
        <View style={s.gross} wrap={false}>
          <View style={s.grossLabel}>
            <Text>Gross Amount W/O GST</Text>
          </View>
          <View style={s.grossValue}>
            <Text style={s.bold}>{formatPaisa(totals.net, 'auto')}</Text>
          </View>
        </View>

        <View style={{ marginTop: 6 }} wrap={false}>
          <Text style={s.sectionTitle}>Terms and Conditions:</Text>
          {terms.map((t, i) => (
            <Text key={i} style={s.termLine}>
              {t.label ? <Text style={s.bold}>{t.label}</Text> : null}
              {t.label ? `: ${t.text}` : t.text}
            </Text>
          ))}
        </View>

        {profile.quotation_warranty?.trim() || profile.quotation_closing?.trim() ? (
          <View style={{ marginTop: 18 }} wrap={false}>
            {profile.quotation_warranty?.trim() ? (
              <>
                <Text style={[s.sectionTitle, { fontSize: 8.5 }]}>Warranty:</Text>
                <Text style={s.para}>{profile.quotation_warranty.trim()}</Text>
              </>
            ) : null}
            {profile.quotation_closing?.trim() ? <Text style={[s.para, { marginTop: 7 }]}>{profile.quotation_closing.trim()}</Text> : null}
          </View>
        ) : null}

        <View style={{ marginTop: 12 }} wrap={false}>
          {signName ? <Text style={s.signName}>{signName}</Text> : null}
          {cell ? <Text style={s.signLine}>Cell No: {cell}</Text> : null}
          {mail ? <Text style={[s.signLine, s.bold, { color: BLUE }]}>{mail}</Text> : null}
          {companyName ? <Text style={s.signCo}>{companyName}</Text> : null}
          {profile.website?.trim() ? <Text style={s.signLine}>{profile.website.trim()}</Text> : null}
        </View>

        <View style={s.foot} fixed>
          <View style={s.footRule} />
          <View style={s.footRow}>
            {profile.phone?.trim() ? (
              <View style={s.footItem}>
                <Icon kind="phone" />
                <Text style={s.footText}>{profile.phone.trim()}</Text>
              </View>
            ) : null}
            {profile.email?.trim() ? (
              <View style={s.footItem}>
                <Icon kind="mail" />
                <Text style={s.footText}>{profile.email.trim()}</Text>
              </View>
            ) : null}
            {footAddress.length > 0 ? (
              <View style={[s.footItem, { marginRight: 0, flexShrink: 1 }]}>
                <Icon kind="pin" />
                <View style={{ flexShrink: 1 }}>
                  {footAddress.map((a, i) => (
                    <Text key={i} style={s.footText}>
                      {a}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Page>
    </Document>
  )
}
