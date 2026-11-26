import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { navItems } from '@/app/navConfig'
import { getHomeRoute } from '@/app/roleRoutes'
import { ROLE_LABEL, useSession } from '@/app/session'
import { PageFrame } from '@/app/pages/PageFrame'
import { Button } from '@/ui/Button'
import { noAccessTitle } from '@/app/pages/noAccessTitle'

/** What a person asks an admin for, per area. Anything not listed falls back to "access to <area>". */
const NEED: Record<string, string> = { Money: 'to see invoices or amounts to collect', Reports: 'to see reports' }

/**
 * Role-limited state (components-09, "Not available to this role"): a warning tile with a lock, what is
 * missing and who can change it. Names the role. Used for a destination the role cannot reach and for an
 * account with no role. `adminNote` replaces "Ask an admin" for an admin who opens a page that is not theirs.
 */
export function NoAccessPage({ area, roles, adminNote }: { area?: string; roles?: readonly string[]; adminNote?: string }) {
  const session = useSession()
  const navigate = useNavigate()
  const role = session.status === 'signed-in' ? session.user.role : ''
  const home = getHomeRoute(role)
  const known = home !== '/no-access'
  const allowed = area ? (roles ?? navItems.find(i => i.label === area)?.roles ?? ['admin']) : []
  const title = area ? noAccessTitle(area, allowed) : 'This account has no access yet'
  const body = known
    ? role === 'admin' && adminNote
      ? `Your role is ${ROLE_LABEL[role] ?? role}. ${adminNote}`
      : `Your role is ${ROLE_LABEL[role] ?? role}. Ask an admin ${area ? (NEED[area] ?? `if you need access to ${area}`) : 'if you need access to this page'}.`
    : 'Your account has no role assigned. Ask an admin to set one on the Team screen.'
  return (
    // Forest (58 #money-checks-sales, 59 #rp-noaccess): the shared state card, as Page not found draws it, one width everywhere
    <PageFrame
      mood="warning"
      title={title}
      actions={
        known ? (
          <Button icon={ArrowLeft} onClick={() => navigate(home)}>
            Go to Home
          </Button>
        ) : undefined
      }
    >
      {body}
    </PageFrame>
  )
}
