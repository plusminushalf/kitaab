// Every keyboard shortcut Kitaab has, for the menu bar (main process) and the
// Settings → Shortcuts page (renderer). Bindings are Electron accelerators
// ("Cmd+Shift+S"); a person's changes are saved as overrides of these defaults.

export type ShortcutGroup = "General" | "Threads" | "Find" | "Navigation" | "Composer"

export type ShortcutId =
  | "settings"
  | "command-palette"
  | "new-thread"
  | "mark-done"
  | "toggle-sidebar"
  | "find"
  | "find-next"
  | "find-previous"
  | "back"
  | "forward"
  | "go-threads"
  | "go-routines"
  | "go-personalities"
  | "go-profile"

export type Shortcut = {
  id: ShortcutId
  label: string
  group: ShortcutGroup
  /** The binding it ships with. */
  default: string
}

export const SHORTCUTS: Shortcut[] = [
  { id: "command-palette", label: "Open commands", group: "General", default: "Cmd+K" },
  { id: "settings", label: "Open settings", group: "General", default: "Cmd+," },
  { id: "toggle-sidebar", label: "Show or hide the sidebar", group: "General", default: "Cmd+B" },
  { id: "new-thread", label: "New thread", group: "Threads", default: "Cmd+N" },
  { id: "mark-done", label: "Mark thread as done", group: "Threads", default: "Cmd+Shift+S" },
  { id: "find", label: "Find in thread", group: "Find", default: "Cmd+F" },
  { id: "find-next", label: "Next match", group: "Find", default: "Cmd+G" },
  { id: "find-previous", label: "Previous match", group: "Find", default: "Cmd+Shift+G" },
  { id: "back", label: "Back", group: "Navigation", default: "Cmd+[" },
  { id: "forward", label: "Forward", group: "Navigation", default: "Cmd+]" },
  { id: "go-threads", label: "Go to threads", group: "Navigation", default: "Cmd+Alt+1" },
  { id: "go-routines", label: "Go to routines", group: "Navigation", default: "Cmd+Alt+2" },
  { id: "go-personalities", label: "Go to personalities", group: "Navigation", default: "Cmd+Alt+3" },
  { id: "go-profile", label: "Go to profile settings", group: "Navigation", default: "Cmd+Alt+4" },
]

/** Shortcuts that can't be changed, listed so the page shows everything. */
export const FIXED_SHORTCUTS: { label: string; group: ShortcutGroup; keys: string[] }[] = [
  { label: "Switch to profile 1–9", group: "Navigation", keys: ["⌘1", "…", "⌘9"] },
  { label: "Next thread / previous thread", group: "Navigation", keys: ["⌃⇥", "⌃⇧⇥"] },
  { label: "Undo “mark as done”", group: "Threads", keys: ["⌘Z"] },
  { label: "Send, or the busy action set in Threads", group: "Composer", keys: ["↵"] },
  { label: "The other busy action (queue or interrupt)", group: "Composer", keys: ["⌘↵"] },
  { label: "New line", group: "Composer", keys: ["⇧↵"] },
  { label: "Close a panel, menu or dialog", group: "General", keys: ["⎋"] },
]

/** Bindings that belong to macOS or the Edit/Window menus, or to ⌘1–⌘9. */
export const RESERVED = new Set([
  "Cmd+Q", "Cmd+W", "Cmd+H", "Cmd+Alt+H", "Cmd+M",
  "Cmd+C", "Cmd+V", "Cmd+X", "Cmd+A", "Cmd+Z", "Cmd+Shift+Z", "Cmd+Alt+Shift+V",
  "Cmd+0", "Cmd+=", "Cmd+Plus", "Cmd+-", "Ctrl+Cmd+F", "Ctrl+Tab", "Ctrl+Shift+Tab",
  "Cmd+1", "Cmd+2", "Cmd+3", "Cmd+4", "Cmd+5", "Cmd+6", "Cmd+7", "Cmd+8", "Cmd+9",
])

/** A person's changes: a new binding, or "" for none. */
export type ShortcutOverrides = Partial<Record<ShortcutId, string>>

export function resolveBindings(overrides: ShortcutOverrides): Record<ShortcutId, string> {
  return Object.fromEntries(SHORTCUTS.map((s) => [s.id, overrides[s.id] ?? s.default])) as Record<ShortcutId, string>
}

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Cmd"] as const
const MODIFIER_SYMBOL: Record<(typeof MODIFIER_ORDER)[number], string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘" }
const KEY_SYMBOL: Record<string, string> = {
  Enter: "↵", Return: "↵", Tab: "⇥", Space: "Space", Backspace: "⌫", Delete: "⌦", Escape: "⎋",
  Up: "↑", Down: "↓", Left: "←", Right: "→", Plus: "+",
}

/** "Cmd+Shift+S" → ["⇧", "⌘", "S"], in the order macOS writes them. */
export function acceleratorKeys(accelerator: string): string[] {
  if (!accelerator) return []
  const parts = accelerator.split("+")
  // "Cmd+Plus" is how "+" is written; a trailing "" means the key was "+".
  const key = parts.at(-1) || "+"
  const mods = new Set(parts.slice(0, -1))
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)).map((m) => MODIFIER_SYMBOL[m]), KEY_SYMBOL[key] ?? key]
}

/** "Cmd+Shift+S" → "⇧⌘S", for tooltips and hints. */
export function acceleratorLabel(accelerator: string): string {
  return acceleratorKeys(accelerator).join("")
}

/**
 * The accelerator a key press makes, or null while only modifiers are down. Uses the
 * physical key (`code`), so ⌥ and ⇧ don't turn "2" into "™" or "@".
 */
export function acceleratorFromEvent(e: {
  code: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | null {
  const key = keyFromCode(e.code, e.key)
  if (!key) return null
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Cmd"].filter(Boolean)
  return [...mods, key].join("+")
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
  Semicolon: ";", Quote: "'", Backquote: "`", Minus: "-", Equal: "=", Space: "Space",
  Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Escape: "Escape",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
}

function keyFromCode(code: string, key: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (CODE_KEYS[code]) return CODE_KEYS[code]
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn"].includes(key)) return null
  return null
}

/** Why a binding can't be used, or null when it can. */
export function bindingProblem(
  accelerator: string,
  id: ShortcutId,
  bindings: Record<ShortcutId, string>,
): string | null {
  const parts = accelerator.split("+")
  const key = parts.at(-1)!
  const hasModifier = parts.length > 1 && parts.slice(0, -1).some((m) => m !== "Shift")
  const functionKey = /^F\d+$/.test(key)
  if (!hasModifier && !functionKey) return "Add ⌘, ⌃ or ⌥, so typing doesn't trigger it"
  if (RESERVED.has(accelerator)) return `${acceleratorLabel(accelerator)} belongs to macOS or another menu`
  const taken = SHORTCUTS.find((s) => s.id !== id && bindings[s.id] === accelerator)
  if (taken) return `${acceleratorLabel(accelerator)} is already “${taken.label}”`
  return null
}
