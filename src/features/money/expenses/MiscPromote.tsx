import { useId, useState } from 'react'
import { Check, Lightbulb } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import { useMiscSuggestions, usePromoteMiscTitle } from '@/features/money/expenses/hooks'
import type { MiscSuggestion } from '@/features/money/expenses/api'
import { pkr } from '@/features/money/expenses/model'

/*
 * 0091: "'Courier from shop' used 5 times: make it a category?" One banner per title that was used 3 or more times in 90 days under
 * an "Other". Admin only (suggest_misc_categories refuses anyone else, so the strip stays away without it). "Make it a category"
 * asks for the name (the title, to change), then promote_misc_title re-files those expenses; their titles stay. "Not now" hides it
 * for this visit only. 16 px text, 44 px taps.
 */
export function MiscPromoteBanners() {
  const q = useMiscSuggestions()
  const [hidden, setHidden] = useState<readonly string[]>([])
  const shown = (q.data ?? []).filter(s => !hidden.includes(key(s)))
  if (shown.length === 0) return null
  return (
    <section aria-label="One-off titles that keep coming back" className="grid gap-3" data-testid="misc-promote">
      {shown.slice(0, 3).map(s => (
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
    <div className="grid gap-3 rounded-row border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3 text-base" data-testid="misc-promote-item">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Icon icon={Lightbulb} className="text-tone-info-fg" />
        <p className="min-w-0 flex-1">
          <b className="font-semibold">‘{s.title}’</b> used {s.uses} times ({pkr(s.spent)}): make it a category?
        </p>
        {naming ? null : (
          <span className="flex flex-wrap gap-2">
            <Button size="touch" variant="quiet" onClick={onHide} className="text-base">
              Not now
            </Button>
            <Button size="touch" onClick={() => setNaming(true)} className="text-base">
              Make it a category
            </Button>
          </span>
        )}
      </div>
      {naming ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor={`${uid}-name`} className="grid min-w-0 flex-1 gap-2">
            <span className="font-medium">Name of the category</span>
            <input
              id={`${uid}-name`}
              value={name}
              maxLength={80}
              onChange={e => setName(e.target.value)}
              className="min-h-touch w-full rounded border border-line-input bg-surface px-3 text-base"
            />
          </label>
          <Button size="touch" variant="quiet" onClick={() => setNaming(false)} disabled={promote.isPending} className="text-base">
            Back
          </Button>
          <Button type="submit" size="touch" icon={Check} busy={promote.isPending} busyLabel="Saving" disabled={!name.trim()} className="text-base">
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
