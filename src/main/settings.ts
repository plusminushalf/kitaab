import { app } from "electron"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Settings } from "../shared/bridge"

export type { Settings }

const defaults: Settings = {
  baseUrl: "http://127.0.0.1:9119",
  sshHost: "dev",
}

const file = () => join(app.getPath("userData"), "settings.json")

export function loadSettings(): Settings {
  if (!existsSync(file())) return { ...defaults }
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
