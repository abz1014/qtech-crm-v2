import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Building2, ChevronLeft, ChevronRight, FilePlus2, GitMerge, Link2, MessageCircle, Pencil, Phone, Plus, Trash2 } from 'lucide-react'
import {
  useCompany,
  useCompanyContacts,
  useCompanyHistory,
  useCompanyMoney,
  useCompanySites,
  useRemoveContact,
  useSupplierRecordView,
  useSupplierStats,
} from '@/features/companies/hooks'
import type { CompanyDetail, ContactRow, SiteRow } from '@/features/companies/api'
import { ContactDialog, EditCompanyDialog, SiteDialog } from '@/features/companies/CompanyDialogs'
import { ConfirmRemove, CountText, Fine, KeyValue, Panel, RoleChip } from '@/features/companies/CompanyParts'
import { removeErrorMessage } from '@/features/companies/removeError'
import { BrandsCarried } from '@/features/companies/BrandsPanel'
import { MergeCompanyDialog } from '@/features/companies/MergeCompanyDialog'
import { SitesPanel } from '@/features/companies/SitesPanel'
import { SupplierPanel } from '@/features/companies/SupplierPanel'
import { companyMeta, monthYearOf } from '@/features/companies/companyMeta'
import { factNotes, recordLine, supplierFacts } from '@/features/companies/supplierFacts'
import { earliestYear } from '@/features/companies/supplierRecord'
import { copyToClipboard } from '@/lib/clipboard'
import { OpenWithThem } from '@/features/companies/SupplierRecordPanels'
import { BuyerTaxFields } from '@/features/money/invoices/pdf/BuyerTaxFields'
import { CreditPanel } from '@/features/money/credit/CreditPanel'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DetailHeader } from '@/ui/DetailHeader'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { waLink } from '@/lib/messageLinks'
import { Money } from '@/ui/Money'
import { MoreMenu } from '@/ui/MoreMenu'
import { LastChanged } from '@/features/history/LastChanged'
import { useHistoryPanel } from '@/features/history/useHistoryPanel'
import { useDeleteCompanyFlow } from '@/features/companies/deleteFlow'
import { NextStepBox } from '@/ui/NextStepBox'
import { MenuItem } from '@/ui/Popover'
import { Skeleton } from '@/ui/Skeleton'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { useToast } from '@/ui/useToast'

/*
 * Company page (R02; g2-company.html). Customer and supplier are one record: the role is derived from
 * what we have done with the company, so the same page grows the supplier's history the first time an enquiry
 * is sent, and sites with their RFQs and orders the first time an RFQ arrives.
 *
 * Layout (UX audit 2026-10-19, 9b): the main column is the useful history (a supplier's recent quotes and
 * deliveries first; a customer's sites), the side column is Contacts, "Open with them", "Money with them"
 * (admin) and one compact Details panel (customer since, brands carried); the role is said once, as a Tag in the
 * header's meta line (identity, not state: never a chip in the h1).
 *
 * Header (round-2 spec 5.3): the shared DetailHeader with the name, the meta line and the More menu (Edit, Copy link,
 * New RFQ asking them for prices on a company that is also a customer, Merge for admin). The page's one green action
 * is New RFQ, in the shared NextStepBox under the title (a bar at the bottom on a phone): with this company as the
 * customer, or for a supplier-only company with it already chosen as a supplier to ask (/rfqs/new?supplier=).
 *
 * Access (DATA_MODEL section 10): everyone signed in reads and edits the company, its sites, contacts and
 * brands. The money panel and the merge action are admin only; they are not rendered for anyone else, and
 * the database refuses them anyway (v_order_money and merge_companies check the role).
 */
/** The record line's parts, with two number-led parts side by side ("quoted 4 · 4 orders") kept as one unit so a wrap never leaves "quoted 4" over "4 orders". */
function recordUnits(line: string): string[][] {
  const units: string[][] = []
  for (const part of line.split(' · ')) {
    const last = units[units.length - 1]
    if (last && /\d$/.test(last[last.length - 1]!) && /^\d/.test(part)) last.push(part)
    else units.push([part])
  }
  return units
}

