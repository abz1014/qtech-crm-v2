import type { LegacyDump } from '../types'

/** Where the old data comes from. Today only a dump file is implemented (dump.ts); the live REST extractor is live.ts. */
export interface Extractor {
  extract(): Promise<LegacyDump>
}
