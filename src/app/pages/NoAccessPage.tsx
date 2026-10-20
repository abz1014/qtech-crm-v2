import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { navItems } from '@/app/navConfig'
import { getHomeRoute } from '@/app/roleRoutes'
import { ROLE_LABEL, useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'

const WHO: Record<string, string> = { admin: 'admins', sales: 'sales', engineer: 'engineers' }

/** What a person asks an admin for, per area. Anything not listed falls back to "access to <area>". */
const NEED: Record<string, string> = { Money: 'to see invoices or who owes us', Reports: 'to see reports' }

function joinWords(words: string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * Role-limited state (components-09, "Not available to this role"): a warning tile with a lock, what is
 * missing and who can change it. Names the role. Used for a destination the role cannot reach and for an
 * account with no role.
 */
export function NoAccessPage({ area }: { area?: string }) {
  const session = useSession()
  const navigate = useNavigate()
  const role = session.status === 'signed-in' ? session.user.role : ''
  const home = getHomeRoute(role)
  const known = home !== '/no-access'
  const allowed = area ? (navItems.find(i => i.label === area)?.roles ?? ['admin']) : []
  const title = area ? `${area} is for ${joinWords(allowed.map(r => WHO[r] ?? r))}` : 'This account has no access yet'
  const body = known
    ? `Your role is ${ROLE_LABEL[role] ?? role}. Ask an admin ${area ? (NEED[area] ?? `if you need access to ${area}`) : 'if you need access to this page'}.`
    : 'Your account has no role assigned. Ask an admin to set one on the Team screen.'
  return (
    <div className="mx-auto grid max-w-list content-start px-4 pb-12 pt-6 md:px-8 md:pt-12">
      <h1 className="sr-only">{title}</h1>
      <EmptyState
        mood="warning"
        bordered
        title={title}
        actions={
          known ? (
            <Button icon={ArrowLeft} onClick={() => navigate(home)}>
              Go to Today
            </Button>
          ) : undefined
        }
      >
        {body}
      </EmptyState>
    </div>
  )
}
