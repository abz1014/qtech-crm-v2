import { useState, type FormEvent, type ReactNode } from 'react'
import { FolderInput, FolderPlus, Merge, Pencil, Plus, Target, Trash2, type LucideIcon } from 'lucide-react'
import {
  KIND_EFFECT,
  KIND_WORDS,
  PAID_VIA_LABEL,
  amountText,
  checkCategoryName,
  checkGroupName,
  deleteAdvice,
  groupLabel,
  mergeSummary,
  mergeTargets,
  nextSortIn,
  sortGroups,
  type Category,
  type CategoryGroup,
  type ExpenseGroup,
  type PaidVia,
} from '@/features/settings/categoriesModel'
import {
  useCreateCategory,
  useCreateGroup,
  useDeleteCategory,
  useDeleteGroup,
  useMergeCategories,
  useUpdateCategory,
  useUpdateGroup,
} from '@/features/settings/hooks'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useToast } from '@/ui/useToast'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'

/*
 * The dialogs of Settings › Expense categories (0083). Each is one small form: one press is one request, the dialog stays
 * open with what was typed when the server refuses, and the refusal is shown in its own words (rpcMessages).
 */
const NEW_GROUP = '__new__'
const KINDS: CategoryGroup[] = ['overhead', 'order_cost', 'non_pnl']
const PAY_OPTIONS = (['cash', 'bank'] as PaidVia[]).map(v => ({ value: v, label: PAID_VIA_LABEL[v] }))

interface ShellProps {
  title: string
  context?: ReactNode
  icon: LucideIcon
  tone?: 'neutral' | 'danger'
  busy: boolean
  error: string | null
  submit: string
  busyLabel: string
  danger?: boolean
  disabled?: boolean
  onSubmit: () => void | Promise<void>
  onClose: () => void
  children?: ReactNode
}

