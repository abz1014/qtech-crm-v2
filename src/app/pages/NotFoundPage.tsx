import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPinOff } from 'lucide-react'
import { PageFrame } from '@/app/pages/PageFrame'
import { Button } from '@/ui/Button'

/** The address matches no page: the shared state card (PageFrame), as the lock screens draw it. */
export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <PageFrame
      title="Page not found"
      icon={MapPinOff}
      actions={
        <Button icon={ArrowLeft} onClick={() => navigate('/')}>
          Go to Home
        </Button>
      }
    >
      This address does not match a page. The link may be old or mistyped.
    </PageFrame>
  )
}
