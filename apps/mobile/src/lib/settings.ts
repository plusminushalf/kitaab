import { useSyncExternalStore } from "react"
import { getRandomBytes } from "expo-crypto"
import { kv } from "./kv"

/** How this iPhone reaches the Hermes host. */
export type ServerSettings = {
  host: string
  port: number
  user: string
  /** OpenSSH line of the host key, pinned the first time we connect. */
  hostKey?: string
  /** "SHA256:…" of the pinned key, for showing. */
  hostFingerprint?: string
}

const KEY = "server"
const EMPTY: ServerSettings = { host: "", port: 22, user: "" }

let current: ServerSettings = { ...EMPTY, ...kv.json<Partial<ServerSettings>>(KEY, {}) }
const listeners = new Set<() => void>()

export const serverSettings = {
  get: () => current,
  set(patch: Partial<ServerSettings>) {
    current = { ...current, ...patch }
    if (!current.hostKey) {
      delete current.hostKey
      delete current.hostFingerprint
    }
    kv.set(KEY, JSON.stringify(current))
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
  configured: () => Boolean(current.host && current.user),
}

export function useServerSettings(): ServerSettings {
  return useSyncExternalStore(serverSettings.subscribe, serverSettings.get)
}

/** Random id that names this phone's backend folder on each host (like the Mac's remote.json). */
export function ownershipId(host: string): string {
  const key = `ownership:${host}`
  let id = kv.get(key)
  if (!id || !/^[0-9a-f]{32}$/.test(id)) {
    const bytes = getRandomBytes(16)
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    kv.set(key, id)
  }
  return id
}
