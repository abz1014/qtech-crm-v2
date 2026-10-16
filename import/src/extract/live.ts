import type { LegacyDump } from '../types'
import type { Extractor } from './extractor'

export interface LiveExtractFlags {
  iKnowThisIsLive: boolean
  /** The old project's REST URL (the SOURCE). Read only. */
  sourceUrl: string
}

/**
 * Extract from the OLD project's REST API with an admin session.
 *
 * NOT IMPLEMENTED ON PURPOSE. TODO(I07): the owner runs the extraction on his own machine, with his own admin session,
 * after the legacy service_role key has been rotated and the owner is present (docs/IMPORT.md, "Preconditions").
 * Until then this refuses to run, with or without flags, so no build, test or CI job can ever reach the old project.
 *
 * When it is built it must: only read (GET), page through each table, take the session from the owner's environment at
 * run time (never a file in the repo, never an argument), write the result only to import/.data/, and never send
 * anything to the new project.
 */
export class LiveExtractor implements Extractor {
  constructor(private readonly flags: LiveExtractFlags) {}

  async extract(): Promise<LegacyDump> {
    if (!this.flags.iKnowThisIsLive) {
      throw new Error('REFUSED: the live extractor needs --i-know-this-is-live. Use a dump file instead (--dump).')
    }
    throw new Error('NOT IMPLEMENTED: the live extractor is part of I07 and is run by the owner, not built yet. Use a dump file (--dump).')
  }
}
