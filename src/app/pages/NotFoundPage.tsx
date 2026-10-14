import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageFrame } from '@/app/pages/PageFrame'
import { Button } from '@/ui/Button'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <PageFrame title="Page not found" lede="This address does not match a page. The link may be old or mistyped.">
      <div>
        <Button icon={ArrowLeft} onClick={() => navigate('/')}>
          Go to Today
        </Button>
      </div>
    </PageFrame>
  )
}
