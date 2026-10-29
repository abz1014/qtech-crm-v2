import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import type { Statement } from '@/features/statement/model'

/*
 * The Comparative Statement PDF (owner request, 2026-10-29). A4 LANDSCAPE, Geist, the company letterhead (company_profile and the
 * wordmark), like the invoice and the quotation. The tables are the screen's: one band per item (description, quantity), then one
 * row per supplier that quoted it, with lead time, weight and country of origin. The column headings are `fixed`, so they repeat at
 * the top of every page; every page has "Page n of N" at the foot.
 *
 * It selects nothing and says so: no "cheapest", no "recommended", suppliers in name order (or the order the person had sorted the
 * screen into). Costs are what the suppliers asked, never a selling price. Totals are per supplier and per currency.
 *
 * This module imports @react-pdf/renderer, so it is only reached through generate.ts's dynamic import (its own chunk).
 * No lineHeight on the page: react-pdf drops render-prop text when a page sets one, and the page number needs it.
 */
export interface StatementPdfData {
  statement: Statement
  /** "Job 139" and, when different, the RFQ it came from. */
  reference: string
  customer: string
  /** ISO day. */
  date: string
  preparedBy: string
  /** The "No reply" rows are on the sheet (the person ticked the toggle). */
  showNoReply: boolean
  /** "Sorted by supplier name" or the column the person sorted by; printed under the title so the order is never read as a ranking. */
  orderNote: string
}

const C = {
  ink: '#111113',
  muted: '#5a5a63',
  strong: '#d2d2d8',
  sunken: '#f4f4f6',
  band: '#e9e9ee',
}

const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 9, color: C.ink, paddingTop: 30, paddingBottom: 40, paddingHorizontal: 30 },
  mono: { fontFamily: 'Geist Mono' },
  muted: { color: C.muted },
  strongText: { fontWeight: 600 },
  right: { textAlign: 'right' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 10, borderBottomWidth: 1.5, borderBottomColor: C.ink },
  logo: { width: 140, height: 34, objectFit: 'contain' },
  company: { alignItems: 'flex-end', maxWidth: 330 },
  companyName: { fontSize: 10.5, fontWeight: 600 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, marginBottom: 6 },
  h1: { fontSize: 20, fontWeight: 600, letterSpacing: -0.4, marginBottom: 3 },
  meta: { width: 300 },
  metaRow: { flexDirection: 'row', marginBottom: 2.5 },
  metaLabel: { width: 76, textAlign: 'right', color: C.muted, paddingRight: 10 },
  metaValue: { flex: 1 },
  th: { flexDirection: 'row', backgroundColor: C.sunken, borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: C.strong, marginTop: 8, paddingVertical: 4, fontWeight: 600, fontSize: 8.5 },
  itemBand: { flexDirection: 'row', backgroundColor: C.band, paddingVertical: 4, paddingHorizontal: 4, marginTop: 6, fontWeight: 600 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.strong, paddingVertical: 4 },
  cSup: { width: 150, paddingLeft: 4, paddingRight: 6 },
  cUnit: { width: 92, textAlign: 'right', paddingRight: 6 },
  cTot: { width: 98, textAlign: 'right', paddingRight: 6 },
  cLead: { width: 92, paddingRight: 6 },
  cWt: { width: 62, textAlign: 'right', paddingRight: 6 },
  cWtT: { width: 66, textAlign: 'right', paddingRight: 6 },
  cOrg: { width: 82, paddingRight: 6 },
  cNote: { flex: 1, paddingRight: 4 },
  secTitle: { fontWeight: 600, fontSize: 10.5, paddingBottom: 3, marginBottom: 5, borderBottomWidth: 0.75, borderBottomColor: C.strong },
  totRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.strong, paddingVertical: 4 },
  tSup: { width: 240, paddingLeft: 4, paddingRight: 6 },
  tCount: { width: 90, paddingRight: 6 },
  tAmt: { width: 150, textAlign: 'right', paddingRight: 6 },
  note: { color: C.muted, fontSize: 8.5, marginTop: 10 },
  run: { position: 'absolute', top: 12, left: 30, right: 30 },
  runInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  runLogo: { width: 56, height: 14, objectFit: 'contain' },
  foot: { position: 'absolute', left: 30, right: 30, bottom: 16, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: C.strong, paddingTop: 4, fontSize: 8.5, color: C.muted },
})

const longDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]} ${y}`
}

/** The first line of a description is the item, any further lines are its detail. */
function splitDescription(text: string): { title: string; detail: string | null } {
  const [first, ...rest] = text.split(/\r?\n/)
  const detail = rest.join(' ').trim()
  return { title: first.trim(), detail: detail || null }
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
                <Text style={[s.muted, { fontSize: 8.5, textAlign: 'right' }]}>
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
          <View>
            <Text style={s.h1}>Comparative Statement</Text>
            <Text style={s.muted}>{data.orderNote}</Text>
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Job / RFQ</Text>
              <Text style={[s.metaValue, s.mono, s.strongText]}>{data.reference}</Text>
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
              <Text style={s.metaValue}>{data.preparedBy}</Text>
            </View>
          </View>
        </View>

        {/* The column headings repeat at the top of every page. */}
        <View style={s.th} fixed>
          <Text style={s.cSup}>Supplier</Text>
          <Text style={s.cUnit}>Unit cost</Text>
          <Text style={s.cTot}>Line total</Text>
          <Text style={s.cLead}>Lead time</Text>
          <Text style={s.cWt}>Weight each</Text>
          <Text style={s.cWtT}>Weight total</Text>
          <Text style={s.cOrg}>Country of origin</Text>
          <Text style={s.cNote}>Notes</Text>
        </View>

        {st.sections.length === 0 ? <Text style={[s.muted, { marginTop: 10 }]}>This RFQ has no items.</Text> : null}
        {st.sections.map(sec => {
          const d = splitDescription(sec.item.description)
          return (
            <View key={sec.item.id}>
              <View style={s.itemBand} minPresenceAhead={50} wrap={false}>
                <Text style={{ width: 20 }}>{sec.item.number}</Text>
                <Text style={{ flex: 1, paddingRight: 8 }}>
                  {d.title}
                  {d.detail ? <Text style={[s.muted, { fontWeight: 400 }]}>{`   ${d.detail}`}</Text> : null}
                </Text>
                <Text style={[s.mono, { fontWeight: 500 }]}>Qty {sec.quantityText}</Text>
              </View>
              {sec.rows.length === 0 && sec.noQuote.length === 0 ? (
                <View style={s.tr} wrap={false}>
                  <Text style={[s.cSup, s.muted]}>No supplier has quoted this item yet.</Text>
                </View>
              ) : null}
              {sec.rows.map(r => (
                <View key={r.lineId} style={s.tr} wrap={false}>
                  <Text style={[s.cSup, s.strongText]}>{r.supplierName}</Text>
                  <Text style={[s.cUnit, s.mono]}>{`${r.currency} ${r.unitCostText}`}</Text>
                  <Text style={[s.cTot, s.mono]}>{`${r.currency} ${r.totalText}`}</Text>
                  <Text style={s.cLead}>{r.leadTime ?? ''}</Text>
                  <Text style={[s.cWt, s.mono]}>{r.weightEachText ?? ''}</Text>
                  <Text style={[s.cWtT, s.mono]}>{r.weightTotalText ?? ''}</Text>
                  <Text style={s.cOrg}>{r.origin ?? ''}</Text>
                  <Text style={[s.cNote, s.muted]}>{r.note ?? ''}</Text>
                </View>
              ))}
              {data.showNoReply
                ? sec.noQuote.map(r => (
                    <View key={`n-${r.supplierId}`} style={s.tr} wrap={false}>
                      <Text style={[s.cSup, s.muted]}>{r.supplierName}</Text>
                      <Text style={[s.muted, { flex: 1 }]}>{r.reason}</Text>
                    </View>
                  ))
                : null}
            </View>
          )
        })}

        {st.totals.length > 0 ? (
          <View style={{ marginTop: 18 }} wrap={false} minPresenceAhead={60}>
            <Text style={s.secTitle}>Totals per supplier</Text>
            <View style={[s.totRow, { borderTopWidth: 0.75, borderTopColor: C.strong, backgroundColor: C.sunken, fontWeight: 600, fontSize: 8.5 }]}>
              <Text style={s.tSup}>Supplier</Text>
              <Text style={s.tCount}>Items quoted</Text>
              <Text style={s.tAmt}>Total cost</Text>
            </View>
            {st.totals.map(t => (
              <View key={t.supplierId} style={s.totRow}>
                <Text style={[s.tSup, s.strongText]}>{t.supplierName}</Text>
                <Text style={s.tCount}>{`${t.itemsQuoted} of ${t.itemCount}`}</Text>
                <View style={{ width: 150, paddingRight: 6 }}>
                  {t.byCurrency.map(c => (
                    <Text key={c.currency} style={[s.mono, s.right]}>{`${c.currency} ${c.totalText}`}</Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {st.totals.length > 0 ? (
          <Text style={s.note}>
              Costs are what the suppliers quoted, quantity times unit cost. Totals are per supplier and per currency; different currencies are never added together. A total only
              covers the items that supplier quoted. No supplier has been selected and no selling price is worked out here.
              {data.showNoReply && st.noReplyCount > 0 ? ` ${st.noReplyCount} ${st.noReplyCount === 1 ? 'supplier asked has' : 'suppliers asked have'} not replied.` : ''}
          </Text>
        ) : (
          <Text style={s.note}>No supplier has quoted yet. No supplier has been selected and no selling price is worked out here.</Text>
        )}

        <View fixed style={s.foot}>
          <Text>{`Comparative Statement ${data.reference}`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
