import { app } from "electron"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { resolveBindings, SHORTCUTS, type ShortcutId, type ShortcutOverrides } from "../shared/shortcuts"

// The person's shortcut changes, kept beside settings.json. Only differences from the
// defaults are saved, so a default changed in a later version still reaches them.

const file = () => join(app.getPath("userData"), "shortcuts.json")
const known = new Set<string>(SHORTCUTS.map((s) => s.id))

export function loadShortcutOverrides(): ShortcutOverrides {
  if (!existsSync(file())) return {}
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(raw).filter(([id, v]) => known.has(id) && typeof v === "string"),
    ) as ShortcutOverrides
  } catch {
    return {}
  }
}

export function saveShortcutOverrides(next: ShortcutOverrides): ShortcutOverrides {
  const defaults = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.default]))
  const kept = Object.fromEntries(
    Object.entries(next).filter(([id, v]) => known.has(id) && typeof v === "string" && v !== defaults[id]),
  ) as ShortcutOverrides
  writeFileSync(file(), JSON.stringify(kept, null, 2))
  return kept
}

export function currentBindings(): Record<ShortcutId, string> {
  return resolveBindings(loadShortcutOverrides())
}
