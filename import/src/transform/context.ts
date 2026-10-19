import { legacyId } from '../lib/ids'
import { clean, normName, stableOrder, str } from '../lib/text'
import type { Row } from '../lib/text'
import type { Mappings } from '../mappings'
import type { LegacyDump, ReviewItem, TransformOptions } from '../types'

export interface OwnerRef {
  /** The person in the new project, or null when unknown. */
  userId: string | null
}

/** Shared state for one transform run: the input, the reviewed lists, the review output and the drop counters. */
export class Ctx {
  readonly review: ReviewItem[] = []
  readonly droppedCount = new Map<string, number>()
  private readonly users = new Map<string, OwnerRef>()

  constructor(
    readonly dump: LegacyDump,
    readonly maps: Mappings,
    readonly opts: TransformOptions,
  ) {
    const v2ByName = new Map((opts.v2Users ?? []).map(u => [normName(u.name), u.id]))
    for (const u of this.rows('users')) {
      const oldName = str(u, 'name')
      const target = this.maps.users.get(normName(oldName))
      const newName = target ? target.newName : oldName
      let userId: string | null = null
      if (newName) {
        userId = opts.v2Users === null ? legacyId('placeholder-user', normName(newName)) : (v2ByName.get(normName(newName)) ?? null)
      }
      this.users.set(String(u['id']), { userId })
    }
  }

  rows(table: string): Row[] {
    return stableOrder(this.dump.tables[table] ?? [])
  }

  addReview(list: string, table: string, oldId: string, label: string, detail: string): void {
    this.review.push({ list, table, oldId, label, detail })
  }

  /** A source row that cannot be imported. It is counted, listed in dropped_rows, and its amount (if any) is reconciled separately. */
  drop(table: string, oldId: string, label: string, reason: string): void {
    this.droppedCount.set(table, (this.droppedCount.get(table) ?? 0) + 1)
    this.addReview('dropped_rows', table, oldId, label, reason)
  }

  owner(oldUserId: unknown): OwnerRef {
    const id = clean(oldUserId)
    const u = id === null ? undefined : this.users.get(id)
    return u ?? { userId: null }
  }

  /**
   * owner_id plus the flag that goes with it: owner_unknown when nobody is known (the row may then lack an owner).
   * The owner of an old record is kept as recorded. It carries NO credit: imported payments are never credited to anyone
   * (see money.ts), so how reliable the old attribution was does not matter to the run.
   */
  ownerFields(oldUserId: unknown, flags: string[]): string | null {
    const o = this.owner(oldUserId)
    if (o.userId === null) {
      flags.push('owner_unknown')
      return null
    }
    return o.userId
  }
}
