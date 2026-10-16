// supabase-js builds a Realtime client eagerly, and Node before 22 has no global WebSocket, which throws.
// The import never subscribes to anything, so a placeholder is enough (same as scripts/ws-shim.mjs). Import this module first.
;(globalThis as { WebSocket?: unknown }).WebSocket ??= class WebSocketPlaceholder {}
export {}
