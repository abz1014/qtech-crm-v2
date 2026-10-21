import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { formatPaisa, toPaisa, type Amount } from '@/lib/money'
import type { ExpenseReportView } from '@/features/money/expenseReport/model'

/*
 * The Expenses report as a printable A4 PDF: the same figures as the screen (one view object), in the family of the invoice and
 * quotation (Geist, the wordmark, hairlines, PKR as text). Only reached through generate.ts's dynamic import, so @react-pdf stays
 * out of the first load. Colours are the design tokens' hex values (a PDF has no CSS variables).
 */
const C = { ink: '#111113', muted: '#5a5a63', line: '#d2d2d8', sunken: '#f4f4f6' }
const s = StyleSheet.create({
  page: { fontFamily: 'Geist', fontSize: 9.5, color: C.ink, paddingTop: 32, paddingBottom: 40, paddingHorizontal: 36 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 10, borderBottomWidth: 1.5, borderBottomColor: C.ink },
  logo: { width: 130, height: 31.6, objectFit: 'contain' },
  h1: { fontSize: 20, fontWeight: 600, marginTop: 14 },
  sub: { color: C.muted, marginTop: 3 },
  tiles: { flexDirection: 'row', marginTop: 14, borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: C.line },
  tile: { flex: 1, paddingVertical: 8, paddingRight: 8 },
  tileLabel: { color: C.muted, fontSize: 8.5 },
  tileValue: { fontSize: 12.5, fontWeight: 600, marginTop: 2 },
  h2: { fontSize: 11.5, fontWeight: 600, marginTop: 16, marginBottom: 4 },
  th: { flexDirection: 'row', backgroundColor: C.sunken, borderTopWidth: 0.75, borderBottomWidth: 0.75, borderColor: C.line, paddingVertical: 4, fontWeight: 600, fontSize: 8.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 4 },
  group: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 5, backgroundColor: C.sunken, fontWeight: 600 },
  name: { flex: 1, paddingLeft: 4, paddingRight: 6 },
  num: { width: 76, textAlign: 'right', paddingRight: 4 },
  pct: { width: 44, textAlign: 'right', paddingRight: 4 },
  date: { width: 52, paddingLeft: 4 },
  foot: { position: 'absolute', bottom: 18, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', color: C.muted, fontSize: 8 },
})

const r = (v: Amount) => formatPaisa(toPaisa(v), 'never')
const signed = (v: Amount) => (toPaisa(v) > 0n ? `+${r(v)}` : r(v))
const day = (iso: string) => `${Number(iso.slice(8))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]}`

export function ExpenseReportDocument({ v, logoSrc, printedOn }: { v: ExpenseReportView; logoSrc: string; printedOn: string }) {
  return (
    <Document title={`Expenses, ${v.label}`} author="Q-Tech CRM">
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <Image src={logoSrc} style={s.logo} />
          <Text style={{ color: C.muted }}>Printed {printedOn}</Text>
        </View>
        <Text style={s.h1}>Expenses, {v.label}</Text>
        <Text style={s.sub}>
          All amounts in PKR, as paid (input tax included). {v.frozenMonths > 0 ? 'Closed months: figures frozen at close.' : ''}
        </Text>
        <View style={s.tiles}>
          <View style={s.tile}>
            <Text style={s.tileLabel}>Spent</Text>
            <Text style={s.tileValue}>{r(v.total.amount)}</Text>
            <Text style={s.tileLabel}>{v.total.count} expenses</Text>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>{v.prevLabel}</Text>
            <Text style={s.tileValue}>{r(v.prev.amount)}</Text>
            <Text style={s.tileLabel}>Change {signed(v.change)}{v.changePct === null ? '' : ` (${v.changePct > 0 ? '+' : ''}${v.changePct}%)`}</Text>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>Cash / bank</Text>
            <Text style={s.tileValue}>{r(v.total.cash)} / {r(v.total.bank)}</Text>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>In profit and loss</Text>
            <Text style={{ marginTop: 2 }}>Running costs {r(v.kinds.running)}</Text>
            <Text>Order costs {r(v.kinds.order)}</Text>
            <Text>Not a cost {r(v.kinds.notCost)} · input tax {r(v.kinds.inputTax)}</Text>
          </View>
        </View>

        <Text style={s.h2}>Where the money went</Text>
        <View style={s.th} fixed>
          <Text style={s.name}>Group and category</Text>
          <Text style={s.num}>Paid</Text>
          <Text style={s.pct}>%</Text>
          <Text style={s.num}>{v.prevLabel.replace(/ \(.*\)$/, '')}</Text>
          <Text style={s.num}>Budget</Text>
        </View>
        {v.groups.map(g => (
          <View key={g.id} wrap={false}>
            <View style={s.group}>
              <Text style={s.name}>{g.name}</Text>
              <Text style={s.num}>{r(g.amount)}</Text>
              <Text style={s.pct}>{g.share}%</Text>
              <Text style={s.num}>{r(g.prev)}</Text>
              <Text style={s.num}>{g.budget === null ? '' : r(g.budget)}</Text>
            </View>
            {g.categories.map(c => (
              <View key={c.id} style={s.tr}>
                <Text style={[s.name, { paddingLeft: 12 }]}>
                  {c.name}
                  {c.details.some(d => d.detail) ? `  (${c.details.slice(0, 4).map(d => `${d.detail ?? 'no detail'} ${r(d.amount)}`).join(', ')}${c.details.length > 4 ? ', ...' : ''})` : ''}
                </Text>
                <Text style={s.num}>{r(c.amount)}</Text>
                <Text style={s.pct}>{c.share}%</Text>
                <Text style={s.num}>{r(c.prev)}</Text>
                <Text style={s.num}>{c.budget === null ? '' : r(c.budget)}</Text>
              </View>
            ))}
          </View>
        ))}
        <View style={[s.group, { backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: C.ink }]}>
          <Text style={s.name}>Total</Text>
          <Text style={s.num}>{r(v.total.amount)}</Text>
          <Text style={s.pct}>100%</Text>
          <Text style={s.num}>{r(v.prev.amount)}</Text>
          <Text style={s.num}>{v.budget === null ? '' : r(v.budget)}</Text>
        </View>

        <View wrap={false}>
          <Text style={s.h2}>Top {v.top.length} expenses</Text>
          {v.top.map(e => (
            <View key={e.id} style={s.tr}>
              <Text style={s.date}>{day(e.paidOn)}</Text>
              <Text style={s.name}>{[e.detail, e.who].filter(Boolean).join(' · ') || '—'}</Text>
              <Text style={s.pct}>{e.paidVia === 'cash' ? 'Cash' : 'Bank'}</Text>
              <Text style={s.num}>{r(e.amount)}</Text>
            </View>
          ))}
        </View>

        <View wrap={false}>
          <Text style={s.h2}>{v.period.kind === 'month' ? 'Last 6 months' : 'Last 4 quarters'}</Text>
          {v.trend.map(t => (
            <View key={t.period.key} style={s.tr}>
              <Text style={[s.name, t.current ? { fontWeight: 600 } : {}]}>{t.label}</Text>
              <Text style={s.num}>{r(t.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={s.foot} fixed>
          <Text>Q-Tech CRM · Expenses, {v.label}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
