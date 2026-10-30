import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { QuotedRow, Statement } from '@/features/statement/model'

/*
 * The Comparative Statement PDF (owner request, 2026-10-29; made simpler and clearer the same day). A4 LANDSCAPE, Geist, the company
 * letterhead (company_profile and the wordmark) like the invoice and the quotation.
 *
 * Per item: a bold heading band ("1. Pressure transmitter, Qty: 12.5 m", the spec in smaller type under it), then one row per supplier that
 * quoted: Supplier | Unit cost | Total cost | Lead time | Weight (of one unit) | Country of origin. A note, when there is one, is a small
 * grey line under its row. Suppliers that did not reply or did not quote are ONE compact grey line under the item. An item is kept on one
 * page where it fits, and has its own column headings, so every page has them. Money has thousands separators and exactly 2 decimals
 * (rounded for display only); the currency is in the column heading when every row shares it, else in each cell. Empty cells show a dash.
 * The sheet ends with "Totals by supplier" (supplier, currency, total cost of the items it quoted, items quoted X of Y), and every page
 * has "Page n of N".
 *
 * It selects nothing and says nothing about a better supplier: no "cheapest", no "recommended"; suppliers are in name order (or the order
 * the person had sorted the screen into). Costs are what the suppliers quoted, never a selling price.
 *
 * This module imports @react-pdf/renderer, so it is only reached through generate.ts's dynamic import (its own chunk).
 * No lineHeight on the page: react-pdf drops render-prop text when a page sets one, and the page number needs it.
 */
export interface StatementPdfData {
  statement: Statement
  /** "Job 139 (RFQ-0139)". */
  reference: string
  customer: string
  /** ISO day. */
  date: string
  preparedBy: string
  /** The "did not reply" lines are on the sheet (the person ticked the toggle). */
  showNoReply: boolean
}

const C = {
  ink: '#111113',
  muted: '#5a5a63',
  soft: '#8a8a94',
  line: '#e4e4e9',
  strong: '#c8c8d0',
  band: '#eeeef2',
  head: '#f6f6f8',
}

const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 10.5, color: C.ink, paddingTop: 44, paddingBottom: 46, paddingHorizontal: 34 },
  muted: { color: C.muted },
  bold: { fontWeight: 600 },
  right: { textAlign: 'right' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 12, borderBottomWidth: 1.5, borderBottomColor: C.ink },
  logo: { width: 150, height: 36, objectFit: 'contain' },
  company: { alignItems: 'flex-end', maxWidth: 340 },
  companyName: { fontSize: 11.5, fontWeight: 600 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, marginBottom: 14 },
  h1: { fontSize: 22, fontWeight: 600 },
  meta: { width: 300 },
  metaRow: { flexDirection: 'row', marginBottom: 4 },
  metaLabel: { width: 82, textAlign: 'right', color: C.muted, paddingRight: 10 },
  metaValue: { flex: 1 },
  item: { marginBottom: 18 },
  itemBand: { backgroundColor: C.band, paddingVertical: 7, paddingHorizontal: 8 },
  itemTitle: { fontSize: 12, fontWeight: 600 },
  itemSpec: { fontSize: 9.5, color: C.muted, marginTop: 2 },
  th: { flexDirection: 'row', backgroundColor: C.head, borderBottomWidth: 0.75, borderBottomColor: C.strong, paddingVertical: 5, fontSize: 9.5, fontWeight: 600, color: C.muted },
  tr: { borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 7 },
  trRow: { flexDirection: 'row' },
  rowNote: { fontSize: 9.5, color: C.soft, paddingLeft: 8, paddingTop: 2 },
  cSup: { width: 210, paddingLeft: 8, paddingRight: 8 },
  cUnit: { width: 112, textAlign: 'right', paddingRight: 14 },
  cTot: { width: 124, textAlign: 'right', paddingRight: 14 },
  cLead: { width: 130, paddingRight: 8 },
  cWt: { width: 84, textAlign: 'right', paddingRight: 14 },
  cOrg: { flex: 1, paddingRight: 8 },
  noQuote: { fontSize: 9.5, color: C.soft, paddingTop: 6, paddingLeft: 8 },
  secTitle: { fontSize: 12, fontWeight: 600, marginBottom: 6 },
  tSup: { width: 280, paddingLeft: 8, paddingRight: 8 },
  tCur: { width: 90 },
  tAmt: { width: 150, textAlign: 'right', paddingRight: 14 },
  tCount: { flex: 1, paddingLeft: 14 },
  note: { color: C.soft, fontSize: 9.5, marginTop: 12 },
  run: { position: 'absolute', top: 14, left: 34, right: 34 },
  runInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  runLogo: { width: 60, height: 14.5, objectFit: 'contain' },
  foot: { position: 'absolute', left: 34, right: 34, bottom: 18, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 5, fontSize: 9.5, color: C.soft },
})

const longDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]} ${y}`
}

/** The first line of a description is the item, any further lines are its spec. */
function splitDescription(text: string): { title: string; spec: string | null } {
  const [first, ...rest] = text.split(/\r?\n/)
  const spec = rest.join(' ').trim()
  return { title: first.trim(), spec: spec || null }
}

const DASH = '—'

function SupplierRow({ r, shared }: { r: QuotedRow; shared: string | null }) {
  const money = (t: string) => (shared ? t : `${r.currency} ${t}`)
  return (
    <View style={s.tr} wrap={false}>
      <View style={s.trRow}>
        <Text style={[s.cSup, s.bold]}>{r.supplierName}</Text>
        <Text style={s.cUnit}>{money(r.unitCostText)}</Text>
        <Text style={s.cTot}>{money(r.totalText)}</Text>
        <Text style={s.cLead}>{r.leadTime ?? DASH}</Text>
        <Text style={s.cWt}>{r.weightEachText ?? DASH}</Text>
        <Text style={s.cOrg}>{r.origin ?? DASH}</Text>
      </View>
      {r.note ? <Text style={s.rowNote}>{r.note}</Text> : null}
    </View>
  )
}

export function StatementDocument({ data, profile, logoSrc }: { data: StatementPdfData; profile: CompanyProfile; logoSrc: string }) {
  const { statement: st } = data
  const companyName = profile.legal_name ?? ''
  const contactLine = [profile.phone, profile.email, profile.website].filter(Boolean).join('   ')

  return (
    <Document language="en-GB" title={`Comparative statement ${data.reference}`} author={companyName} subject={`Comparative statement ${data.reference} for ${data.customer}`}>
      <Page size="A4" orientation="landscape" style={s.page}>
        {/* From page 2 on: a slim running header (small wordmark; document, customer, date). */}
        <View
          fixed
          style={s.run}
          render={({ pageNumber }) =>
            pageNumber > 1 ? (
              <View style={s.runInner}>
                <Image src={logoSrc} style={s.runLogo} />
                <Text style={[s.muted, { fontSize: 9.5, textAlign: 'right' }]}>
                  Comparative Statement  {data.reference}  {data.customer}  {longDay(data.date)}
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
            {contactLine ? <Text style={[s.right, s.muted]}>{contactLine}</Text> : null}
          </View>
        </View>

        <View style={s.titleRow}>
          <Text style={s.h1}>Comparative Statement</Text>
          <View style={s.meta}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Job / RFQ</Text>
              <Text style={[s.metaValue, s.bold]}>{data.reference}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Customer</Text>
              <Text style={s.metaValue}>{data.customer}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Date</Text>
              <Text style={s.metaValue}>{longDay(data.date)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Prepared by</Text>
              <Text style={s.metaValue}>{data.preparedBy || DASH}</Text>
            </View>
          </View>
        </View>

        {st.sections.length === 0 ? <Text style={s.muted}>This RFQ has no items.</Text> : null}
        {st.sections.map(sec => {
          const d = splitDescription(sec.item.description)
          const cur = sec.sharedCurrency ? ` (${sec.sharedCurrency})` : ''
          return (
            <View key={sec.item.id} style={s.item} wrap={sec.rows.length > 10}>
              <View style={s.itemBand} minPresenceAhead={90}>
                <Text style={s.itemTitle}>{`${sec.item.number}. ${d.title} — Qty: ${sec.quantityText}`}</Text>
                {d.spec ? <Text style={s.itemSpec}>{d.spec}</Text> : null}
              </View>
              {sec.rows.length > 0 ? (
                <View style={s.th} fixed={false}>
                  <Text style={s.cSup}>Supplier</Text>
                  <Text style={s.cUnit}>{`Unit cost${cur}`}</Text>
                  <Text style={s.cTot}>{`Total cost${cur}`}</Text>
                  <Text style={s.cLead}>Lead time</Text>
                  <Text style={s.cWt}>Weight</Text>
                  <Text style={s.cOrg}>Country of origin</Text>
                </View>
              ) : (
                <Text style={s.noQuote}>No supplier has quoted this item yet.</Text>
              )}
              {sec.rows.map(r => (
                <SupplierRow key={r.lineId} r={r} shared={sec.sharedCurrency} />
              ))}
              {data.showNoReply && sec.noQuote.length > 0 ? (
                <Text style={s.noQuote}>{sec.noQuote.map(g => `${g.label}: ${g.names.join(', ')}`).join('  ·  ')}</Text>
              ) : null}
            </View>
          )
        })}

        {st.totals.length > 0 ? (
          <View wrap={false}>
            <Text style={s.secTitle}>Totals by supplier</Text>
            <View style={s.th}>
              <Text style={s.tSup}>Supplier</Text>
              <Text style={s.tCur}>Currency</Text>
              <Text style={s.tAmt}>Total cost</Text>
              <Text style={s.tCount}>Items quoted</Text>
            </View>
            {st.totals.flatMap(t =>
              t.byCurrency.map((c, i) => (
                <View key={`${t.supplierId}-${c.currency}`} style={[s.tr, s.trRow]}>
                  <Text style={[s.tSup, s.bold]}>{i === 0 ? t.supplierName : ''}</Text>
                  <Text style={s.tCur}>{c.currency}</Text>
                  <Text style={s.tAmt}>{c.totalText}</Text>
                  <Text style={s.tCount}>{i === 0 ? `${t.itemsQuoted} of ${t.itemCount}` : ''}</Text>
                </View>
              )),
            )}
            <Text style={s.note}>
              Cost is what each supplier quoted: quantity times unit cost. A total covers only the items that supplier quoted, and different currencies are never added together.
            </Text>
          </View>
        ) : (
          <Text style={s.note}>No supplier has quoted yet.</Text>
        )}

        <View fixed style={s.foot}>
          <Text>{`Comparative Statement ${data.reference}`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
