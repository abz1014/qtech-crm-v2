import { bearerToken, generatePassword as defaultGenerate, validEmail } from './lib.ts'
import { type Profile, ROLES, type Role, type Store } from './types.ts'

export interface Deps {
  store: Store
  allowedOrigins: Set<string>
  generatePassword?: () => string
}

const LAST_ADMIN = 'The system must keep at least one active admin.'

class HttpError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v)
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const { store, allowedOrigins } = deps
  const gen = deps.generatePassword ?? defaultGenerate

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin')
    const originAllowed = origin === null || allowedOrigins.has(origin)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // A generated password may be in the body: never cache a response.
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    }
    if (origin && originAllowed) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type'
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    }
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })

    if (req.method === 'OPTIONS') {
      return originAllowed ? new Response(null, { status: 204, headers }) : reply(403, { error: 'Origin not allowed.' })
    }
    // A browser on another origin is refused outright; non-browser callers send no Origin and still need an admin token.
    if (!originAllowed) return reply(403, { error: 'Origin not allowed.' })
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

    try {
      // 1. Who is calling, and are they an active admin? Checked on the server for every action.
      const token = bearerToken(req.headers.get('Authorization'))
      if (!token) return reply(401, { error: 'Sign in first.' })
      const callerId = await store.authenticate(token)
      if (!callerId) return reply(401, { error: 'Sign in first.' })
      const caller = await store.getProfile(callerId)
      if (!caller || caller.role !== 'admin' || caller.deactivated_at !== null) {
        return reply(403, { error: 'Only an active admin can manage people.' })
      }

      let body: Record<string, unknown>
      try {
        const parsed = await req.json()
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape')
        body = parsed as Record<string, unknown>
      } catch {
        return reply(400, { error: 'Send a JSON object with an action.' })
      }

      const audit = async (
        record_id: string,
        action: 'insert' | 'update',
        old_value: Record<string, unknown> | null,
        new_value: Record<string, unknown> | null,
      ) => {
        // Never put a password in old_value or new_value. A failed audit write is logged loudly but does
        // not discard a one-time password that was already generated.
        const err = await store.writeAudit({ table_name: 'users', record_id, action, changed_by: callerId, old_value, new_value })
        if (err) console.error('admin-users: audit write failed', { record_id, action, err })
      }

      const target = async (): Promise<Profile> => {
        if (!isUuid(body.user_id)) throw new HttpError(400, 'user_id is required.')
        const p = await store.getProfile(body.user_id)
        if (!p) throw new HttpError(404, 'That person does not exist.')
        return p
      }
      const wouldLoseLastAdmin = async (t: Profile) =>
        t.role === 'admin' && t.deactivated_at === null && (await store.countActiveAdmins()) <= 1
      const fromDb = (err: string) =>
        err.includes('at least one active admin')
          ? new HttpError(409, LAST_ADMIN, 'last_admin')
          : new HttpError(500, 'Could not save the change.')

      switch (body.action) {
        case 'create': {
          const name = typeof body.name === 'string' ? body.name.trim() : ''
          const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
          const jobTitle = typeof body.job_title === 'string' && body.job_title.trim() ? body.job_title.trim() : null
          if (!name || name.length > 100) throw new HttpError(400, 'Enter the name of the person.')
          if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.')
          if (!isRole(body.role)) throw new HttpError(400, 'Role must be admin, sales or engineer.')
          if (jobTitle && jobTitle.length > 100) throw new HttpError(400, 'Job title is too long.')
          const password = gen()
          const created = await store.createAuthUser(email, password)
          if ('error' in created) {
            throw created.conflict
              ? new HttpError(409, 'Someone already has that email address.', 'email_taken')
              : new HttpError(400, 'Could not create the account.')
          }
          const perr = await store.insertProfile({ id: created.id, name, role: body.role, job_title: jobTitle })
          if (perr) {
            await store.deleteAuthUser(created.id)
            throw new HttpError(500, 'Could not create the account.')
          }
          await audit(created.id, 'insert', null, { name, email, role: body.role, job_title: jobTitle })
          return reply(200, { user: { id: created.id, name, email, role: body.role, job_title: jobTitle }, password })
        }

        case 'reset_password': {
          const t = await target()
          const password = gen()
          const err = await store.setPassword(t.id, password)
          if (err) throw new HttpError(500, 'Could not reset the password.')
          // HW-17: "signed out on every device" - end every session now. With the API's pre-request check
          // (migration 0086) an access token of an ended session is refused at once, not when it expires.
          const revokeErr = await store.revokeSessions(t.id)
          await audit(t.id, 'update', null, { event: 'reset_password' })
          if (revokeErr) {
            console.error('admin-users: session revoke after reset failed', { id: t.id, revokeErr })
            throw new HttpError(500, 'The password was changed, but signing them out of their devices did not finish. Reset it again.')
          }
          return reply(200, { user_id: t.id, password })
        }

        case 'set_role': {
          const t = await target()
          if (!isRole(body.role)) throw new HttpError(400, 'Role must be admin, sales or engineer.')
          if (t.role === body.role) return reply(200, { user_id: t.id, role: t.role })
          if (body.role !== 'admin' && (await wouldLoseLastAdmin(t))) throw new HttpError(409, LAST_ADMIN, 'last_admin')
          const err = await store.updateProfile(t.id, { role: body.role })
          if (err) throw fromDb(err)
          await audit(t.id, 'update', { role: t.role }, { role: body.role })
          return reply(200, { user_id: t.id, role: body.role })
        }

        case 'set_job_title': {
          const t = await target()
          if (body.job_title !== null && typeof body.job_title !== 'string') throw new HttpError(400, 'Job title must be text, or empty to clear it.')
          const jobTitle = typeof body.job_title === 'string' && body.job_title.trim() ? body.job_title.trim() : null
          if (jobTitle && jobTitle.length > 100) throw new HttpError(400, 'Job title is too long.')
          if (t.job_title === jobTitle) return reply(200, { user_id: t.id, job_title: t.job_title })
          const err = await store.updateProfile(t.id, { job_title: jobTitle })
          if (err) throw new HttpError(500, 'Could not save the change.')
          await audit(t.id, 'update', { job_title: t.job_title }, { job_title: jobTitle })
          return reply(200, { user_id: t.id, job_title: jobTitle })
        }

        case 'deactivate': {
          const t = await target()
          if (t.deactivated_at !== null) {
            // A retry after a ban or revoke that did not finish: finish them (both are idempotent), no second audit row.
            const banErr = await store.setBan(t.id, true)
            const revokeErr = await store.revokeSessions(t.id)
            if (banErr || revokeErr) throw new HttpError(500, 'The person is locked out of the data, but the ban did not finish. Try Deactivate again.')
            return reply(200, { user_id: t.id, deactivated_at: t.deactivated_at })
          }
          if (await wouldLoseLastAdmin(t)) throw new HttpError(409, LAST_ADMIN, 'last_admin')
          // The users row first: current_user_role() turns null at once, so RLS locks the person out of
          // all data before the ban and the session revocation land.
          const at = new Date().toISOString()
          const err = await store.updateProfile(t.id, { deactivated_at: at })
          if (err) throw fromDb(err)
          const banErr = await store.setBan(t.id, true)
          const revokeErr = await store.revokeSessions(t.id)
          await audit(t.id, 'update', { deactivated_at: null }, { deactivated_at: at })
          if (banErr || revokeErr) {
            console.error('admin-users: ban or session revoke failed', { id: t.id, banErr, revokeErr })
            throw new HttpError(500, 'The person is locked out of the data, but the ban did not finish. Try Deactivate again.')
          }
          return reply(200, { user_id: t.id, deactivated_at: at })
        }

        case 'reactivate': {
          const t = await target()
          if (t.deactivated_at === null) return reply(200, { user_id: t.id, deactivated_at: null })
          // Lift the ban first; if it fails the row stays deactivated and nothing is half-open.
          const banErr = await store.setBan(t.id, false)
          if (banErr) throw new HttpError(500, 'Could not reactivate the account.')
          const err = await store.updateProfile(t.id, { deactivated_at: null })
          if (err) throw new HttpError(500, 'Could not reactivate the account.')
          await audit(t.id, 'update', { deactivated_at: t.deactivated_at }, { deactivated_at: null })
          return reply(200, { user_id: t.id, deactivated_at: null })
        }

        case 'list': {
          const [profiles, emails] = await Promise.all([store.listProfiles(), store.listEmails()])
          const users = profiles.map((p) => ({ ...p, email: emails.get(p.id) ?? null }))
          return reply(200, { users })
        }

        default:
          throw new HttpError(400, 'Unknown action.')
      }
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, e.code ? { error: e.message, code: e.code } : { error: e.message })
      console.error('admin-users: unexpected error', e instanceof Error ? e.message : 'unknown')
      return reply(500, { error: 'Something went wrong. Try again.' })
    }
  }
}
