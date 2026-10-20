import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ChevronRight, Copy, Save, TriangleAlert } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { copyToClipboard } from '@/lib/clipboard'
import { constraintOf, mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { useSession } from '@/app/session'
import { useBrands, useCompany, useCompanyContacts, useCompanySites } from '@/features/companies/hooks'
import type { FloatInput, SavedRfq } from '@/features/rfqs/api'
import { uploadAttachment } from '@/features/rfqs/api'
import { deleteCapture, safely } from '@/lib/capture/store'
import { findRfqByCustomerRef, useFloatRfq, useFloatToSupplier, useSetRfqFloated, useSupplierCandidates, useSupplierMemory } from '@/features/rfqs/hooks'
import {
  computeReplyBy,
  copyText,
  generateEnquiryDraft,
  guessBrandFamily,
  itemsWithoutSupplier,
  joinNames,
  parsePaste,
  realItems,
  RFQ_REF_PLACEHOLDER,
  suggestSuppliers,
  tickedIds,
  toEnquiryItems,
  toFloatItems,
  toSuggestionItems,
  type BrandRef,
  type DraftItem,
  type EnquiryVariant,
} from '@/features/rfqs/lib'
import { ItemRows, PastedPanel, PasteZone, type PastedBlock } from '@/features/rfqs/ItemsEditor'
import { EnquiryCard, FloatedPanel, Hint, SidePanels, StepLine, type Step } from '@/features/rfqs/IntakeParts'
import { clearIntakeDraft, draftAge, draftHasContent, draftSummary, loadIntakeDraft, saveIntakeDraft, type IntakeDraft } from '@/features/rfqs/lib/intakeDraftStore'
import { useLeaveGuard } from '@/features/rfqs/useLeaveGuard'
import { useChannelPreference } from '@/lib/useChannelPreference'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { InfoTip } from '@/ui/InfoTip'
import { ItemChips, SupplierPicker, type ManualSupplier } from '@/features/rfqs/SupplierPicker'
import { CompanyPicker, type IntakeCompany } from '@/features/rfqs/CompanyPicker'
import { Avatar } from '@/ui/Avatar'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'

/*
 * New RFQ: intake and asking suppliers on one screen (R05; g2-intake-float.html; plain words of 2026-10-19). Company and a paste,
 * then suppliers with their reasons, then the message, then one button that copies it and marks the RFQ as sent to those
 * suppliers, with a 10-second Undo.
 *
 * FE-2 entry burden, listed for the commit:
 *   required     the company, and at least one item (a description). Nothing else.
 *   pre-filled   received on = today and owner = you (database defaults); site and contact when the company has exactly
 *                one (with the source shown); qty 1 and GST 18 % when not given; brand and family picked from the
 *                description; only suppliers who supplied the item before are ticked; WhatsApp or Email as last time.
 *   optional     customer reference (beside the company: it is how the RFQ is found later), quotation due date, top
 *                priority, site, contact.
 *   interactions pick the company, paste, "Looks right: find suppliers" (new RFQ: 2 actions and 1 paste);
 *                "Write the message", "Copy message for N suppliers" (ask: 2 taps).
 *
 * Nothing is saved to the database until the person copies the message or chooses "Save without asking". What they type is
 * kept on this device as they go (lib/intakeDraftStore.ts): coming back offers "Continue your draft" or "Discard", and leaving
 * with items on the form asks first (useLeaveGuard.ts). The RFQ number is given by the database when it is saved, so the message
 * carries a placeholder that is replaced in the copy.
 */

type Company = IntakeCompany

type Variant = EnquiryVariant

interface ErrorNote {
  message: string
  existing?: SavedRfq | null
  customerRef?: boolean
}

const TEAM_COMPANY = 'Q-Tech Solutions'

let keySeq = 0
const newKey = () => `i${++keySeq}`

export default function IntakeScreen() {
  const [round, setRound] = useState(0)
  return <IntakeForm key={round} onAnother={() => setRound(r => r + 1)} />
}

function IntakeForm({ onAnother }: { onAnother: () => void }) {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const userId = user?.id ?? null
  const { toast } = useToast()
  const [params] = useSearchParams()
  const today = businessToday()
  const location = useLocation()
  const captured = (location.state as { capture?: { id: string; text: string; files: File[] } } | null)?.capture

  // A draft kept on this device from last time. Offered only when this visit starts blank (not from Capture or a company page).
  const [offer, setOffer] = useState<IntakeDraft | null>(() => (captured || params.get('company') ? null : loadIntakeDraft(userId)))

  // ---- the form
  const [company, setCompany] = useState<Company | null>(null)
  const [siteOverride, setSiteOverride] = useState<string | null>(null)
  const [contactOverride, setContactOverride] = useState<string | null>(null)
  const [dueOn, setDueOn] = useState('')
  const [customerRef, setCustomerRef] = useState('')
  const [isPriority, setIsPriority] = useState(false)
  const [items, setItems] = useState<DraftItem[]>([])
  const [pasted, setPasted] = useState<PastedBlock | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const zoneRef = useRef<HTMLTextAreaElement>(null)

  // ---- the flow
  const [step, setStep] = useState<Step>('build')
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [manual, setManual] = useState<ManualSupplier[]>([])
  const [variant, setVariant] = useChannelPreference()
  const [edit, setEdit] = useState<{ sig: string; text: Partial<Record<Variant, string>> }>({ sig: '', text: {} })
  const [saved, setSaved] = useState<SavedRfq | null>(null)
  const [floatedOn, setFloatedOn] = useState<string | null>(null)
  const [copied, setCopied] = useState(true)
  const [copiedText, setCopiedText] = useState('')
  const [busy, setBusy] = useState<null | 'copy' | 'save'>(null)
  const [error, setError] = useState<ErrorNote | null>(null)
  const [undone, setUndone] = useState(false)
  // One id for this RFQ for the life of the form: a second tap, a retry, or a lost reply can only ever find the same RFQ.
  const rfqId = useRef<string>(crypto.randomUUID())
  const inFlight = useRef(false)

  const float = useFloatRfq()
  const setFloated = useSetRfqFloated()
  const floatToSupplier = useFloatToSupplier()
  const [itemFloats, setItemFloats] = useState<Record<string, string>>({})
  const [floating, setFloating] = useState<string | null>(null)

  // ---- data
  const brandsQuery = useBrands()
  const brands = useMemo<BrandRef[]>(
    () => (brandsQuery.data ?? []).map(b => ({ id: b.id, name: b.name, kind: b.kind === 'family' ? 'family' : 'brand' })),
    [brandsQuery.data],
  )
  const sites = useCompanySites(company?.id)
  const contacts = useCompanyContacts(company?.id)

  // The customer page's "New RFQ" button arrives with ?company=<id>.
  const wantedId = params.get('company')
  const wanted = useCompany(company ? undefined : (wantedId ?? undefined))
  useEffect(() => {
    if (!company && wanted.data) {
      setCompany({ id: wanted.data.id, name: wanted.data.name, country: wanted.data.country, city: wanted.data.city ?? null, role: wanted.data.role })
    }
  }, [company, wanted.data])

  // ---- items
  const addItems = useCallback(
    (parsed: { description: string; qty: number; unit: string | null }[], list: BrandRef[]) => {
      const rows = parsed.map<DraftItem>(p => ({
        key: newKey(),
        description: p.description,
        qty: p.qty,
        unit: p.unit ?? '',
        ...guessBrandFamily(p.description, list),
      }))
      setItems(prev => [...prev, ...rows])
    },
    [],
  )
  const brandsRef = useRef(brands)
  brandsRef.current = brands
  const takePaste = useCallback(
    (text: string) => {
      const result = parsePaste(text)
      setPasted({ result })
      if (result.items.length > 0) addItems(result.items, brandsRef.current)
    },
    [addItems],
  )
  // Capture's "Start a new RFQ" (R22) arrives with the text and the files. The text is read as if it had been pasted here;
  // the files are attached once the RFQ exists (it has no id on the server before that).
  const capturedFiles = useRef<File[]>(captured?.files ?? [])
  const takenCapture = useRef(false)
  useEffect(() => {
    if (!captured || takenCapture.current) return
    takenCapture.current = true
    if (captured.text.trim()) takePaste(captured.text)
  }, [captured, takePaste])

  // A paste made with nothing focused (Ctrl+V anywhere on the page) is handled here; the paste zone handles its own.
  useEffect(() => {
    if (step !== 'build') return
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      const editable = t?.closest?.('input, textarea, select, [contenteditable="true"]')
      if (editable && editable !== zoneRef.current) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!text.trim()) return
      e.preventDefault()
      takePaste(text)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [step, takePaste])

  // Rows whose brand or family the person has set themselves: a late-arriving brand list never overrides those.
  const touched = useRef(new Set<string>())
  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    if ('brandId' in patch || 'familyId' in patch) touched.current.add(key)
    setItems(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)))
  }
  // A paste can land before the brand list has loaded: when it arrives, rows with no brand or family get their guess.
  useEffect(() => {
    if (brands.length === 0) return
    setItems(list => {
      let changed = false
      const next = list.map(i => {
        if (touched.current.has(i.key) || i.brandId || i.familyId || !i.description.trim()) return i
        const g = guessBrandFamily(i.description, brands)
        if (!g.brandId && !g.familyId) return i
        changed = true
        return { ...i, ...g }
      })
      return changed ? next : list
    })
  }, [brands])
  const removeItem = (key: string) => setItems(list => list.filter(i => i.key !== key))
  const addBlank = () => {
    const key = newKey()
    setItems(list => [...list, { key, description: '', qty: null, unit: '', brandId: null, familyId: null }])
    setFocusKey(key)
  }

  // Once saved: attach the captured files to the new RFQ and forget the captured item.
  useEffect(() => {
    if (!saved || !captured) return
    const files = capturedFiles.current
    capturedFiles.current = []
    void (async () => {
      try {
        for (const file of files) {
          const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
          await uploadAttachment({ rfqId: saved.id, clarificationId: null, file, path: `${saved.id}/${crypto.randomUUID()}.${(ext ?? 'bin').toLowerCase()}` })
        }
        await safely(() => deleteCapture(captured.id), undefined)
        if (files.length) toast({ title: `${files.length} ${files.length === 1 ? 'file' : 'files'} attached`, body: rfqRef(saved.number), tone: 'success' })
      } catch {
        toast({ title: 'Could not attach the files', body: 'The RFQ is saved. Add them from its Files panel.', tone: 'danger' })
      }
    })()
  }, [saved, captured, toast])

  const real = realItems(items)
  const ready = Boolean(company) && real.length > 0

  // ---- site and contact: pre-filled when the company has exactly one
  const siteList = sites.data ?? []
  const contactList = contacts.data ?? []
  const siteId = siteOverride ?? (siteList.length === 1 ? siteList[0].id : '')
  const contactId = contactOverride ?? (contactList.length === 1 ? contactList[0].id : '')

  // ---- the draft on this device (lib/intakeDraftStore.ts). siteId and contactId hold the person's own picks (null: the default).
  const draftNow: IntakeDraft = {
    v: 1,
    savedAt: 0,
    rfqId: rfqId.current,
    company,
    siteId: siteOverride,
    contactId: contactOverride,
    dueOn,
    customerRef,
    isPriority,
    items,
    overrides,
    manual,
  }
  const formHasContent = !saved && draftHasContent(draftNow)
  // Typing into a blank form while the offer is showing starts afresh: the old draft gives way to the new one.
  useEffect(() => {
    if (offer && formHasContent) setOffer(null)
  }, [offer, formHasContent])
  // Kept as it changes (a small JSON write), so nothing typed is lost to a tab tap, a reload or a closed tab.
  const draftJson = JSON.stringify(draftNow)
  useEffect(() => {
    if (saved) clearIntakeDraft(userId)
    else if (!offer) saveIntakeDraft(userId, { ...(JSON.parse(draftJson) as IntakeDraft), savedAt: Date.now() })
  }, [draftJson, saved, offer, userId])

  const restore = (d: IntakeDraft) => {
    rfqId.current = d.rfqId
    setCompany(d.company ? ({ ...d.company } as Company) : null)
    setSiteOverride(d.siteId)
    setContactOverride(d.contactId)
    setDueOn(d.dueOn)
    setCustomerRef(d.customerRef)
    setIsPriority(d.isPriority)
    setItems(d.items.map(i => ({ ...i, key: newKey() })))
    setOverrides(d.overrides)
    setManual(d.manual)
    setOffer(null)
  }
  const discard = () => {
    clearIntakeDraft(userId)
    setOffer(null)
  }

  // Leaving with items on the form and nothing saved asks first; the draft is kept either way.
  const [leaving, setLeaving] = useState<null | (() => void)>(null)
  useLeaveGuard(formHasContent && real.length > 0, proceed => setLeaving(() => proceed))

  // ---- suppliers
  const wantSuppliers = step === 'suppliers' || step === 'enquiry' || step === 'floated' || step === 'saved'
  const candidates = useSupplierCandidates(wantSuppliers && Boolean(company))
  const candidateList = useMemo(() => (candidates.data ?? []).filter(c => c.id !== company?.id), [candidates.data, company?.id])
  const suggestionItems = useMemo(() => toSuggestionItems(items, brands), [items, brands])
  const memoryQuery = useMemo(
    () => suggestionItems.map(i => ({ key: i.id, description: i.description, brandId: i.brandId, familyId: i.familyId })),
    [suggestionItems],
  )
  const memory = useSupplierMemory(
    memoryQuery,
    candidateList.map(c => c.id),
    wantSuppliers && candidates.isSuccess,
  )
  const suggestions = useMemo(
    () => suggestSuppliers(suggestionItems, { suppliers: candidateList, memory: memory.data ?? {} }, { today }),
    [suggestionItems, candidateList, memory.data, today],
  )
  const memoryContext = useMemo(
    () => ({ rows: memory.data ?? {}, items: suggestionItems.map((i, n) => ({ id: i.id, number: n + 1, description: i.description, brandId: i.brandId ?? null, familyId: i.familyId ?? null, brandName: i.brandName ?? null, familyName: i.familyName ?? null })), today }),
    [memory.data, suggestionItems, today],
  )
  const suppliersLoading = wantSuppliers && (candidates.isPending || (candidates.isSuccess && memory.isPending && suggestionItems.length > 0 && candidateList.length > 0))
  const suppliersError = candidates.isError || memory.isError

  const manualIds = manual.map(m => m.id)
  const ticked = tickedIds(suggestions.suppliers, overrides, manualIds)
  const tickedSet = useMemo(() => new Set(ticked), [ticked])
  const flaggedKeys = itemsWithoutSupplier(
    suggestionItems.map(i => i.id),
    suggestions.suppliers,
    ticked,
    manualIds,
  )
  const nameOf = (id: string) => suggestions.suppliers.find(s => s.supplierId === id)?.name ?? manual.find(m => m.id === id)?.name ?? 'Supplier'
  const recipients = ticked.map(id => ({ id, name: nameOf(id) }))
  const itemNumber = (key: string) => suggestionItems.findIndex(i => i.id === key) + 1
  const shortItem = (key: string) => {
    const d = suggestionItems.find(i => i.id === key)?.description ?? ''
    return d.length > 34 ? `${d.slice(0, 33).trimEnd()}…` : d
  }

  const toggleSupplier = (id: string, on: boolean) => setOverrides(o => ({ ...o, [id]: on }))
  const addManual = (s: ManualSupplier) => {
    setManual(m => (m.some(x => x.id === s.id) ? m : [...m, s]))
    setOverrides(o => ({ ...o, [s.id]: true }))
  }

  // ---- the enquiry text
  const sig = JSON.stringify([suggestionItems.map(i => [i.description, i.brandId, i.id]), items.map(i => i.qty), items.map(i => i.unit), dueOn, user?.name, saved?.number])
  const draft = useMemo(() => {
    if (step === 'build' || suggestionItems.length === 0) return null
    return generateEnquiryDraft({
      rfqRef: saved ? rfqRef(saved.number) : RFQ_REF_PLACEHOLDER,
      items: toEnquiryItems(items, brands),
      dueOn: dueOn || null,
      today,
      signature: { name: user?.name ?? 'Q-Tech', company: TEAM_COMPANY },
      variant,
    })
    // `items` and `brands` are covered by `sig` and the brand list identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sig, brands, variant, today])
  const editedBody = edit.sig === sig ? edit.text[variant] : undefined
  const body = editedBody ?? draft?.body ?? ''

  // ---- writes
  const buildInput = (markSent: boolean): FloatInput => ({
    id: rfqId.current,
    companyId: (company as Company).id,
    siteId: siteId || null,
    contactId: contactId || null,
    customerRef,
    dueOn: dueOn || null,
    isPriority,
    items: toFloatItems(items),
    supplierIds: ticked,
    markSent,
  })

  const explain = async (err: unknown) => {
    const e = err as { code?: string; message?: string }
    if (e?.code === '23505' && /customer_ref/.test(constraintOf(e) ?? e.message ?? '')) {
      const existing = company ? await findRfqByCustomerRef(company.id, customerRef).catch(() => null) : null
      setError({ message: 'This customer already has an RFQ with that reference.', existing, customerRef: true })
      return
    }
    setError({ message: mapPgError(err, { entity: 'RFQ' }).message })
  }

  async function copyAndFloat() {
    if (inFlight.current || !company || ticked.length === 0 || !draft) return
    inFlight.current = true
    setBusy('copy')
    setError(null)
    const before = saved
    const save: Promise<SavedRfq> = before
      ? setFloated.mutateAsync({ rfqId: before.id, floated: true }).then(() => before)
      : float.mutateAsync(buildInput(true))
    const text = save.then(s => copyText({ subject: draft.subject, body }, rfqRef(s.number)))
    try {
      // The copy starts inside this tap, with the text still on its way: the number arrives with the save.
      const [s, ok] = await Promise.all([save, copyToClipboard(text)])
      const finalText = await text
      setSaved(s)
      setCopied(ok)
      setCopiedText(finalText)
      setFloatedOn(today)
      setUndone(false)
      setStep('floated')
      const n = ticked.length
      toast({
        title: `Asked ${n} ${n === 1 ? 'supplier' : 'suppliers'}`,
        body: ok ? `Copied, and ${rfqRef(s.number)} marked as sent to them.` : `${rfqRef(s.number)} marked as sent. The message did not copy: copy it from the page.`,
        undo: {
          seconds: 10,
          onUndo: async () => {
            await setFloated.mutateAsync({ rfqId: s.id, floated: false })
            setFloatedOn(null)
            setUndone(true)
            setStep('enquiry')
          },
          settledTitle: `Asked ${n} ${n === 1 ? 'supplier' : 'suppliers'}`,
          settledBody: `${rfqRef(s.number)} is waiting for prices.`,
          undoneTitle: 'Undone',
          undoneBody: `${rfqRef(s.number)} is saved with ${n} ${n === 1 ? 'supplier' : 'suppliers'} shortlisted.`,
        },
      })
    } catch (err) {
      await explain(err)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  async function saveOnly() {
    if (inFlight.current || !company) return
    if (saved) {
      setStep('saved')
      return
    }
    inFlight.current = true
    setBusy('save')
    setError(null)
    try {
      const s = await float.mutateAsync(buildInput(false))
      setSaved(s)
      setStep('saved')
    } catch (err) {
      await explain(err)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  async function copyAgain() {
    await copyToClipboard(copiedText).then(ok => setCopied(ok))
  }

  // ---- text
  const heading = step === 'floated' ? 'Sent. Paste the message into each supplier’s chat.' : null
  const lede =
    step === 'build'
      ? real.length > 0
        ? 'Check the split, then find suppliers.'
        : 'Paste what the customer sent. Nothing is saved until you copy the enquiry or save.'
      : step === 'suppliers'
        ? 'Ticked: the suppliers who supplied these items before. Tick or untick any.'
        : step === 'enquiry'
          ? 'Check the message, then copy it once.'
          : step === 'saved'
            ? 'Saved. Nothing has been sent to a supplier.'
            : (heading ?? '')

  const itemCountNote = pasted
    ? `${pasted.result.items.length} ${pasted.result.items.length === 1 ? 'item' : 'items'} found in ${pasted.result.lineCount} ${pasted.result.lineCount === 1 ? 'line' : 'lines'}. Edit any cell to fix a split.`
    : 'Edit any cell to change it. Quantity is 1 unless you say otherwise.'

  const noSupplierLine =
    flaggedKeys.length > 0 && ticked.length > 0
      ? flaggedKeys.length === 1
        ? `Item ${itemNumber(flaggedKeys[0])}, ${shortItem(flaggedKeys[0])}, has no supplier ticked.`
        : `${flaggedKeys.length} items have no supplier ticked.`
      : null

  const errorBanner: ReactNode = error ? (
    <Banner
      tone="danger"
      title={error.message}
      action={
        error.customerRef ? (
          <div className="flex flex-wrap gap-2">
            {error.existing ? (
              <Link to={`/rfqs/${error.existing.id}`} className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium">
                Open {rfqRef(error.existing.number)}
              </Link>
            ) : null}
            <Button onClick={() => { setError(null); setStep('build') }}>Change the reference</Button>
          </div>
        ) : undefined
      }
    >
      {error.customerRef ? 'Nothing was saved.' : 'Nothing was saved. Try again; it cannot create a duplicate.'}
    </Banner>
  ) : null

  const floatedNames = recipients.map(r => r.name)
  const replyBy = computeReplyBy(dueOn || null, today)
  async function floatItem(key: string, supplierId: string, supplierName: string) {
    const item = items.find(i => i.key === key)
    if (!saved || !item || floating) return
    setFloating(key)
    try {
      await floatToSupplier.mutateAsync({ rfqId: saved.id, supplierId, today })
      const one = generateEnquiryDraft({
        rfqRef: rfqRef(saved.number),
        items: toEnquiryItems([item], brands),
        dueOn: dueOn || null,
        today,
        signature: { name: user?.name ?? 'Q-Tech', company: TEAM_COMPANY },
        variant: 'whatsapp',
      })
      const ok = await copyToClipboard(copyText({ subject: null, body: one.body }, rfqRef(saved.number)))
      setItemFloats(f => ({ ...f, [key]: supplierName }))
      toast({
        title: `Item ${itemNumber(key)}: asked ${supplierName}`,
        body: ok ? 'Copied: paste it into their chat.' : 'The text did not copy. Open the RFQ to copy it.',
      })
    } catch (err) {
      toast({ title: 'Could not ask for the item', body: mapPgError(err).message, tone: 'danger' })
    } finally {
      setFloating(null)
    }
  }
  const unfloated = flaggedKeys.slice(0, 3).map(k => {
    const alt = suggestions.suppliers.find(s => !tickedSet.has(s.supplierId) && s.coversItemIds.includes(k))
    const done = itemFloats[k]
    return {
      key: k,
      text: done ? (
        <>
          <strong className="font-medium text-fg">Item {itemNumber(k)}: asked {done}.</strong> The message for it is on your clipboard.
        </>
      ) : (
        <>
          <strong className="font-medium text-fg">Item {itemNumber(k)} has no supplier yet.</strong>{' '}
          {alt ? `${alt.name} is on your shortlist for it.${alt.memoryLine === 'no history yet' ? ' It has no history with us.' : ''}` : 'Nothing on file carries it. Add a supplier from the RFQ.'}
        </>
      ),
      action: !done && alt ? { label: `Ask them for item ${itemNumber(k)}`, onClick: () => void floatItem(k, alt.supplierId, alt.name), busy: floating === k } : undefined,
    }
  })

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-12 pt-6 md:px-8">
      {/* minmax(0,1fr) tracks: a long item name or supplier never widens the page past a phone screen (it truncates or wraps). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_288px]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
          <header className="grid gap-1">
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-fg-muted">
              <Link to="/rfqs" className="hover:text-fg">RFQs</Link>
              <Icon icon={ChevronRight} size="sm" />
              <span aria-current="page">New RFQ</span>
            </nav>
            <h1 className="text-2xl font-semibold tracking-tight">New RFQ</h1>
            <p className="max-w-prose text-sm text-fg-muted">{lede}</p>
          </header>
          <StepLine step={step} />

          {offer && step === 'build' ? (
            <section aria-label="Your draft" className="grid gap-3 rounded border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3">
              <div className="grid gap-[2px]">
                <h2 className="font-semibold">You have a draft from {draftAge(offer.savedAt)}</h2>
                <p className="text-fg-2">{draftSummary(offer)}. It is kept on this device until you save it or discard it.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => restore(offer)}>
                  Continue your draft
                </Button>
                <Button onClick={discard}>Discard</Button>
              </div>
            </section>
          ) : null}

          {step === 'build' ? (
            <>
              <section aria-labelledby="h-customer" className="grid gap-3">
                <h2 id="h-customer" className="text-lg font-semibold tracking-snug">Customer</h2>
                {company ? (
                  <CustomerChip company={company} contacts={contactList.map(c => c.name)} onChange={() => setCompany(null)} />
                ) : (
                  <CompanyPicker
                    onPick={c => setCompany(c)}
                    loadingName={Boolean(wantedId) && wanted.isPending}
                  />
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Their own number for the request: it is how the RFQ is found again later, so it sits with the company. */}
                  <Field label="Customer reference" requirement="optional" help="Their RFQ or enquiry number. Search finds the RFQ by it.">
                    <TextField value={customerRef} onChange={e => setCustomerRef(e.target.value)} placeholder="e.g. ENQ-2211" autoComplete="off" />
                  </Field>
                  {company && siteList.length > 0 ? (
                    <Field
                      label="Site"
                      requirement="optional"
                      source={siteOverride === null && siteList.length === 1 ? 'Only site on file' : undefined}
                      edited={siteOverride !== null && siteList.length === 1}
                    >
                      <Select
                        value={siteId}
                        onChange={e => setSiteOverride(e.target.value)}
                        options={siteList.map(s => ({ value: s.id, label: s.name }))}
                        placeholder="No site"
                      />
                    </Field>
                  ) : null}
                  {company && contactList.length > 0 ? (
                    <Field
                      label="Contact"
                      requirement="optional"
                      source={contactOverride === null && contactList.length === 1 ? 'Only contact on file' : undefined}
                      edited={contactOverride !== null && contactList.length === 1}
                    >
                      <Select
                        value={contactId}
                        onChange={e => setContactOverride(e.target.value)}
                        options={contactList.map(c => ({ value: c.id, label: c.name }))}
                        placeholder="No contact"
                      />
                    </Field>
                  ) : null}
                </div>
              </section>

              <section
                aria-labelledby="h-items"
                // Faded and out of reach until a company is chosen (the mockup's "waits"); a paste anywhere on the page still works.
                ref={el => {
                  if (el) el.inert = !company
                }}
                className={`grid gap-3 ${company ? '' : 'opacity-50'}`}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="h-items" className="text-lg font-semibold tracking-snug">Items</h2>
                  <p className="text-sm text-fg-muted">{pasted ? 'Split from the pasted text' : 'Paste once. We split it.'}</p>
                </div>
                {pasted ? <PastedPanel block={pasted} /> : null}
                {items.length > 0 ? (
                  <ItemRows
                    items={items}
                    brands={brands}
                    onChange={updateItem}
                    onRemove={removeItem}
                    onAdd={addBlank}
                    note={itemCountNote}
                    focusKey={focusKey}
                  />
                ) : null}
                <PasteZone zoneRef={zoneRef} onText={takePaste} filled={items.length > 0} />
                {items.length === 0 ? (
                  <div>
                    <Button variant="quiet" onClick={addBlank}>Add an item by hand</Button>
                  </div>
                ) : null}
              </section>

              <section aria-label="Optional details" className="grid items-end gap-4 sm:grid-cols-2">
                <Field label="Quotation due" requirement="optional">
                  <DateInput value={dueOn} onChange={setDueOn} defaultToday={false} placeholder="e.g. 3 dec" />
                </Field>
                <Checkbox
                  checked={isPriority}
                  onCheckedChange={v => setIsPriority(v === true)}
                  label="Top priority"
                  help="Sorts it to the top of the board for everyone."
                />
              </section>
            </>
          ) : null}

          {step === 'suppliers' ? (
            <>
              <section aria-labelledby="h-items" className="grid gap-3">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="h-items" className="text-lg font-semibold tracking-snug">Items</h2>
                  <p className="text-sm text-fg-muted">
                    <span className="num">{real.length}</span> {real.length === 1 ? 'item' : 'items'}
                    {dueOn ? <> · quotation due <span className="num">{formatDay(dueOn)}</span></> : null}
                  </p>
                </div>
                <ItemChips items={real} />
              </section>
              <section aria-labelledby="h-sup" className="grid gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 id="h-sup" className="inline-flex items-center gap-1 text-lg font-semibold tracking-snug">
                    Suppliers
                    <InfoTip label="How is this list ordered?">
                      By the reason first (same model, same item, same brand), then the track record: on time or not, how often we have ordered, how often they reply, then
                      the most recent contact. A supplier marked late is still listed. Only suppliers who supplied the item before are ticked.
                    </InfoTip>
                  </h2>
                  <p className="text-sm text-fg-muted">Ticked: supplied this item before. The rest is your call.</p>
                </div>
                <SupplierPicker
                  groups={suggestions.groups}
                  ticked={tickedSet}
                  onToggle={toggleSupplier}
                  manual={manual}
                  onAddManual={addManual}
                  memory={memoryContext}
                  excludeIds={new Set([...(company ? [company.id] : []), ...suggestions.suppliers.map(s => s.supplierId)])}
                  loading={suppliersLoading}
                  error={suppliersError}
                  onRetry={() => {
                    void candidates.refetch()
                    void memory.refetch()
                  }}
                />
              </section>
            </>
          ) : null}

          {step === 'enquiry' && draft ? (
            <>
              {undone && saved ? (
                <Banner tone="info" title="Undone">
                  {rfqRef(saved.number)} is saved with {ticked.length} {ticked.length === 1 ? 'supplier' : 'suppliers'} shortlisted. Copy the message again when you send it.
                </Banner>
              ) : null}
              <Hint>
                <b className="font-medium text-fg">Spec lines are blank on purpose.</b> Type what the customer gave you under any item, or leave it. The app never writes a spec for you, and a blank one is fine to send.
              </Hint>
              <EnquiryCard
                count={ticked.length}
                variant={variant}
                onVariant={setVariant}
                recipients={recipients}
                onRemoveRecipient={id => toggleSupplier(id, false)}
                subject={draft.subject}
                body={body}
                onBody={text => setEdit(e => ({ sig, text: { ...(e.sig === sig ? e.text : {}), [variant]: text } }))}
                note={saved ? `${rfqRef(saved.number)} is saved. Paste it into each supplier’s chat.` : 'The RFQ number is filled in when you copy. Paste it into each supplier’s chat.'}
                locked={Boolean(saved)}
                actions={
                  <>
                    <Button variant="primary" icon={Copy} onClick={copyAndFloat} busy={busy === 'copy'} busyLabel="Copying" disabled={ticked.length === 0}>
                      Copy message for {ticked.length} {ticked.length === 1 ? 'supplier' : 'suppliers'}
                    </Button>
                    {saved ? null : <Button onClick={() => setStep('suppliers')}>Back to suppliers</Button>}
                    <Button variant="quiet" icon={Save} onClick={saveOnly} busy={busy === 'save'} busyLabel="Saving">
                      Save without asking
                    </Button>
                  </>
                }
              />
              {errorBanner}
            </>
          ) : null}

          {step === 'floated' && saved && draft && floatedOn ? (
            <FloatedPanel
              refText={rfqRef(saved.number)}
              openTo={`/rfqs/${saved.id}`}
              floatedOn={floatedOn}
              names={floatedNames}
              replyBy={replyBy}
              dueOn={dueOn || null}
              copied={copied}
              text={copiedText}
              onCopyAgain={copyAgain}
              unfloated={unfloated}
              onAnother={onAnother}
            />
          ) : null}

          {step === 'saved' && saved ? (
            <section aria-label="Saved" className="grid gap-4 rounded border bg-surface p-6">
              <h2 className="m-0 text-xl font-semibold tracking-snug"><span className="num">{rfqRef(saved.number)}</span> is saved</h2>
              <p className="m-0 text-sm text-fg-2">
                {ticked.length > 0
                  ? `${ticked.length} ${ticked.length === 1 ? 'supplier is' : 'suppliers are'} shortlisted (${joinNames(floatedNames)}). Nothing has been sent, so it shows as not sent to suppliers.`
                  : 'No supplier is shortlisted yet. Open it to ask suppliers when you are ready.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/rfqs/${saved.id}`}
                  className="inline-flex h-control items-center justify-center rounded border border-primary bg-primary px-3 text-sm font-medium leading-none text-primary-foreground transition-colors duration-fast ease-out hover:border-primary-hover hover:bg-primary-hover"
                >
                  Open {rfqRef(saved.number)}
                </Link>
                {ticked.length > 0 ? <Button onClick={() => setStep('enquiry')}>Write the message</Button> : null}
                <Button variant="quiet" onClick={onAnother}>Start another RFQ</Button>
              </div>
            </section>
          ) : null}

          {step === 'build' || step === 'suppliers' ? (
            <>
              {errorBanner}
              <div
                role="region"
                aria-label="Next step"
                className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border bg-surface px-4 py-3 shadow-pop"
              >
                <p className="m-0 min-w-0 text-sm text-fg-2">
                  {step === 'build' ? (
                    ready ? (
                      <>Creates a new RFQ for <strong className="font-medium text-fg">{company?.name}</strong> with <strong className="num font-medium text-fg">{real.length}</strong> {real.length === 1 ? 'item' : 'items'}.</>
                    ) : (
                      'Choose the company and paste or add at least one item.'
                    )
                  ) : (
                    <>
                      <strong className="num font-medium text-fg">{ticked.length}</strong> {ticked.length === 1 ? 'supplier' : 'suppliers'} ticked
                    </>
                  )}
                </p>
                {step === 'suppliers' && noSupplierLine ? (
                  <span className="inline-flex min-w-0 items-center gap-[6px] text-xs text-tone-warning-fg">
                    <Icon icon={TriangleAlert} size="sm" />
                    {noSupplierLine}
                  </span>
                ) : null}
                <span className="flex-1" />
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {step === 'suppliers' ? <Button onClick={() => setStep('build')}>Back to items</Button> : null}
                  <Button
                    variant={step === 'suppliers' && ticked.length === 0 ? 'primary' : 'quiet'}
                    icon={Save}
                    onClick={saveOnly}
                    disabled={!ready}
                    busy={busy === 'save'}
                    busyLabel="Saving"
                  >
                    Save without asking
                  </Button>
                  {step === 'build' ? (
                    <Button variant="primary" disabled={!ready} onClick={() => setStep('suppliers')}>
                      Looks right: find suppliers
                      <Icon icon={ChevronRight} />
                    </Button>
                  ) : ticked.length > 0 ? (
                    <Button variant="primary" onClick={() => setStep('enquiry')}>
                      Write the message
                      <Icon icon={ChevronRight} />
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <SidePanels
          step={step}
          number={saved?.number ?? null}
          customer={company?.name ?? null}
          itemCount={real.length}
          dueOn={dueOn || null}
          tickedCount={ticked.length}
          floated={step === 'floated'}
          floatedOn={floatedOn}
        />
      </div>

      {leaving ? (
        <Dialog open onOpenChange={o => (o ? null : setLeaving(null))}>
          <DialogContent
            title="Leave this new RFQ?"
            context={draftSummary(draftNow)}
            icon={TriangleAlert}
            footer={
              <>
                <Button data-cancel onClick={() => setLeaving(null)}>
                  Stay here
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    const go = leaving
                    setLeaving(null)
                    go()
                  }}
                >
                  Leave, keep the draft
                </Button>
              </>
            }
          >
            <p>It is not saved as an RFQ yet. What you typed stays on this device: open New RFQ again and choose Continue your draft.</p>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

function CustomerChip({ company, contacts, onChange }: { company: Company; contacts: string[]; onChange: () => void }) {
  const contactNote = contacts.length === 0 ? 'contact not added yet' : contacts.length === 1 ? contacts[0] : `${contacts.length} contacts`
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-3 rounded border bg-surface px-3 py-2">
      <Avatar name={company.name} className="!bg-selected !text-fg-2" />
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-medium">{company.name}</p>
        <p className="m-0 text-xs text-fg-muted">{[company.city ?? company.country, contactNote].filter(Boolean).join(' · ')}</p>
      </div>
      <span className="ml-auto" />
      {company.role ? <StatusBadge dimension="company-role" value={company.role} label={company.role === 'prospect' ? 'New prospect' : undefined} /> : null}
      <Button variant="quiet" size="sm" onClick={onChange} aria-label={`Change company, now ${company.name}`}>
        Change
      </Button>
    </div>
  )
}
