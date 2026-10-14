import { createClient } from 'npm:@supabase/supabase-js@2'
import { createHandler } from './handler.ts'
import { parseOrigins } from './lib.ts'
import type { AuditRow, Profile, Store } from './types.ts'

// Service-role client: server-side only. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { autoRefreshToken: false, persistSession: false },
})

const COLS = 'id, name, role, job_title, deactivated_at, created_at'
// About 100 years; 'none' lifts the ban.
const BAN = '876000h'

const store: Store = {
  async authenticate(token) {
    const { data, error } = await admin.auth.getUser(token)
    return error || !data.user ? null : data.user.id
  },
  async getProfile(id) {
    const { data } = await admin.from('users').select(COLS).eq('id', id).maybeSingle()
    return (data as Profile | null) ?? null
  },
  async countActiveAdmins() {
    const { count } = await admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .is('deactivated_at', null)
    return count ?? 0
  },
  async createAuthUser(email, password) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) {
      const conflict = error?.status === 422 || /already|registered|exists/i.test(error?.message ?? '')
      return { error: error?.message ?? 'create failed', conflict }
    }
    return { id: data.user.id }
  },
  async deleteAuthUser(id) {
    await admin.auth.admin.deleteUser(id)
  },
  async insertProfile(p) {
    const { error } = await admin.from('users').insert(p)
    return error ? error.message : null
  },
  async updateProfile(id, patch) {
    const { error } = await admin.from('users').update(patch).eq('id', id)
    return error ? error.message : null
  },
  async setBan(id, banned) {
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: banned ? BAN : 'none' })
    return error ? error.message : null
  },
  async setPassword(id, password) {
    const { error } = await admin.auth.admin.updateUserById(id, { password })
    return error ? error.message : null
  },
  async revokeSessions(id) {
    const { error } = await admin.rpc('revoke_user_sessions', { p_user_id: id })
    return error ? error.message : null
  },
  async listProfiles() {
    const { data, error } = await admin.from('users').select(COLS).order('created_at')
    if (error) throw new Error(error.message)
    return data as Profile[]
  },
  async listEmails() {
    const emails = new Map<string, string>()
    for (let page = 1; page < 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw new Error(error.message)
      for (const u of data.users) if (u.email) emails.set(u.id, u.email)
      if (data.users.length < 200) break
    }
    return emails
  },
  async writeAudit(row: AuditRow) {
    const { error } = await admin.from('audit_log').insert(row)
    return error ? error.message : null
  },
}

Deno.serve(createHandler({ store, allowedOrigins: parseOrigins(Deno.env.get('ALLOWED_ORIGINS')) }))
