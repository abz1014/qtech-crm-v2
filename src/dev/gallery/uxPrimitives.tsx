// Gallery entries for the UX audit 2026-10-19 building blocks: InfoTip (footnotes become (i) tips) and the phone one-bar
// (useMobileBar with back, title, actions and hideTabs). useChannelPreference has no look of its own.
import { CircleX, Copy, Ellipsis } from 'lucide-react'
import { Section } from '@/dev/gallery/layout'
import type { SessionUser } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { MobileBarProvider } from '@/app/shell/MobileBarProvider'
import { MobileBar } from '@/app/shell/MobileChrome'
import { Button } from '@/ui/Button'
import { InfoTip } from '@/ui/InfoTip'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/** Three places an (i) goes: beside a panel heading, beside a figure's label, beside a field label. */
export function InfoTipExamples() {
  return (
    <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
      <div className="grid content-start gap-2">
        <p className="text-xs text-fg-muted">Beside a panel heading</p>
        {/* A <p> here so the scene (h1, then this) keeps a valid heading order; on a screen it is the panel's own heading. */}
        <p className="flex items-center gap-1 text-base font-semibold">
          To collect
          <InfoTip label="About To collect">
            What customers still owe on invoices we have sent, oldest first. An invoice leaves the list when its payment is recorded.
          </InfoTip>
        </p>
      </div>
      <div className="grid content-start gap-2">
        <p className="text-xs text-fg-muted">Beside a figure</p>
        <div className="grid gap-1">
          <span className="flex items-center gap-1 text-sm text-fg-muted">
            Margin not final
            <InfoTip label="Why is the margin not final?">Some costs on this order are still estimates. The margin changes when they are final.</InfoTip>
          </span>
          <span className="num text-xl font-semibold">PKR 182,400</span>
        </div>
      </div>
      <div className="grid content-start gap-2">
        <p className="text-xs text-fg-muted">Beside a field label</p>
        <div className="grid gap-1">
          <span className="flex items-center gap-1 text-sm font-medium">
            PSID
            <InfoTip label="About PSID">The payment slip ID FBR gives for a tax deposit. One PSID can cover several invoices.</InfoTip>
          </span>
          <span className="num text-sm">1092-2026-000418</span>
        </div>
      </div>
    </div>
  )
}

export function InfoTipSection() {
  return (
    <Section
      id="infotip"
      title="InfoTip"
      note="A small (i) that opens one short explanation, in place of a footnote under a panel. Click, tap or Enter opens it; Esc or a second press closes it. Open, it is a scene (Tooltip and Popover)."
    >
      <div className="rounded-panel border bg-surface p-6">
        <InfoTipExamples />
      </div>
    </Section>
  )
}

const DEMO_USER: SessionUser = { id: 'gallery', name: 'Ayesha Rana', role: 'sales' }

/** The "more" menu a detail page puts in the bar's right slot: a 44px icon button opening a menu Popover. */
function MoreMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="quiet" size="touch" icon={Ellipsis} aria-label="More actions" />
      </PopoverTrigger>
      <PopoverContent variant="menu" align="end" aria-label="More actions">
        <MenuItem icon={Copy}>Copy RFQ number</MenuItem>
        <MenuItem icon={CircleX}>Close RFQ</MenuItem>
      </PopoverContent>
    </Popover>
  )
}

function DetailPage() {
  useMobileBar({ title: 'RFQ-0177', back: 'history', fallback: '/rfqs', actions: <MoreMenu />, hideTabs: true })
  return <p className="p-4 text-sm text-fg-muted">The page’s own content. No tab bar under it: this page asked for hideTabs and has its own sticky action bar.</p>
}

/** Not photographed: it draws the shell's own bar (src/app/shell), whose changes do not run the gallery job. */
export function PhoneBarSection() {
  return (
    <Section
      id="phonebar"
      title="Phone one-bar"
      note="A phone detail page calls useMobileBar({ title, back: 'history', fallback, actions, hideTabs }) and gets one bar: back, its title, its actions. The default bar's logo, search, Capture and avatar are not shown, and hideTabs drops the tab bar."
    >
      <div className="w-[375px] max-w-full overflow-hidden rounded-panel border bg-canvas [&_header]:!flex">
        <MobileBarProvider>
          <MobileBar user={DEMO_USER} title="RFQs" />
          <DetailPage />
        </MobileBarProvider>
      </div>
    </Section>
  )
}
