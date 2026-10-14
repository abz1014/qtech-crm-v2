export const ROLES = ['admin', 'sales', 'engineer'] as const
export type Role = (typeof ROLES)[number]

export interface Profile {
  id: string
  name: string
  role: Role
  job_title: string | null
  deactivated_at: string | null
  created_at: string
}

export interface AuditRow {
  table_name: 'users'
  record_id: string
  action: 'insert' | 'update'
  changed_by: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
}

/** Every database and Auth call the handler makes. index.ts implements it with the service-role client; tests use a fake. */
export interface Store {
  /** The id of the person a bearer token belongs to, or null when the token is not valid. */
  authenticate(token: string): Promise<string | null>
  getProfile(id: string): Promise<Profile | null>
  countActiveAdmins(): Promise<number>
  createAuthUser(email: string, password: string): Promise<{ id: string } | { error: string; conflict: boolean }>
  deleteAuthUser(id: string): Promise<void>
  insertProfile(p: { id: string; name: string; role: Role; job_title: string | null }): Promise<string | null>
  updateProfile(id: string, patch: Partial<Pick<Profile, 'role' | 'deactivated_at'>>): Promise<string | null>
  setBan(id: string, banned: boolean): Promise<string | null>
  setPassword(id: string, password: string): Promise<string | null>
  revokeSessions(id: string): Promise<string | null>
  listProfiles(): Promise<Profile[]>
  /** auth.users emails keyed by id. */
  listEmails(): Promise<Map<string, string>>
  writeAudit(row: AuditRow): Promise<string | null>
}
