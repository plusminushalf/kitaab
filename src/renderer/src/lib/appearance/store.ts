// Appearance settings and installed themes: kept in localStorage, applied to <html>
// as CSS variables. globals.css maps those variables onto the shadcn tokens.

import { useSyncExternalStore } from "react"
import { PORTED_FAMILIES } from "./ported-themes"
import { cssVar, KITAB_FAMILY, type Appearance, type ThemeFamily, type ThemeVariant } from "./tokens"

export type ColorScheme = "system" | "light" | "dark"
export type ChatWidth = "comfortable" | "wide" | "full"

export const THREAD_DETAIL_ITEMS = [
  ["machine", "Machine"],
  ["project", "Project"],
  ["model", "Model"],
  ["personalities", "Personalities"],
  ["routine", "Routine"],
  ["messages", "Messages"],
  ["created", "Started"],
  ["updated", "Last activity"],
  ["id", "Thread ID"],
] as const
export type ThreadDetailItem = (typeof THREAD_DETAIL_ITEMS)[number][0]

export type AppearanceSettings = {
  scheme: ColorScheme
  themeId: string
  /** Which variant of a family to use in light and in dark mode. */
  variantFor: Record<string, { light?: string; dark?: string }>
  /** 0–200; 100 is the theme as designed. */
  contrast: number
  /** 0–100; how solid menus, dialogs, the composer and a themed sidebar are. */
  glassOpacity: number
  fontSizeInterface: number
  fontSizePrompt: number
  fontSizeCode: number
  fontFamilySans: string
  fontFamilyComposer: string
  fontFamilyCode: string
  fontSmoothing: boolean
  panelAnimationMs: number
  chatWidth: ChatWidth
  wordWrap: boolean
  threadDetails: Record<ThreadDetailItem, boolean>
}

export const DEFAULTS: AppearanceSettings = {
  scheme: "system",
  themeId: "kitab",
  variantFor: {},
  contrast: 100,
  glassOpacity: 85,
  fontSizeInterface: 16,
  fontSizePrompt: 15,
  fontSizeCode: 13,
  fontFamilySans: "",
  fontFamilyComposer: "",
  fontFamilyCode: "",
  fontSmoothing: true,
  panelAnimationMs: 200,
  chatWidth: "comfortable",
  wordWrap: true,
  threadDetails: {
    machine: true,
    project: true,
    model: true,
    personalities: true,
    routine: true,
    messages: true,
    created: true,
    updated: false,
    id: false,
  },
}

const SETTINGS_KEY = "kitab.appearance"
const THEMES_KEY = "kitab.themes"

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

type State = {
  settings: AppearanceSettings
  custom: ThemeFamily[]
  /** Live palette while the theme editor is open; not saved. */
  preview: { appearance: Appearance; colors: ThemeVariant["colors"] } | null
  systemDark: boolean
  /** The theme editor, while open. It floats over the app so changes preview live. */
  editing: { family: ThemeFamily | null; isNew: boolean } | null
}

const stored = read<Partial<AppearanceSettings>>(SETTINGS_KEY, {})
let state: State = {
  settings: { ...DEFAULTS, ...stored, threadDetails: { ...DEFAULTS.threadDetails, ...stored.threadDetails } },
  custom: read<ThemeFamily[]>(THEMES_KEY, []),
  preview: null,
  editing: null,
  systemDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
}
const listeners = new Set<() => void>()

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  apply()
  listeners.forEach((l) => l())
}

export const BUILT_IN: ThemeFamily[] = [KITAB_FAMILY, ...PORTED_FAMILIES]

export const appearance = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
  update(patch: Partial<AppearanceSettings>) {
    const settings = { ...state.settings, ...patch }
    write(SETTINGS_KEY, settings)
    set({ settings })
  },
  reset(keys: (keyof AppearanceSettings)[]) {
    appearance.update(Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]])) as Partial<AppearanceSettings>)
  },
  families: (): ThemeFamily[] => [...BUILT_IN, ...state.custom],
  family: (id: string) => appearance.families().find((f) => f.id === id),
  /** Activates a family; with a variant, also makes it the family's pick for that mode. */
  useTheme(familyId: string, variant?: ThemeVariant) {
    const variantFor = { ...state.settings.variantFor }
    if (variant) variantFor[familyId] = { ...variantFor[familyId], [variant.appearance]: variant.id }
    // Picking a variant whose mode differs from the fixed scheme switches the scheme with it.
    const scheme =
      variant && state.settings.scheme !== "system" && state.settings.scheme !== variant.appearance
        ? variant.appearance
        : state.settings.scheme
    appearance.update({ themeId: familyId, variantFor, scheme })
  },
  saveCustom(family: ThemeFamily) {
    const custom = state.custom.some((f) => f.id === family.id)
      ? state.custom.map((f) => (f.id === family.id ? family : f))
      : [...state.custom, family]
    write(THEMES_KEY, custom)
    set({ custom })
  },
  removeCustom(id: string) {
    const custom = state.custom.filter((f) => f.id !== id)
    write(THEMES_KEY, custom)
    set({ custom })
    if (state.settings.themeId === id) appearance.update({ themeId: "kitab" })
  },
  openEditor(editing: NonNullable<State["editing"]>) {
    set({ editing })
  },
  closeEditor() {
    set({ editing: null, preview: null })
  },
  setPreview(preview: State["preview"]) {
    set({ preview })
  },
}