function FormDialog({ title, context, icon, tone, busy, error, submit, busyLabel, danger, disabled, onSubmit, onClose, children }: ShellProps) {
  const formId = `form-${title.replace(/\W+/g, '-').toLowerCase()}`
  const go = (e: FormEvent) => {
    e.preventDefault()
    if (!busy && !disabled) void onSubmit()
  }
  return (
    <Dialog open onOpenChange={o => !o && !busy && onClose()} busy={busy}>
      <DialogContent
        title={title}
        context={context}
        icon={icon}
        tone={tone}
        size="sm"
        footer={
          <>
            <Button data-cancel variant="quiet" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant={danger ? 'danger' : 'primary'} busy={busy} busyLabel={busyLabel} disabled={disabled}>
              {submit}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={go} noValidate className="grid gap-4" data-dialog-body>
          {children}
          {error ? (
            <Banner tone="danger" title="Nothing was changed">
              {error}
            </Banner>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  )
}

const message = (err: unknown) => mapPgError(err, { entity: 'category' }).message

// ---------------------------------------------------------------- Add category (with "New group…")

export function AddCategoryDialog({
  rows,
  groups,
  initialGroupId,
  onClose,
}: {
  rows: readonly Category[]
  groups: readonly ExpenseGroup[]
  initialGroupId?: string
  onClose: () => void
}) {
  const create = useCreateCategory()
  const createGroup = useCreateGroup()
  const { toast } = useToast()
  const ordered = sortGroups(groups)
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState(initialGroupId ?? ordered[0]?.id ?? NEW_GROUP)
  const [groupName, setGroupName] = useState('')
  const [kind, setKind] = useState<CategoryGroup>('overhead')
  const [paid, setPaid] = useState<PaidVia>('cash')
  const [budget, setBudget] = useState<number | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [groupError, setGroupError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = create.isPending || createGroup.isPending
  const newGroup = groupId === NEW_GROUP

  const submit = async () => {
    const check = checkCategoryName(name, rows)
    const gcheck = newGroup ? checkGroupName(groupName, groups) : null
    setNameError(check.ok ? null : check.message)
    setGroupError(gcheck && !gcheck.ok ? gcheck.message : null)
    if (!check.ok || (gcheck && !gcheck.ok)) return
    setError(null)
    try {
      let gid = groupId
      let gkind = groups.find(g => g.id === groupId)?.kind ?? kind
      if (newGroup && gcheck?.ok) {
        gid = await createGroup.mutateAsync({ name: gcheck.name, kind, sort: groups.reduce((m, g) => Math.max(m, g.sort), 0) + 10 })
        gkind = kind
        setGroupId(gid)
      }
      await create.mutateAsync({ name: check.name, group_id: gid, grp: gkind, default_paid_via: paid, sort: nextSortIn(rows, gid), monthly_budget_pkr: budget && budget > 0 ? budget : null })
      toast({ title: 'Category added', body: check.name, tone: 'success' })
      onClose()
    } catch (err) {
      const m = mapPgError(err, { entity: 'category' })
      if (m.kind === 'unique') setNameError('A category with this name already exists.')
      else setError(m.message)
    }
  }

  return (
    <FormDialog title="Add category" icon={Plus} busy={busy} error={error} submit="Add category" busyLabel="Adding" onSubmit={submit} onClose={onClose}>
      <Field label="Name" error={nameError ?? undefined}>
        <TextField
          data-autofocus
          value={name}
          maxLength={60}
          placeholder="e.g. Water, Generator fuel"
          onChange={e => {
            setName(e.target.value)
            setNameError(null)
          }}
        />
      </Field>
      <Field label="Group">
        <Select
          value={groupId}
          onChange={e => setGroupId(e.target.value)}
          options={[...ordered.map(g => ({ value: g.id, label: g.name })), { value: NEW_GROUP, label: 'New group…' }]}
        />
      </Field>
      {newGroup ? (
        <div className="grid gap-4 rounded border bg-sunken p-3">
          <Field label="New group name" error={groupError ?? undefined}>
            <TextField
              value={groupName}
              maxLength={60}
              placeholder="e.g. Site visits"
              onChange={e => {
                setGroupName(e.target.value)
                setGroupError(null)
              }}
            />
          </Field>
          <Field label="In Profit and loss" help="Fixed once the group has categories.">
            <Select value={kind} onChange={e => setKind(e.target.value as CategoryGroup)} options={KINDS.map(k => ({ value: k, label: KIND_WORDS[k] }))} />
          </Field>
        </div>
      ) : null}
      <Field label="Usually paid">
        <SegmentedControl aria-label="Usually paid" fill options={PAY_OPTIONS} value={paid} onValueChange={v => setPaid(v as PaidVia)} />
      </Field>
      <Field label="Monthly budget" requirement="optional" help="Shown against what was spent each month. Leave empty for none.">
        <NumberInput value={budget} onChange={setBudget} min={1} prefix="PKR" aria-label="Monthly budget, PKR" />
      </Field>
    </FormDialog>
  )
}

// ---------------------------------------------------------------- Add group

export function AddGroupDialog({ groups, onClose }: { groups: readonly ExpenseGroup[]; onClose: () => void }) {
  const create = useCreateGroup()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryGroup>('overhead')
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    const check = checkGroupName(name, groups)
    if (!check.ok) return setNameError(check.message)
    try {
      await create.mutateAsync({ name: check.name, kind, sort: groups.reduce((m, g) => Math.max(m, g.sort), 0) + 10 })
      toast({ title: 'Group added', body: check.name, tone: 'success' })
      onClose()
    } catch (err) {
      const m = mapPgError(err, { entity: 'group' })
      if (m.kind === 'unique') setNameError('A group with this name already exists.')
      else setError(m.message)
    }
  }
  return (
    <FormDialog title="Add group" icon={FolderPlus} busy={create.isPending} error={error} submit="Add group" busyLabel="Adding" onSubmit={submit} onClose={onClose}>
      <Field label="Name" error={nameError ?? undefined}>
        <TextField
          data-autofocus
          value={name}
          maxLength={60}
          placeholder="e.g. Site visits"
          onChange={e => {
            setName(e.target.value)
            setNameError(null)
          }}
        />
      </Field>
      <Field label="In Profit and loss" help="Every category in the group is counted this way. Fixed once the group has categories.">
        <Select value={kind} onChange={e => setKind(e.target.value as CategoryGroup)} options={KINDS.map(k => ({ value: k, label: KIND_WORDS[k] }))} />
      </Field>
    </FormDialog>
  )
}

// ---------------------------------------------------------------- Rename (category or group)

export function RenameDialog({
  what,
  current,
  check,
  save,
  onClose,
}: {
  what: 'category' | 'group'
  current: string
  check: (raw: string) => ReturnType<typeof checkCategoryName>
  save: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()
  const submit = async () => {
    const c = check(name)
    if (!c.ok) return setNameError(c.message)
    if (c.name === current) return onClose()
    setBusy(true)
    try {
      await save(c.name)
      toast({ title: what === 'group' ? 'Group renamed' : 'Category renamed', body: `${current} is now ${c.name}`, tone: 'success' })
      onClose()
    } catch (err) {
      const m = mapPgError(err, { entity: what })
      if (m.kind === 'unique') setNameError(`A ${what} with this name already exists.`)
      else setError(m.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormDialog title={`Rename ${current}`} icon={Pencil} busy={busy} error={error} submit="Rename" busyLabel="Renaming" onSubmit={submit} onClose={onClose}>
      <Field label="Name" error={nameError ?? undefined} help={what === 'category' ? 'Past expenses show the new name too.' : undefined}>
        <TextField
          data-autofocus
          value={name}
          maxLength={60}
          onChange={e => {
            setName(e.target.value)
            setNameError(null)
          }}
        />
      </Field>
    </FormDialog>
  )
}

export function RenameCategoryDialog({ c, rows, onClose }: { c: Category; rows: readonly Category[]; onClose: () => void }) {
  const update = useUpdateCategory()
  return (
    <RenameDialog
      what="category"
      current={c.name}
      check={raw => checkCategoryName(raw, rows, c.id)}
      save={name => update.mutateAsync({ id: c.id, patch: { name } })}
      onClose={onClose}
    />
  )
}

export function RenameGroupDialog({ g, groups, onClose }: { g: ExpenseGroup; groups: readonly ExpenseGroup[]; onClose: () => void }) {
  const update = useUpdateGroup()
  return (
    <RenameDialog
      what="group"
      current={g.name}
      check={raw => checkGroupName(raw, groups, g.id)}
      save={name => update.mutateAsync({ id: g.id, patch: { name } })}
      onClose={onClose}
    />
  )
}

// ---------------------------------------------------------------- Move to group

export function MoveDialog({ c, rows, groups, onClose }: { c: Category; rows: readonly Category[]; groups: readonly ExpenseGroup[]; onClose: () => void }) {
  const update = useUpdateCategory()
  const { toast } = useToast()
  const others = sortGroups(groups).filter(g => g.id !== c.group_id)
  const [to, setTo] = useState(others.find(g => g.kind === c.grp)?.id ?? others[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const target = groups.find(g => g.id === to)
  const changesKind = !!target && target.kind !== c.grp
  const submit = async () => {
    if (!target) return
    setError(null)
    try {
      await update.mutateAsync({ id: c.id, patch: { group_id: target.id, sort: nextSortIn(rows, target.id) } })
      toast({ title: 'Category moved', body: `${c.name} is now under ${target.name}`, tone: 'success' })
      onClose()
    } catch (err) {
      setError(message(err))
    }
  }
  return (
    <FormDialog
      title={`Move ${c.name}`}
      context="Pick the group it should be listed under."
      icon={FolderInput}
      busy={update.isPending}
      error={error}
      submit="Move"
      busyLabel="Moving"
      disabled={!target}
      onSubmit={submit}
      onClose={onClose}
    >
      <Field label="Group">
        <Select data-autofocus value={to} onChange={e => setTo(e.target.value)} options={others.map(g => ({ value: g.id, label: groupLabel(g) }))} />
      </Field>
      {changesKind && target ? (
        <Banner tone="warning" title="This changes Profit and loss">
          {`Past and new ${c.name} expenses will count as ${KIND_EFFECT[target.kind]}, not ${KIND_EFFECT[c.grp]}. Not allowed while ${c.name} has expenses in a closed month.`}
        </Banner>
      ) : null}
    </FormDialog>
  )
}

// ---------------------------------------------------------------- Monthly budget

export function BudgetDialog({ c, spent, onClose }: { c: Category; spent: number; onClose: () => void }) {
  const update = useUpdateCategory()
  const { toast } = useToast()
  const [budget, setBudget] = useState<number | null>(c.monthly_budget_pkr)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    const value = budget && budget > 0 ? budget : null
    setError(null)
    try {
      await update.mutateAsync({ id: c.id, patch: { monthly_budget_pkr: value } })
      toast({ title: value ? 'Budget set' : 'Budget removed', body: value ? `${c.name}: PKR ${amountText(value)} a month` : c.name, tone: 'success' })
      onClose()
    } catch (err) {
      setError(message(err))
    }
  }
  return (
    <FormDialog
      title={`Monthly budget for ${c.name}`}
      context={`Spent this month: PKR ${amountText(spent)}`}
      icon={Target}
      busy={update.isPending}
      error={error}
      submit={budget && budget > 0 ? 'Save budget' : c.monthly_budget_pkr ? 'Remove budget' : 'Save'}
      busyLabel="Saving"
      onSubmit={submit}
      onClose={onClose}
    >
      <Field label="Budget a month" requirement="optional" help="Leave empty for no budget.">
        <NumberInput data-autofocus value={budget} onChange={setBudget} min={1} prefix="PKR" aria-label="Budget a month, PKR" />
      </Field>
    </FormDialog>
  )
}

// ---------------------------------------------------------------- Merge

export function MergeDialog({ c, rows, groups, onClose }: { c: Category; rows: readonly Category[]; groups: readonly ExpenseGroup[]; onClose: () => void }) {
  const merge = useMergeCategories()
  const { toast } = useToast()
  const { same, other } = mergeTargets(c, rows, groups)
  const groupName = (id: string) => groups.find(g => g.id === id)?.name ?? ''
  const [into, setInto] = useState(same[0]?.id ?? other[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const target = rows.find(r => r.id === into)
  const option = (x: Category) => ({ value: x.id, label: `${x.name} (${groupName(x.group_id)})` })
  const submit = async () => {
    if (!target) return
    setError(null)
    try {
      const moved = await merge.mutateAsync({ from: c.id, into: target.id })
      toast({ title: 'Categories merged', body: `${moved} ${moved === 1 ? 'expense' : 'expenses'} moved from ${c.name} into ${target.name}`, tone: 'success' })
      onClose()
    } catch (err) {
      setError(message(err))
    }
  }
  return (
    <FormDialog
      title={`Merge ${c.name}`}
      context="Use this when two categories mean the same thing."
      icon={Merge}
      busy={merge.isPending}
      error={error}
      submit="Merge"
      busyLabel="Merging"
      disabled={!target}
      onSubmit={submit}
      onClose={onClose}
    >
      <Field label="Merge into">
        <Select
          data-autofocus
          value={into}
          onChange={e => setInto(e.target.value)}
          options={[...same.map(option), ...other.map(x => ({ ...option(x), label: `${option(x).label}, ${KIND_WORDS[x.grp].toLowerCase()}` }))]}
        />
      </Field>
      {target ? (
        <p className="text-base text-fg text-pretty" data-testid="merge-summary">
          {mergeSummary(c, target)}
        </p>
      ) : null}
      {target && target.grp !== c.grp ? (
        <Banner tone="warning" title="This changes Profit and loss">
          {`${c.name} expenses will count as ${KIND_EFFECT[target.grp]}, not ${KIND_EFFECT[c.grp]}. Not allowed while ${c.name} has expenses in a closed month.`}
        </Banner>
      ) : null}
    </FormDialog>
  )
}

// ---------------------------------------------------------------- Delete (unused only)

export function DeleteCategoryDialog({ c, onClose }: { c: Category; onClose: () => void }) {
  const del = useDeleteCategory()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setError(null)
    try {
      await del.mutateAsync(c.id)
      toast({ title: 'Category deleted', body: c.name, tone: 'success' })
      onClose()
    } catch (err) {
      const m = mapPgError(err, { entity: 'category' })
      setError(m.kind === 'reference-in-use' ? 'It started being used, so it cannot be deleted. Archive it instead.' : m.message)
    }
  }
  return (
    <FormDialog title={`Delete ${c.name}?`} icon={Trash2} tone="danger" danger busy={del.isPending} error={error} submit="Delete category" busyLabel="Deleting" onSubmit={submit} onClose={onClose}>
      <p className="text-base text-pretty">{deleteAdvice(c).message}</p>
    </FormDialog>
  )
}

export function DeleteGroupDialog({ g, onClose }: { g: ExpenseGroup; onClose: () => void }) {
  const del = useDeleteGroup()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setError(null)
    try {
      await del.mutateAsync(g.id)
      toast({ title: 'Group deleted', body: g.name, tone: 'success' })
      onClose()
    } catch (err) {
      const m = mapPgError(err, { entity: 'group' })
      setError(m.kind === 'reference-in-use' ? 'It has categories now. Move or merge them first.' : m.message)
    }
  }
  return (
    <FormDialog title={`Delete ${g.name}?`} icon={Trash2} tone="danger" danger busy={del.isPending} error={error} submit="Delete group" busyLabel="Deleting" onSubmit={submit} onClose={onClose}>
      <p className="text-base text-pretty">The group is empty, so nothing else changes.</p>
    </FormDialog>
  )
}

