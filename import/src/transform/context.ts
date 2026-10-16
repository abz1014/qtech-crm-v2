import { legacyId } from '../lib/ids'
import { clean, normName, stableOrder, str } from '../lib/text'
import type { Row } from '../lib/text'
import type { Mappings } from '../mappings'
import type { LegacyDump, ReviewItem, TransformOptions } from '../types'

export interface OwnerRef {
  /** The person in the new project, or null when unknown. */
  userId: string | null
  /** false when the owner is on the "attribution is not reliable" list (the seed rows all name the admin). */
  reliable: boolean
}

/** Shared state for one transform run: the input, the reviewed lists, the review output and the drop counters. */
export class Ctx {
  readonly review: ReviewItem[] = []
  readonly droppedCount = new Map<string, number>()
  private readonly users = new Map<string, OwnerRef>()
  private readonly ownerUse = new Map<string, number>()
  private ownerTotal = 0

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
      this.users.set(String(u['id']), { userId, reliable: target ? target.ownerReliable : true })
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
    return u ?? { userId: null, reliable: true }
  }

  /**
   * owner_id plus the flags that go with it: owner_unknown when nobody is known (the row may then lack an owner),
   * owner_unreliable when the recorded person is on the unreliable list.
   */
  ownerFields(oldUserId: unknown, flags: string[]): string | null {
    const o = this.owner(oldUserId)
    const key = clean(oldUserId)
    if (key !== null) {
      this.ownerUse.set(key, (this.ownerUse.get(key) ?? 0) + 1)
    }
    this.ownerTotal++
    if (o.userId === null) {
      flags.push('owner_unknown')
      return null
    }
    if (!o.reliable) flags.push('owner_unreliable')
    return o.userId
  }

  /** A user who owns most of the records is almost certainly the seed attribution: list them for users.csv. */
  ownerConcentration(): void {
    if (this.ownerTotal < 10) return
    for (const [id, n] of this.ownerUse) {
      if (n / this.ownerTotal >= 0.7) {
        const u = this.rows('users').find(r => String(r['id']) === id)
        this.addReview(
          'owner_attribution',
          'users',
          id,
          str(u ?? {}, 'name') ?? id,
          `${n} of ${this.ownerTotal} RFQs and orders name this person. If that is the seed attribution, set owner_reliable to no in users.csv.`,
        )
      }
    }
  }
}
