import { Fragment, useMemo } from 'react'
import { Keyboard } from 'lucide-react'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Kbd } from '@/ui/Kbd'
import { useSession } from '@/app/session'
import { KEY_WORDS, SHORTCUT_GROUPS, groupNote, shortcutsFor, type Shortcut } from '@/app/shell/shortcuts'

/*
 * Keyboard shortcuts sheet (spec round 2, 4.2). A 520 px dialog drawn from the one list in shortcuts.ts, in its five
 * groups. Opened by `?` outside a text box, the account menu (desktop) and the palette's "Keyboard shortcuts" action.
 * Loaded lazily by PaletteHost: it costs nothing until someone asks for it.
 * Forest (82-help.html .qb-keygroup, .qb-keys): a bold group title, the action in body text with where it works under it in the
 * secondary size, the keys right-aligned; in a narrow window the keys drop under their action instead of squeezing it.
 */
export function ShortcutsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : undefined
  const list = useMemo(() => shortcutsFor(role), [role])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" icon={Keyboard} size="md">
        {SHORTCUT_GROUPS.map(group => {
          const rows = list.filter(s => s.group === group)
          if (rows.length === 0) return null
          const note = groupNote(group, role)
          const id = `shortcuts-${group.replace(/\W+/g, '-').toLowerCase()}`
          return (
            <section key={group} aria-labelledby={id} className="grid min-w-0 gap-2 border-t pt-4 first:border-t-0 first:pt-0">
              <h3 id={id} className="text-base font-bold text-fg">
                {group}
              </h3>
              {note ? <p className="text-sm text-fg-2 text-pretty">{note}</p> : null}
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 min-[30rem]:grid-cols-[minmax(0,1fr)_auto]">
                {rows.map(s => (
                  <Fragment key={`${s.what}|${s.keys.join(' ')}`}>
                    <dt className="min-w-0 break-words text-base text-fg">
                      {s.what}
                      {s.where ? <span className="block text-sm text-fg-muted">{s.where}</span> : null}
                    </dt>
                    <dd className="mb-2 flex flex-wrap items-center justify-start gap-1 self-start min-[30rem]:mb-0 min-[30rem]:justify-end">
                      <Keys keys={s.keys} />
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          )
        })}
      </DialogContent>
    </Dialog>
  )
}

function Keys({ keys }: { keys: Shortcut['keys'] }) {
  return (
    <>
      {keys.map((k, i) =>
        KEY_WORDS.has(k) ? (
          <span key={i} className="px-1 text-sm text-fg-muted">
            {k}
          </span>
        ) : (
          <Kbd key={i}>{k}</Kbd>
        ),
      )}
    </>
  )
}
