import type { Database } from '@/types/database'

/** Row types straight from the generated schema, so a hook never restates a column list by hand. */
export type TableRow<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TableInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TableUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
export type ViewRow<V extends keyof Database['public']['Views']> = Database['public']['Views'][V]['Row']
