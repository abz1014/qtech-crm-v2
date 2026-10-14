// supabase-js builds a Realtime client eagerly and Node before 22 has no global WebSocket, which throws.
// These scripts never use Realtime, so a placeholder is enough. Import this module first.
globalThis.WebSocket ??= class WebSocketPlaceholder {}