export function CompanyPage() {
  const { id } = useParams()
  const company = useCompany(id)

  if (company.isPending) return <PageSkeleton />
  if (company.isError) {
    return (
      <Shell>
        <EmptyState
          mood="error"
          title="Couldn't load this company"
          actions={
            <Button onClick={() => void company.refetch()} variant="primary">
              Try again
            </Button>
          }
        >
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      </Shell>
    )
  }
  if (!company.data) {
    return (
      <Shell>
        <EmptyState
          icon={Building2}
          title="This company isn't here"
          actions={
            <AllCompaniesButton />
          }
        >
          It may have been merged into another company, or the link is wrong. Search for it by name to find where it went.
        </EmptyState>
      </Shell>
    )
  }
  // keyed: what the page first showed (becameSupplierHere) belongs to one company
  return <Loaded key={company.data.id} company={company.data} />
}

function AllCompaniesButton() {
  const navigate = useNavigate()
  return (
    <Button variant="primary" icon={ChevronLeft} onClick={() => navigate('/companies')}>
      All companies
    </Button>
  )
}

/** `sticky`: the phone shows New RFQ in the StickyActionBar fixed to the bottom, so the page leaves room for it. */
function Shell({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return <div className={cn('mx-auto w-full max-w-detail px-4 pb-16 pt-6 md:px-8', sticky && 'max-md:pb-[calc(var(--control-lg-h)+2rem)]')}>{children}</div>
}

function PageSkeleton() {
  return (
    <Shell>
      <div role="status" className="grid gap-4" aria-busy="true" aria-label="Loading company">
        <Skeleton className="h-4 w-[10rem]" />
        <Skeleton className="h-8 w-[20rem]" />
        <Skeleton className="h-4 w-[14rem]" />
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-[16rem] w-full" />
          <Skeleton className="h-[16rem] w-full" />
        </div>
      </div>
    </Shell>
  )
}

function Loaded({ company }: { company: CompanyDetail }) {
  const navigate = useNavigate()
  const session = useSession()
  const { toast } = useToast()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'

  const sites = useCompanySites(company.id)
  const contacts = useCompanyContacts(company.id)
  const history = useCompanyHistory(company.id, session.status === 'signed-in' && session.user.role !== 'engineer')
  const money = useCompanyMoney(company.id, isAdmin)
  const record = useSupplierRecordView(company.id, company.isSupplier)
  // The same read as "What we know" (one cache entry): its counts in one line under the name.
  const stats = useSupplierStats(company.id, company.isSupplier)
  const facts = supplierFacts(stats.data ?? null)
  const supplierRecordLine = company.isSupplier && facts ? recordLine(facts) : null

  // 'site' and 'contact' are the add dialogs; editSite and editContact open the same dialogs filled in.
  const [dialog, setDialog] = useState<null | 'edit' | 'site' | 'contact' | 'merge'>(null)
  const [editSite, setEditSite] = useState<SiteRow | null>(null)
  const [editContact, setEditContact] = useState<ContactRow | null>(null)
  const close = (open: boolean) => {
    if (!open) {
      setDialog(null)
      setEditSite(null)
      setEditContact(null)
    }
  }

  const supplierSide = company.isSupplier
  const customerSide = company.isCustomer || !company.isSupplier
  const rfqCount = history.data?.rfqs.length ?? 0
  const orderCount = history.data?.orders.length ?? 0
  const lowData = (record.query.data?.inquiries.length ?? 0) < 3
  const sinceYear = earliestYear(record.query.data, company.createdAt)
  const meta = companyMeta({
    city: company.city,
    country: company.country,
    isSupplier: supplierSide,
    isCustomer: company.isCustomer,
    legacyImported: company.legacyImported,
    createdAt: company.createdAt,
    lowData,
    currency: record.view?.open.currency ?? null,
    sinceYear,
    counts: history.data ? { sites: sites.data?.length ?? 0, rfqs: rfqCount, orders: orderCount } : null,
  })
  const customerSince = (() => {
    const years = [
      ...(history.data?.rfqs.map(r => r.receivedOn) ?? []),
      ...(history.data?.orders.map(o => o.orderedOn).filter((d): d is string => Boolean(d)) ?? []),
    ].map(d => Number(d.slice(0, 4)))
    return years.length > 0 ? Math.min(...years) : Number(company.createdAt.slice(0, 4))
  })()
  const copyLink = async () => {
    const ok = await copyToClipboard(window.location.href)
    toast({ title: ok ? 'Link copied' : "Couldn't copy the link", body: ok ? company.name : 'Copy it from the address bar.', tone: ok ? 'success' : 'danger' })
  }

  // A supplier-only company has no plants to list until one is added; a customer always shows its sites.
  const showSites = company.isCustomer || !company.isSupplier || (sites.data?.length ?? 0) > 0 || sites.isPending
  const supplierOnly = supplierSide && !company.isCustomer
  // Adding the first brand (or enquiry) makes a company with no role a supplier while the page is open: its Details move into
  // "More about this supplier". Open the fold then, or the brand just added vanishes from under the person.
  const [becameSupplierHere] = useState(() => !supplierOnly)
  // The page's one green action: New RFQ with this company as the customer; on a supplier-only page, New RFQ with this supplier
  // already chosen to ask for prices (IntakeScreen reads ?supplier=). A company that is both keeps the second in the More menu.
  const newRfq = () => navigate(supplierOnly ? `/rfqs/new?supplier=${company.id}` : `/rfqs/new?company=${company.id}`)
  const askForPrices = () => navigate(`/rfqs/new?supplier=${company.id}`)
  const phone = useMediaQuery('(max-width: 767px)')
  const primary = (
    <Button variant="primary" icon={FilePlus2} size={phone ? 'touch' : undefined} onClick={newRfq}>
      New RFQ
    </Button>
  )

  // The "More" menu: Edit, Copy link, New RFQ asking them (a customer that also supplies us), Merge (admin). On a phone it is the
  // one bar's right slot; from tablet up the "More" text button beside the name.
  const del = useDeleteCompanyFlow({ id: company.id, name: company.name }, { rfqs: rfqCount, orders: orderCount }, () => setDialog('merge'))
  const recordHistory = useHistoryPanel({ table: 'companies', id: company.id, context: company.name })
  const moreMenu = (touch: boolean) => (
    <MoreMenu touch={touch} label="More actions" menuClassName="min-w-[280px]">
      <MenuItem icon={Pencil} onClick={() => setDialog('edit')}>
        Edit company
      </MenuItem>
      {recordHistory.item}
      <MenuItem icon={Link2} onClick={() => void copyLink()}>
        Copy link to this company
      </MenuItem>
      {supplierSide && !supplierOnly ? (
        <MenuItem icon={FilePlus2} onClick={askForPrices}>
          New RFQ asking them for prices
        </MenuItem>
      ) : null}
      {isAdmin ? (
        <MenuItem icon={GitMerge} onClick={() => setDialog('merge')}>
          Merge into another company
        </MenuItem>
      ) : null}
      {del.ask ? (
        <MenuItem icon={Trash2} danger onClick={del.ask}>
          Delete company
        </MenuItem>
      ) : null}
    </MoreMenu>
  )
  // Phones get one bar: back (to where the person came from, else the companies list), the name, and the menu; New RFQ sits in
  // the bar at the bottom instead of the tabs.
  useMobileBar({ title: company.name, back: 'history', fallback: '/companies', actions: moreMenu(true), hideTabs: true })

  const wide = useMediaQuery('(min-width: 1024px)')
  const contactsPanel = (
    <ContactsPanel
      companyId={company.id}
      contacts={contacts.data}
      sites={sites.data}
      loading={contacts.isPending}
      error={contacts.isError}
      onAdd={() => setDialog('contact')}
      onEdit={c => {
        setEditContact(c)
        setDialog('contact')
      }}
    />
  )
  const openPanel = supplierSide ? (
    <OpenWithThem view={record.view} loading={record.query.isPending} error={record.query.isError} onRetry={() => void record.query.refetch()} />
  ) : null
  const supplierPanel = supplierSide ? <SupplierPanel companyId={company.id} /> : null
  const sitesPanel = showSites ? (
    <SitesPanel
      companyId={company.id}
      sites={sites.data}
      history={history.data}
      loading={sites.isPending || history.isPending}
      error={sites.isError || history.isError}
      onAddSite={() => setDialog('site')}
      onEditSite={s => {
        setEditSite(s)
        setDialog('site')
      }}
    />
  ) : null
  const detailsPanel = <DetailsPanel company={company} customerSince={customerSide && !supplierOnly ? customerSince : null} brands={supplierSide || !company.isCustomer} />
  const notesPanel = company.notes ? (
    <Panel title="Notes">
      <p className="whitespace-pre-line px-5 py-4 text-base text-fg-2">{company.notes}</p>
    </Panel>
  ) : null
  // The money panel is rendered for an admin only (and the view refuses anyone else), so it needs no "Admin only" tag.
  const sidePanels = (
    <>
      {isAdmin && money.data && money.data.orders > 0 ? (
        <Panel title="Money with them">
          <div className="px-5 py-3">
            <KeyValue
              rows={[
                { key: 'Total (with GST)', value: <Money value={money.data.receivable} /> },
                { key: 'Received', value: <Money value={money.data.settled} /> },
                { key: 'Balance', value: <Money value={money.data.balance} strong /> },
              ]}
            />
          </div>
        </Panel>
      ) : null}
      {isAdmin && money.isError ? <Banner tone="warning" title="Couldn't load the money figures">Reload the page to try again.</Banner> : null}
      <CreditPanel companyId={company.id} companyName={company.name} isAdmin={isAdmin} />
      {detailsPanel}
      {notesPanel}
    </>
  )
  // A supplier-only page: its sites, brands and details are looked up now and then, so they fold away under the history.
  const moreAbout = (
    <MoreAbout defaultOpen={becameSupplierHere}>
      {sitesPanel}
      {detailsPanel}
      {notesPanel}
    </MoreAbout>
  )

  return (
    <Shell sticky>
      <div className="grid gap-6">
        <DetailHeader
          name={company.name}
          breadcrumb={[{ label: 'Companies', to: '/companies' }, { label: company.name }]}
          more={moreMenu(false)}
          // the role is identity, not state: a Tag on its own row above the meta line (so no "·" follows it), never a chip in the h1
          chips={company.role ? <RoleChip role={company.role} /> : undefined}
          meta={meta.map((m, i) => (i === 0 ? m : <span key={m} className="text-fg-muted">{m}</span>))}
        >
          {supplierRecordLine && facts ? (
            // the supplier's counts, said once (round 3: the "What we know" panel repeated them); the rules behind the (i)
            // Each part of the line is one unit with its own dot (a 20px cell), and the row is pulled left into a clipped edge, so a
            // part that starts a wrapped line hides its dot: no line starts or ends with a dangling "·", and the (i) stays on the last line.
            <p className="mt-2 overflow-x-clip text-base text-fg-2" data-testid="supplier-record-line">
              <span className="-ml-5 flex flex-wrap items-center">
                {recordUnits(supplierRecordLine).map((unit, i) => (
                  <span key={unit.join('|')} className={cn('inline-flex min-w-0 items-center whitespace-nowrap', i === 0 && 'pl-5')}>
                    {i > 0 ? (
                      <>
                        {' '}
                        <span aria-hidden="true" className="w-5 shrink-0 text-center text-fg-muted">
                          ·
                        </span>{' '}
                      </>
                    ) : null}
                    {unit.map((part, j) => (
                      <span key={part}>
                        {j > 0 ? <span className="mx-2 text-fg-muted">{' · '}</span> : null}
                        <CountText text={part} />
                      </span>
                    ))}
                  </span>
                ))}
                <InfoTip label="About these numbers" className="ml-1">
                  <span className="grid gap-2">
                    {factNotes(facts, record.view?.span ?? null).map(n => (
                      <span key={n}>{n}</span>
                    ))}
                  </span>
                </InfoTip>
              </span>
            </p>
          ) : null}
          <LastChanged table="companies" id={company.id} className="mt-2 text-base text-fg-2" />
          <NextStepBox
            tone="quiet"
            text={supplierOnly ? 'To ask them for prices, start an RFQ with them already chosen.' : 'When they send an enquiry, log it as a new RFQ.'}
            action={phone ? undefined : primary}
          />
        </DetailHeader>
        {phone ? <StickyActionBar label="Company actions" primary={primary} /> : null}
        {recordHistory.node}

        {wide ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="grid min-w-0 gap-6">
              {supplierPanel}
              {supplierOnly ? moreAbout : sitesPanel}
            </div>
            <aside className="grid content-start gap-6" aria-label="Company details">
              {contactsPanel}
              {openPanel}
              {supplierOnly ? null : sidePanels}
            </aside>
          </div>
        ) : (
          // Below 1024 one column, in the order a phone needs it: who to call, what is open, the history, then the rest.
          <div className="grid min-w-0 gap-6">
            {contactsPanel}
            {openPanel}
            {supplierPanel}
            {supplierOnly ? (
              moreAbout
            ) : (
              <>
                {sitesPanel}
                {sidePanels}
              </>
            )}
          </div>
        )}
      </div>

      {del.node}
      <EditCompanyDialog open={dialog === 'edit'} onOpenChange={close} company={company} />
      <SiteDialog open={dialog === 'site'} onOpenChange={close} companyId={company.id} companyName={company.name} site={editSite} />
      <ContactDialog open={dialog === 'contact'} onOpenChange={close} companyId={company.id} companyName={company.name} sites={sites.data ?? []} contact={editContact} />
      {isAdmin ? (
        <MergeCompanyDialog
          open={dialog === 'merge'}
          onOpenChange={close}
          subject={{ id: company.id, name: company.name, rfqs: rfqCount, orders: orderCount, contacts: contacts.data?.length ?? 0, sites: sites.data?.length ?? 0 }}
          onMerged={keep => {
            toast({ title: `Merged ${company.name} into ${keep.name}`, body: 'Its RFQs, orders, contacts and sites are now on this page.', tone: 'success' })
            navigate(`/companies/${keep.id}`)
          }}
        />
      ) : null}
    </Shell>
  )
}

