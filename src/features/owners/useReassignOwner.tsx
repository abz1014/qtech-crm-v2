import { useState, type ReactNode } from 'react'
import { UserRoundCog } from 'lucide-react'
import { useSession } from '@/app/session'
import { MenuItem } from '@/ui/Popover'
import { ReassignOwnerDialog } from '@/features/owners/ReassignDialogs'
import type { OwnedKind } from '@/features/owners/api'

/*
 * "Reassign owner" for a page's More menu, in the shape of useHistoryPanel: `item` goes in the menu, `node` beside it (the dialog must
 * outlive the menu, which closes on a press), `ask` opens it from a plain button. Admin only: for anyone else all three are null and
 * nothing is drawn.
 */
export function useReassignOwnerItem(o: { kind: OwnedKind; id: string; label: string; ownerId: string | null; ownerName: string | null }): { item: ReactNode; node: ReactNode; ask: (() => void) | null } {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const admin = session.status === 'signed-in' && session.user.role === 'admin'
  if (!admin) return { item: null, node: null, ask: null }
  const ask = () => setOpen(true)
  return {
    ask,
    item: (
      <MenuItem icon={UserRoundCog} onClick={ask}>
        Reassign owner
      </MenuItem>
    ),
    node: open ? <ReassignOwnerDialog kind={o.kind} id={o.id} label={o.label} currentOwnerId={o.ownerId} currentOwnerName={o.ownerName} onClose={() => setOpen(false)} /> : null,
  }
}