export function useAppearance<T>(select: (s: State) => T): T {
  return useSyncExternalStore(appearance.subscribe, () => select(state))
}

/** The variant a family shows in the given mode, falling back to any variant it has. */
export function variantFor(family: ThemeFamily, mode: Appearance, picks = state.settings.variantFor): ThemeVariant {
  const pickedId = picks[family.id]?.[mode]
  return (
    family.variants.find((v) => v.id === pickedId && v.appearance === mode) ??
    family.variants.find((v) => v.appearance === mode) ??
    family.variants[0]
  )
}

export function resolved(): { family: ThemeFamily; variant: ThemeVariant; appearance: Appearance } {
  const { settings, systemDark } = state
  const desired: Appearance = settings.scheme === "system" ? (systemDark ? "dark" : "light") : settings.scheme
  const family = appearance.family(settings.themeId) ?? KITAB_FAMILY
  const variant = variantFor(family, desired)
  return { family, variant, appearance: variant.appearance }
}

let lastScheme: string | null = null

function apply() {
  const root = document.documentElement
  const { settings, preview } = state
  const r = resolved()
  const mode = preview?.appearance ?? r.appearance
  const colors = preview?.colors ?? r.variant.colors

  root.classList.toggle("dark", mode === "dark")
  root.classList.toggle("light", mode === "light")
  root.style.colorScheme = mode
  root.dataset.themeId = preview ? "__preview" : r.family.id
  root.dataset.native = !preview && r.family.native ? "true" : "false"
  for (const [name, value] of Object.entries(colors)) root.style.setProperty(cssVar(name), value)

  // Contrast pushes borders and secondary text toward the text color (or away from it).
  const c = settings.contrast
  root.style.setProperty("--contrast-target", c >= 100 ? "var(--app-theme-text)" : "var(--app-theme-canvas)")
  root.style.setProperty("--contrast-amount", `${c >= 100 ? ((c - 100) / 100) * 40 : ((100 - c) / 100) * 45}%`)
  root.style.setProperty("--glass", `${settings.glassOpacity}%`)
  // Fully opaque glass has nothing to frost, so the blur goes too (as in T3 Code).
  if (settings.glassOpacity >= 100) root.style.setProperty("--glass-blur", "0px")
  else root.style.removeProperty("--glass-blur")
  root.style.setProperty("--font-size-interface", `${settings.fontSizeInterface}px`)
  root.style.setProperty("--font-size-prompt", `${settings.fontSizePrompt}px`)
  root.style.setProperty("--font-size-code", `${settings.fontSizeCode}px`)
  const family = (name: string) => (name ? `"${name.replace(/"/g, "")}", ` : "")
  root.style.setProperty("--font-user-sans", family(settings.fontFamilySans))
  root.style.setProperty("--font-user-composer", family(settings.fontFamilyComposer))
  root.style.setProperty("--font-user-code", family(settings.fontFamilyCode))
  root.style.setProperty("--panel-duration", `${settings.panelAnimationMs}ms`)
  root.style.setProperty(
    "--chat-width",
    settings.chatWidth === "full" ? "100%" : settings.chatWidth === "wide" ? "64rem" : "48rem",
  )
  root.dataset.fontSmoothing = settings.fontSmoothing ? "on" : "off"
  root.dataset.wordWrap = settings.wordWrap ? "on" : "off"

  // The window's vibrancy and traffic lights follow the scheme the app shows.
  const scheme = settings.scheme === "system" ? "system" : mode
  if (scheme !== lastScheme) {
    lastScheme = scheme
    window.hermes?.appearance?.setScheme(scheme as ColorScheme)
  }
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => set({ systemDark: e.matches }))

apply()
