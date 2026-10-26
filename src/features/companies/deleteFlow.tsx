import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { GitMerge } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
import { refreshAfterCompanyDelete, useDeleteCompany } from '@/features/companies/hooks'

/*
 * Delete a company (W12a, 0092 delete_company; owner decision 2026-10-23: permanent, admin only). Only a company nothing refers
 * to can go. The page knows its RFQs and orders, so a company with any is blocked at once; the database also checks invoices,
 * expenses and supplier orders and answers with the HINT in_use. Either way the confirm says it is in use and offers
 * "Merge into…" (the merge dialog the company page already has) instead of Delete.
 */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function inUseWords(rfqs: number, orders: number): string {
  const used = [rfqs > 0 ? plural(rfqs, 'RFQ') : '', orders > 0 ? plural(orders, 'order') : ''].filter(Boolean).join(' and ')
  return used ? `Used by ${used}, so it cannot be deleted.` : 'It is used by RFQs, orders, invoices or expenses, so it cannot be deleted.'
}

export function useDeleteCompanyFlow(company: { id: string; name: string }, used: { rfqs: number; orders: number }, onMerge: () => void) {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const client = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const del = useDeleteCompany()
  const [open, setOpen] = useState(false)
  // The database said in_use although the page did not know of a use (an invoice, an expense): blocked from then on.
  const [refused, setRefused] = useState(false)

  const blocked: ReactNode =
    used.rfqs + used.orders > 0 || refused ? (
      <span className="grid justify-items-start gap-3" data-slot="delete-blocked-in-use">
        <span>
          {used.rfqs + used.orders > 0 ? inUseWords(used.rfqs, used.orders) : 'It is used by RFQs, orders, invoices or expenses, so it cannot be deleted.'} Merge it into the right
          company instead: everything on it moves there.
        </span>
        <Button
          icon={GitMerge}
          onClick={() => {
            setOpen(false)
            onMerge()
          }}
        >
          Merge into…
        </Button>
      </span>
    ) : null

  const confirm = async () => {
    try {
      await del.mutateAsync(company.id)
    } catch (e) {
      if (mapPgError(e).hint === 'in_use') setRefused(true)
      throw e
    }
    navigate('/companies')
    void refreshAfterCompanyDelete(client, company.id)
    toast({ title: `${company.name} deleted`, tone: 'success' })
  }

  const node: ReactNode =
    isAdmin && open ? (
      <ConfirmDelete
        open
        onOpenChange={o => {
          if (!o) setOpen(false)
        }}
        thing={company.name}
        summary={blocked ? company.name : 'No RFQ, order, invoice or expense uses this company.'}
        blocked={blocked}
        onConfirm={confirm}
        errorMessage={e => (mapPgError(e).hint === 'in_use' ? '' : mapPgError(e, { entity: 'company' }).message)}
      />
    ) : null

  return {
    /** Admin only; undefined for everyone else, so the menu draws no item. */
    ask: isAdmin
      ? () => {
          setRefused(false)
          setOpen(true)
        }
      : undefined,
    node,
  }
}
