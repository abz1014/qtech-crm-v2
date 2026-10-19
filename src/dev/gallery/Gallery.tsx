import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bell, Download, Plus, Search, Trash2 } from 'lucide-react'
import { Panel, Row, Section } from '@/dev/gallery/layout'
import { ComboScene, CompanyForm, Controls, Feedback, Files, Misc, Overlays, SCENES, SceneView } from '@/dev/gallery/scenes'
import { DateRailSection, EmptyCards, MorePrimitivesSection, TextSizeSection, TooltipSection } from '@/dev/gallery/primitives'
import { StatusMoneyTableSections } from '@/dev/gallery/tables'
import { Avatar } from '@/ui/Avatar'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon, type IconSize } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import { CountPill, ProgressBar, ProgressSegments, Tag } from '@/ui/Tag'

/*
 * /dev/gallery (U09): every built primitive and every D08 state on one page, dev builds only.
 * Overlays that cannot sit on the page (dialogs, palette, toasts, open combobox) are scenes at
 * ?scene=<name>. Playwright photographs the page and each scene at 1440 and 375 wide, and runs axe on them.
 * DateRail, StepList, ProgressBar and InlineEditRow are in dev/gallery/primitives.tsx.
 */
const ICON_SIZES: IconSize[] = ['chip', 'sm', 'md', 'lg', 'xl']

const NAV = [
  ['foundations', 'Foundations'],
  ['textsize', 'Text size'],
  ['forms', 'Forms'],
  ['navigation', 'Navigation'],
  ['feedback', 'Feedback'],
  ['status', 'Status'],
  ['money', 'Money'],
  ['sumbar', 'SumBar'],
  ['rfq', 'DataTable'],
  ['cards', 'Phone cards'],
  ['rail', 'DateRail'],
  ['more', 'Progress, steps, inline edit'],
  ['tooltip', 'Tooltip'],
  ['overlays', 'Overlays'],
] as const

function Foundations() {
  return (
    <Section id="foundations" title="Foundations" note="Icon, Button, Kbd, Avatar, Tag, CountPill, ProgressSegments, Skeleton.">
      <div className="rounded border bg-surface px-5">
        <Row title="Icon" note="Sizes 12, 14, 16, 20, 24. Inside a status chip the glyph is 16 (12 with smaller text). Decorative by default.">
          {ICON_SIZES.map(s => (
            <Icon key={s} icon={Bell} size={s} />
          ))}
        </Row>
        <Row title="Button, variants" note="Primary, secondary, quiet, danger. Then disabled and busy.">
          <Button variant="primary">Save</Button>
          <Button>Cancel</Button>
          <Button variant="quiet">Skip</Button>
          <Button variant="danger" icon={Trash2}>
            Delete
          </Button>
          <Button variant="primary" disabled>
            Save
          </Button>
          <Button disabled>Cancel</Button>
          <Button variant="primary" busy busyLabel="Saving">
            Save
          </Button>
        </Row>
        <Row title="Button, sizes" note="44, 40, 36 and the 44 touch size (40, 32, 28 with smaller text). Icon-only needs an aria-label.">
          <Button size="lg" icon={Plus}>
            New RFQ
          </Button>
          <Button icon={Plus}>New RFQ</Button>
          <Button size="sm" icon={Plus}>
            New RFQ
          </Button>
          <Button size="touch" icon={Plus}>
            New RFQ
          </Button>
          <Button icon={Search} aria-label="Search" />
          <Button size="sm" icon={Download} aria-label="Export" variant="quiet" />
        </Row>
        <Row title="Kbd" note="Key hints.">
          <Kbd>⌘K</Kbd>
          <Kbd>Esc</Kbd>
          <Kbd>Enter</Kbd>
        </Row>
        <Row title="Avatar" note="28 in lists and the top bar, 24 inside key figures.">
          <Avatar name="Asad Saleem" />
          <Avatar name="Waqar Anwar" size="sm" />
        </Row>
        <Row title="Tag, CountPill" note="Mono identifiers, dashed when not firm. Counts beside tab names.">
          <Tag>ORD-0038</Tag>
          <Tag dashed>no PO yet</Tag>
          <CountPill>4</CountPill>
          <CountPill>12</CountPill>
        </Row>
        <Row title="ProgressBar" note="The continuous bar, named by its sentence.">
          <div className="grid w-full max-w-[420px] gap-2">
            <ProgressBar done={3} total={5} label="3 of 5 items covered" />
            <p className="text-xs text-fg-muted">
              <span className="num">3</span> of <span className="num">5</span> items covered
            </p>
          </div>
        </Row>
        <Row title="ProgressSegments" note="n of m, with the count in words.">
          <ProgressSegments done={0} total={5} />
          <ProgressSegments done={3} total={5} />
          <ProgressSegments done={5} total={5} />
        </Row>
        <Row title="Skeleton" note="Loading placeholder for text, rows and cards.">
          <div className="grid w-full max-w-[420px] gap-2">
            <Skeleton className="w-1/3" />
            <Skeleton className="w-full" />
            <Skeleton className="w-4/5" />
          </div>
        </Row>
      </div>
    </Section>
  )
}