function ContactsPanel({
  companyId,
  contacts,
  sites,
  loading,
  error,
  onAdd,
  onEdit,
}: {
  companyId: string
  contacts: ContactRow[] | undefined
  sites: SiteRow[] | undefined
  loading: boolean
  error: boolean
  onAdd: () => void
  onEdit: (contact: ContactRow) => void
}) {
  const siteName = new Map((sites ?? []).map(s => [s.id, s.name]))
  const { toast } = useToast()
  const remove = useRemoveContact(companyId)
  const [removing, setRemoving] = useState<ContactRow | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const cancelRemove = () => {
    const id = removing?.id
    setRemoving(null)
    setRemoveError(null)
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-remove-contact="${id}"]`)?.focus())
  }
  const confirmRemove = () => {
    if (!removing) return
    remove.mutate(removing.id, {
      onSuccess: () => {
        toast({ title: `Removed ${removing.name}`, tone: 'success' })
        setRemoving(null)
      },
      onError: err => setRemoveError(removeErrorMessage(err, 'contact')),
    })
  }
  return (
    <Panel
      title="Contacts"
      actions={
        <Button variant="quiet" size="sm" icon={Plus} onClick={onAdd}>
          Add
        </Button>
      }
    >
      <div className="px-5 py-4">
        {loading ? (
          <div role="status" className="grid gap-2" aria-busy="true" aria-label="Loading contacts">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ) : error ? (
          <Banner tone="danger" title="Couldn't load the contacts">
            Reload the page to try again.
          </Banner>
        ) : !contacts || contacts.length === 0 ? (
          <Fine>No contacts yet. A name is enough to add one.</Fine>
        ) : (
          <ul className="grid">
            {contacts.map(c => (
              <li key={c.id} className="grid gap-[2px] border-t py-3 text-sm first:border-t-0 first:pt-0 last:pb-0">
                {removing?.id === c.id ? (
                  <ConfirmRemove
                    title={`Remove ${c.name}?`}
                    detail="Their details are deleted from this company."
                    busy={remove.isPending}
                    error={removeError}
                    onConfirm={confirmRemove}
                    onCancel={cancelRemove}
                  />
                ) : null}
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{c.name}</span>
                  <span className="-my-1 flex shrink-0 items-center">
                    <Button variant="quiet" size="sm" icon={Pencil} aria-label={`Edit ${c.name}`} onClick={() => onEdit(c)} />
                    <Button
                      variant="quiet"
                      size="sm"
                      icon={Trash2}
                      aria-label={`Remove ${c.name}`}
                      data-remove-contact={c.id}
                      onClick={() => {
                        setRemoveError(null)
                        setRemoving(c)
                      }}
                    />
                  </span>
                </div>
                {c.job_title ? <span className="text-sm text-fg-muted">{c.job_title}</span> : null}
                {c.notes ? <span className="text-sm text-fg-muted">{c.notes}</span> : null}
                {c.site_id && siteName.get(c.site_id) ? <span className="text-sm text-fg-muted">{siteName.get(c.site_id)}</span> : null}
                {c.phone ? <PhoneLinks name={c.name} phone={c.phone} /> : null}
                {c.email ? (
                  <a href={`mailto:${c.email}`} className="inline-flex min-h-8 w-fit items-center text-sm text-fg-2 [overflow-wrap:anywhere] hover:text-fg max-md:min-h-touch">
                    {c.email}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}

/**
 * A contact's number, tap to call, and WhatsApp beside it when the number is one WhatsApp can open (waLink: a Pakistani 03xx
 * number gets its country code). 44 px tall on a phone.
 */
function PhoneLinks({ name, phone }: { name: string; phone: string }) {
  const wa = waLink(phone, '')
  const link = 'inline-flex min-h-8 items-center gap-1 rounded text-sm hover:underline max-md:min-h-touch'
  return (
    <span className="flex flex-wrap items-center gap-x-4">
      <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={cn(link, 'num text-fg-2')} aria-label={`Call ${name}, ${phone}`}>
        <Icon icon={Phone} size="sm" className="text-fg-muted" />
        {phone}
      </a>
      {wa ? (
        <a href={wa.url} target="_blank" rel="noopener noreferrer" className={cn(link, 'font-medium text-primary')} aria-label={`WhatsApp ${name}`}>
          <Icon icon={MessageCircle} size="sm" />
          WhatsApp
        </a>
      ) : null}
    </span>
  )
}

/**
 * "More about this supplier": sites, brands carried and details, folded (closed by default) under the supplier's history.
 * defaultOpen: the page became supplier-only while it was open (see becameSupplierHere).
 */
function MoreAbout({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-panel border bg-surface" open={defaultOpen || undefined}>
      <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 rounded px-5 py-3 text-base font-semibold hover:bg-sunken [&::-webkit-details-marker]:hidden">
        <Icon icon={ChevronRight} size="sm" className="text-fg-muted transition-transform duration-fast group-open:rotate-90" />
        More about this supplier
        <span className="text-sm font-regular text-fg-muted">Sites, brands, details</span>
      </summary>
      <div className="grid gap-6 border-t p-4">{children}</div>
    </details>
  )
}

/** The buyer's tax details printed on its sales-tax invoices (0072): folded until asked for, then the self-contained form. */
function TaxDetails({ companyId, divided }: { companyId: string; divided: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('grid gap-2', divided && 'border-t pt-2')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-fg">Tax details for invoices</h3>
        {!open ? (
          <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
            Edit
          </Button>
        ) : null}
      </div>
      {open ? (
        <BuyerTaxFields companyId={companyId} onSaved={() => setOpen(false)} onCancel={() => setOpen(false)} />
      ) : (
        <p className="text-xs text-fg-muted">NTN, STRN, registered status and invoice address.</p>
      )}
    </div>
  )
}

/**
 * Details: what used to be the Roles and Brands carried panels, in one compact panel (UX audit 9b). The role chip is in the
 * header, so it is not repeated here. On the customer side: since when (the year of the first RFQ or order; "Added" for a
 * company with neither yet) and whether they also supply us (left out for "both": the header chip already says so). On the
 * supplier side, and for a company with no role yet: the brands they carry, with Add and remove.
 */
function DetailsPanel({ company, customerSince, brands }: { company: CompanyDetail; customerSince: number | null; brands: boolean }) {
  const rows: { key: string; value: ReactNode }[] = []
  if (customerSince !== null) {
    rows.push(
      company.isCustomer
        ? { key: 'Customer since', value: <span className="num">{customerSince}</span> }
        : { key: 'Added', value: <span className="num">{monthYearOf(company.createdAt)}</span> },
    )
    if (company.role !== 'both') rows.push({ key: 'Also a supplier', value: company.isSupplier ? 'Yes' : 'No' })
  }
  const tax = company.isCustomer
  if (rows.length === 0 && !brands && !tax) return null
  return (
    <Panel title="Details">
      <div className="grid gap-3 px-5 py-3">
        {rows.length > 0 ? <KeyValue rows={rows} /> : null}
        {tax ? <TaxDetails companyId={company.id} divided={rows.length > 0} /> : null}
        {brands ? (
          <div className={rows.length > 0 ? 'border-t pt-2' : undefined}>
            <BrandsCarried companyId={company.id} withQuoteCounts={company.isSupplier} />
          </div>
        ) : null}
      </div>
    </Panel>
  )
}
