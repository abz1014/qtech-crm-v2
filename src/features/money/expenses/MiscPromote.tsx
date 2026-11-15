import { useId, useState } from 'react'
import { Check, Lightbulb } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import { cn } from '@/lib/utils'
import { CARD } from '@/ui/card'
import { FIELD } from '@/features/money/expenses/Panel'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useMiscSuggestions, usePromoteMiscTitle } from '@/features/money/expenses/hooks'
import type { MiscSuggestion } from '@/features/money/expenses/api'
import { pkr } from '@/features/money/expenses/model'

/*
 * 0091: "'Courier from shop' used 5 times: make it a category." One banner per title that was used 3 or more times in 90 days under
 * an "Other". Admin only (suggest_misc_categories refuses anyone else, so the strip stays away without it). "Make it a category"
 * asks for the name (the title, to change), then promote_misc_title re-files those expenses; their titles stay. "Not now" hides it
 * for this visit only. 16 px text, 44 px taps.
 */
export function MiscPromoteBanners() {
  const q = useMiscSuggestions()
  const [hidden, setHidden] = useState<readonly string[]>([])
  const phone = useMediaQuery('(max-width: 639px)')
  const shown = (q.data ?? []).filter(s => !hidden.includes(key(s)))
  if (shown.length === 0) return null
  return (
    <section aria-label="One-off titles that keep coming back" className="grid gap-card-gap" data-testid="misc-promote">
      {shown.slice(0, phone ? 1 : 3).map(s => (
        <Suggestion key={key(s)} s={s} onHide={() => setHidden(h => [...h, key(s)])} />
      ))}
    </section>
  )
}

const key = (s: MiscSuggestion) => `${s.miscCategoryId}|${s.titleKey}`

function Suggestion({ s, onHide }: { s: MiscSuggestion; onHide: () => void }) {
  const uid = useId()
  const toast = useToast()
  const promote = usePromoteMiscTitle()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(s.title)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    setError(null)
    promote.mutate(
      { miscCategoryId: s.miscCategoryId, titleKey: s.titleKey, name: name.trim() },
      {
        onSuccess: n => toast.toast({ title: `“${name.trim()}” is a category now`, body: `${n} ${n === 1 ? 'expense' : 'expenses'} moved there`, tone: 'success' }),
        onError: e => setError(mapPgError(e, { entity: 'category' }).message),
      },
    )
  }
  return (
    <div className={cn(CARD, 'grid gap-3 p-card text-base')} data-testid="misc-promote-item">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-control-sm shrink-0 place-items-center rounded-control bg-tone-info-bg text-tone-info-fg">
          <Icon icon={Lightbulb} />
        </span>
        <p className="min-w-0 flex-1 self-center [overflow-wrap:anywhere]">
          <b className="font-bold">&apos;{s.title}&apos;</b> used {s.uses} times (<span className="num">{pkr(s.spent)}</span>): make it a category.
        </p>
      </div>
      {naming ? null : (
        <span className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onHide} className="max-md:h-touch">
            Not now
          </Button>
          <Button onClick={() => setNaming(true)} className="max-md:h-touch">
            Make it a category
          </Button>
        </span>
      )}
      {naming ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor={`${uid}-name`} className="grid min-w-0 flex-[1_1_12rem] gap-2">
            <span className="text-sm font-bold">Name of the category</span>
            <input
              id={`${uid}-name`}
              value={name}
              maxLength={80}
              onChange={e => setName(e.target.value)}
              className={FIELD}
            />
          </label>
          <Button variant="quiet" onClick={() => setNaming(false)} disabled={promote.isPending} className="max-md:h-touch">
            Back
          </Button>
          <Button type="submit" icon={Check} busy={promote.isPending} busyLabel="Saving" disabled={!name.trim()} className="max-md:h-touch">
            Save category
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-tone-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  )
}
