import Storage from "expo-sqlite/kv-store"

/** This device's own small settings. Synchronous, backed by SQLite. */
export const kv = {
  get(key: string): string | null {
    try {
      return Storage.getItemSync(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) Storage.removeItemSync(key)
      else Storage.setItemSync(key, value)
    } catch {}
  },
  json<T>(key: string, fallback: T): T {
    try {
      const raw = kv.get(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  },
}