function Forms() {
  return (
    <Section
      id="forms"
      title="Forms"
      note="TextField, NumberInput, TextArea, Select, Combobox, Checkbox, Radio, Form and Field states, FileDrop and FileRow."
    >
      <Controls />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Form: resting">
          <CompanyForm mode="resting" />
        </Panel>
        <Panel title="Form: validation">
          <CompanyForm mode="validation" />
        </Panel>
        <Panel title="Form: unique violation">
          <CompanyForm mode="unique" />
        </Panel>
        <Panel title="Form: submitting">
          <CompanyForm mode="submitting" />
        </Panel>
        <Panel title="Form: network failure">
          <CompanyForm mode="failure" />
        </Panel>
        <Panel title="Combobox (closed here; open is a scene)">
          <ComboScene />
        </Panel>
        <Panel title="FileDrop: resting">
          <Files mode="resting" />
        </Panel>
        <Panel title="FileRow: added, and too large">
          <Files mode="rows" />
        </Panel>
      </div>
    </Section>
  )
}

function FeedbackSection() {
  const [retried, setRetried] = useState(false)
  return (
    <Section id="feedback" title="Feedback" note="Banner, ToggleButton, Callout, InlineConfirm, and the four EmptyState cards (goal, first use, no results, not available to this role).">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Banner tone="info" title="Rates are set by an admin">
          Only admins can change them on Money.
        </Banner>
        <Banner tone="warning" title="Rate is 14 days old" action={<Button size="sm">Update rate</Button>}>
          It is still used, and flagged on every figure.
        </Banner>
        <Banner tone="danger" title="Couldn’t save the answer">
          Nothing was changed. Check your connection and try again.
        </Banner>
        <Banner tone="success" title="Sent to 4 suppliers">
          Sent today. You can undo for 10 seconds.
        </Banner>
      </div>
      <Feedback />
      <EmptyCards />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Panel title="EmptyState: goal (in a container)">
          <EmptyState mood="goal" title="Every quotation is sent" actions={<Button variant="primary">New RFQ</Button>}>
            Nothing is open and nothing is due in the next 5 days.
          </EmptyState>
        </Panel>
        <Panel title="EmptyState: neutral (in a container)">
          <EmptyState title={'No RFQs match “Belimo”'} actions={<Button>Clear filter</Button>}>
            Try fewer words or clear the filter.
          </EmptyState>
        </Panel>
        <Panel title="EmptyState: error">
          <EmptyState
            mood="error"
            title="Couldn’t load RFQs"
            actions={<Button onClick={() => setRetried(true)}>Try again</Button>}
            meta={retried ? 'Reference 4f1c9a, retried' : 'Reference 4f1c9a'}
          >
            Your changes are safe. Check your connection and try again.
          </EmptyState>
        </Panel>
      </div>
    </Section>
  )
}

function OverlayIndex() {
  const groups = Object.entries(SCENES).reduce<Record<string, Array<[string, string]>>>((acc, [name, s]) => {
    const list = acc[s.group] ?? []
    list.push([name, s.label])
    acc[s.group] = list
    return acc
  }, {})
  return (
    <Section
      id="overlays"
      title="Overlays"
      note="Each of these renders on its own page so it can be photographed and checked without the rest of the gallery behind it."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(groups).map(([group, items]) => (
          <Panel key={group} title={group}>
            <ul className="grid gap-1 text-sm">
              {items.map(([name, label]) => (
                <li key={name}>
                  <Link className="underline underline-offset-2" to={`/dev/gallery?scene=${name}`}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
      <Panel title="Tooltip, menu and information popover (live)">
        <Overlays />
      </Panel>
    </Section>
  )
}

export default function Gallery() {
  const [params] = useSearchParams()
  const scene = params.get('scene')
  if (scene) return <SceneView name={scene} />
  return (
    <main className="mx-auto grid max-w-[1280px] grid-cols-1 content-start gap-12 px-4 pb-24 pt-8 md:px-8 md:pt-10">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Component gallery</h1>
        <p className="max-w-prose text-sm text-fg-muted">
          Every built primitive and its D08 states. Dev builds only. Compare against docs/design/screens/components-*.png.
        </p>
        <nav aria-label="Gallery sections">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {NAV.map(([id, label]) => (
              <li key={id}>
                <a className="underline underline-offset-2" href={`#${id}`}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <Foundations />
      <TextSizeSection />
      <Forms />
      <Section id="navigation" title="Navigation" note="SegmentedControl, Tabs, Breadcrumb.">
        <Misc />
      </Section>
      <FeedbackSection />
      <StatusMoneyTableSections />
      <DateRailSection />
      <MorePrimitivesSection />
      <TooltipSection />
      <OverlayIndex />
    </main>
  )
}
