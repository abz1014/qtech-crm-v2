import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * BackLink: the one way back drawn above a page's title on a computer ("< Lock a month", "< Companies", "< Home"). Every page
 * that has a way back above its h1 uses it, so there is one look (screen review 27: a muted text link on Money, a green link on
 * the weekly review and an outline button on the company and job pages). A screen reader hears "Back to <label>". Below 768
 * it is not drawn: the phone bar has its own back arrow. One 24 px row (the smallest target size), so a page can fold it into
 * the space above its title and the title sits where it does on its sister pages (MoneyFrame).
 */
const BACK_LINK =
  'inline-flex h-6 items-center gap-1 justify-self-start rounded-control text-sm font-medium text-fg-2 underline-offset-4 transition-colors duration-fast ease-out hover:text-fg hover:underline'

export function BackLink({ to, label, className }: { to: string; label: string; className?: string }) {
  return (
    <Link to={to} className={cn(BACK_LINK, 'max-md:hidden', className)}>
      <Icon icon={ChevronLeft} size="sm" />
      <span className="sr-only">Back to </span>
      {label}
    </Link>
  )
}
