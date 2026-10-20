import { Fragment, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Building2, ChevronLeft, Ellipsis, FilePlus2, GitMerge, Link2, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { recordLine, supplierFacts } from '@/features/companies/supplierFacts'
import { earliestYear } from '@/features/companies/supplierRecord'
import { copyToClipboard } from '@/lib/clipboard'
import { OpenWithThem } from '@/features/companies/SupplierRecordPanels'
import { BuyerTaxFields } from '@/features/money/invoices/pdf/BuyerTaxFields'
import { cn } from '@/lib/utils'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { Banner } from '@/ui/Banner'
import { Breadcrumb } from '@/ui/Breadcrumb'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Money } from '@/ui/Money'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'

/*
 * Company page (R02; g2-company.html). Customer and supplier are one record: the role is derived from
 * what we have done with the company, so the same page grows the supplier's history the first time an enquiry
 * is sent, and sites with their RFQs and orders the first time an RFQ arrives.
 *
 * Layout (UX audit 2026-10-19, 9b): the main column is the useful history (a supplier's recent quotes and
 * deliveries first; a customer's sites), the side column is Contacts, "Open with them", "Money with them"
 * (admin) and one compact Details panel (customer since, brands carried); the role is said once, in the header.
 *
 * Access (DATA_MODEL section 10): everyone signed in reads and edits the company, its sites, contacts and
 * brands. The money panel and the merge action are admin only; they are not rendered for anyone else, and
 * the database refuses them anyway (v_order_money and merge_companies check the role).
 */
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
  return <Loaded company={company.data} />
}

function AllCompaniesButton() {
  const navigate = useNavigate()
  return (
    <Button variant="primary" icon={ChevronLeft} onClick={() => navigate('/companies')}>
      All companies
    </Button>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-6 md:px-8">{children}</div>
}

function PageSkeleton() {
  return (
    <Shell>
      <div role="status" className="grid gap-4" aria-busy="true" aria-label="Loading company">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-4 w-56" />
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
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
  // A customer's New RFQ opens intake with them as the customer. Intake has no way yet to start from a supplier, so a supplier-only
  // page's New RFQ opens a blank intake (it used to put the supplier in as the customer) and is not the page's main action.
  const newRfq = () => navigate(supplierOnly ? '/rfqs/new' : `/rfqs/new?company=${company.id}`)

  // The "more" menu: Edit, Copy link, Merge (admin). On a phone it is the one bar's right slot; from tablet up Edit is a button.
  const moreMenu = (touch: boolean) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="quiet" size={touch ? 'touch' : undefined} icon={Ellipsis} aria-label="More actions" className={touch ? undefined : 'max-md:hidden'} />
      </PopoverTrigger>
      <PopoverContent variant="menu" align="end" aria-label="More actions">
        {touch ? (
          <MenuItem icon={Pencil} onClick={() => setDialog('edit')}>
            Edit company
          </MenuItem>
        ) : null}
        <MenuItem icon={Link2} onClick={() => void copyLink()}>
          Copy link to this company
        </MenuItem>
        {isAdmin ? (
          <MenuItem icon={GitMerge} onClick={() => setDialog('merge')}>
            Merge into another company
          </MenuItem>
        ) : null}
      </PopoverContent>
    </Popover>
  )
  // Phones get one bar: back (to where the person came from, else the companies list), the name, and the menu.
  useMobileBar({ title: company.name, back: 'history', fallback: '/companies', actions: moreMenu(true) })

  return (
    <Shell>
      <div className="grid gap-6">
        <header className="grid gap-2">
          <Breadcrumb className="max-md:hidden" links="primary" items={[{ label: 'Companies', to: '/companies' }, { label: company.name }]} />
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="grid min-w-0 gap-2">
              <h1 className="flex flex-wrap items-baseline gap-3 text-2xl font-semibold tracking-tight text-balance">
                <span className="min-w-0 break-words">{company.name}</span>
                {company.role ? <RoleChip role={company.role} className="translate-y-[-2px]" /> : null}
              </h1>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-2">
                {meta.map((m, i) => (
                  <Fragment key={m}>
                    {i > 0 ? (
                      <span aria-hidden="true" className="text-fg-muted">
                        ·
                      </span>
                    ) : null}
                    <span className={i === 0 ? undefined : 'text-fg-muted'}>{m}</span>
                  </Fragment>
                ))}
              </p>
              {supplierRecordLine ? (
                <p className="text-sm text-fg-2" data-testid="supplier-record-line">
                  <CountText text={supplierRecordLine} />
                </p>
              ) : null}
            </div>
            <div className="flex max-w-full flex-wrap items-center gap-2">
              <Button variant={supplierOnly ? 'secondary' : 'primary'} icon={FilePlus2} onClick={newRfq}>
                New RFQ
              </Button>
              <Button icon={Pencil} onClick={() => setDialog('edit')} className="max-md:hidden">
                Edit
              </Button>
              {moreMenu(false)}
            </div>
          </div>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 gap-6">
            {supplierSide ? <SupplierPanel companyId={company.id} /> : null}
            {showSites ? (
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
            ) : null}
          </div>

          <aside className="grid content-start gap-6" aria-label="Company details">
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
            {supplierSide ? <OpenWithThem view={record.view} loading={record.query.isPending} error={record.query.isError} onRetry={() => void record.query.refetch()} /> : null}
            {isAdmin && money.data && money.data.orders > 0 ? (
              <Panel title="Money with them" meta="Admin only">
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
            <DetailsPanel company={company} customerSince={customerSide && !supplierOnly ? customerSince : null} brands={supplierSide || !company.isCustomer} />
            {company.notes ? (
              <Panel title="Notes">
                <p className="whitespace-pre-line px-5 py-4 text-sm text-fg-2">{company.notes}</p>
              </Panel>
            ) : null}
          </aside>
        </div>
      </div>

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
                {c.job_title ? <span className="text-xs text-fg-muted">{c.job_title}</span> : null}
                {c.notes ? <span className="text-xs text-fg-muted">{c.notes}</span> : null}
                {c.site_id && siteName.get(c.site_id) ? <span className="text-xs text-fg-muted">{siteName.get(c.site_id)}</span> : null}
                {c.phone ? (
                  <a href={`tel:${c.phone.replace(/\s+/g, '')}`} className="num inline-flex min-h-6 w-fit items-center text-xs text-fg-muted hover:text-fg">
                    {c.phone}
                  </a>
                ) : null}
                {c.email ? (
                  <a href={`mailto:${c.email}`} className="inline-flex min-h-6 w-fit items-center text-xs text-fg-muted hover:text-fg">
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
