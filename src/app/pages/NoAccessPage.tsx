import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { getHomeRoute } from '@/app/roleRoutes'
import { useSession } from '@/app/session'
import { PageFrame } from '@/app/pages/PageFrame'
import { Button } from '@/ui/Button'

/**
 * Role-limited state (components-09): says what is true and where to go. Used
 * for a destination the role cannot reach and for an account with no role.
 */
export function NoAccessPage({ area }: { area?: string }) {
  const session = useSession()
  const navigate = useNavigate()
  const role = session.status === 'signed-in' ? session.user.role : ''
  const home = getHomeRoute(role)
  const known = home !== '/no-access'
  return (
    <PageFrame
      title={area ? `${area} is not available to your role` : 'This account has no access yet'}
      lede={
        known
          ? 'Your role does not include this page. Everything you can use is in the navigation.'
          : 'Your account has no role assigned. Ask an admin to set one on the Team screen.'
      }
    >
      {known ? (
        <div>
          <Button icon={ArrowLeft} onClick={() => navigate(home)}>
            Go to Today
          </Button>
        </div>
      ) : null}
    </PageFrame>
  )
}
