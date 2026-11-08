import { app } from "electron"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Settings } from "../shared/bridge"
import { connectedHosts } from "./remote"

export type { Settings }

// No SSH host until the person picks one on the first-run screen.
const defaults: Settings = {
  baseUrl: "http://127.0.0.1:9119",
  sshHost: "",
}

const file = () => join(app.getPath("userData"), "settings.json")

export function loadSettings(): Settings {
  if (!existsSync(file())) return adoptEarlierHost() ?? { ...defaults }
  try {
    const { baseUrl, sshHost } = { ...defaults, ...JSON.parse(readFileSync(file(), "utf8")) }
    return { baseUrl, sshHost }
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(next: Settings) {
  writeFileSync(file(), JSON.stringify(next, null, 2))
}

/** False until a connection has been set up, so the app shows its first-run screen. */
export function isConfigured(): boolean {
  return existsSync(file()) || adoptEarlierHost() !== null
}

/**
 * Before the first-run screen, the SSH host was a built-in default and nothing was saved.
 * Anyone who connected that way has a token for the host in remote.json: keep them on it.
 */
function adoptEarlierHost(): Settings | null {
  const host = connectedHosts()[0]
  if (!host) return null
  const s = { ...defaults, sshHost: host }
  saveSettings(s)
  return s
}
