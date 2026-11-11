import { SumBar } from '@/ui/SumBar'

/** The SumBar desktop strip (clarity lane D0): one row, hairline top and bottom, no box. Below 768 it falls back to the tiles. */
export function SumBarStripScene() {
  return (
    <div className="w-[1000px] max-w-full bg-surface p-4">
      <SumBar
        desktop="strip"
        phone="lines"
        label="November cash summary"
        items={[
          { label: 'Gross in', amount: '2841150' },
          { label: 'GST portion', amount: '410514.40' },
          { label: 'Net in', amount: '2280635.60' },
          { label: 'Money out', amount: '1313300' },
          { label: 'Overdue', amount: '86000', tone: 'danger' },
          { label: 'Payments', count: 6 },
        ]}
      />
    </div>
  )
}
