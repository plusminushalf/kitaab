// Theme vocabulary. A theme family (Grove, an imported VS Code extension, …) has one
// or more variants; each variant is a full set of color tokens for light or dark.
// Token names match T3 Code's so palettes and imports carry over one to one.

import { mix, readableOn, shade, toOklch, formatOklch } from "./color"

export const TOKEN_GROUPS = [
  {
    id: "foundation",
    label: "Foundation",
    tokens: [
      ["canvas", "Background"],
      ["text", "Text"],
      ["textMuted", "Muted text"],
      ["surface", "Surface"],
      ["surfaceRaised", "Raised surface"],
      ["surfaceOverlay", "Overlay"],
      ["border", "Border"],
      ["input", "Input"],
      ["focus", "Focus ring"],
      ["accent", "Accent"],
      ["accentForeground", "Accent text"],
      ["secondary", "Subtle surface"],
      ["secondaryForeground", "Subtle text"],
      ["muted", "Muted surface"],
      ["mutedForeground", "Muted surface text"],
      ["placeholder", "Placeholder"],
      ["secondaryLabel", "Secondary label"],
      ["iconMuted", "Muted icon"],
      ["accentSurface", "Highlight surface"],
      ["accentSurfaceForeground", "Highlight text"],
    ],
  },
  {
    id: "messages",
    label: "Messages",
    tokens: [
      ["messageSurface", "Message surface"],
      ["messageForeground", "Message text"],
      ["messageAction", "Action"],
      ["messageActionForeground", "Action text"],
      ["messageActionHover", "Action hover"],
      ["codeBackground", "Code surface"],
      ["codeForeground", "Code text"],
    ],
  },
  {
    id: "sidebar",
    label: "Sidebar",
    tokens: [
      ["sidebar", "Sidebar background"],
      ["sidebarForeground", "Sidebar text"],
      ["sidebarMutedForeground", "Sidebar muted text"],
      ["sidebarControlSurface", "Sidebar controls"],
      ["sidebarRowHover", "Sidebar row hover"],
      ["sidebarRowActive", "Sidebar row active"],
      ["sidebarRowSelected", "Sidebar selection"],
      ["sidebarBorder", "Sidebar border"],
    ],
  },
  {
    id: "toolbar",
    label: "Toolbar",
    tokens: [
      ["chrome", "Window chrome"],
      ["toolbar", "Toolbar background"],
      ["toolbarForeground", "Toolbar text"],
      ["toolbarBorder", "Toolbar border"],
      ["toolbarControl", "Toolbar control"],
      ["toolbarControlForeground", "Toolbar control text"],
      ["toolbarControlHover", "Toolbar control hover"],
    ],
  },
  {
    id: "status",
    label: "Status",
    tokens: [
      ["error", "Error"],
      ["errorForeground", "Error text"],
      ["errorSurface", "Error background"],
      ["warning", "Warning"],
      ["warningForeground", "Warning text"],
      ["warningSurface", "Warning background"],
      ["update", "Update"],
      ["updateForeground", "Update text"],
      ["updateSurface", "Update background"],
    ],
  },
  {
    id: "search",
    label: "Search",
    tokens: [
      ["searchMatchBackground", "Search match"],
      ["searchMatchForeground", "Search match text"],
      ["searchMatchActiveBackground", "Current match"],
      ["searchMatchActiveForeground", "Current match text"],
    ],
  },
] as const

export type TokenName = (typeof TOKEN_GROUPS)[number]["tokens"][number][0]
export type ThemeColors = Record<TokenName, string>
export type Appearance = "light" | "dark"

export const TOKEN_NAMES = TOKEN_GROUPS.flatMap((g) => g.tokens.map(([name]) => name)) as TokenName[]

export const TOKEN_LABELS = Object.fromEntries(
  TOKEN_GROUPS.flatMap((g) => g.tokens.map(([name, label]) => [name, label])),
) as Record<TokenName, string>

/** `textMuted` → `--app-theme-text-muted`. */
export const cssVar = (name: string) => `--app-theme-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

export type ThemeVariant = {
  id: string
  name: string
  appearance: Appearance
  colors: ThemeColors
}

export type ThemeFamily = {
  id: string
  name: string
  variants: ThemeVariant[]
  /** Shipped with the app: can be duplicated, not edited or deleted. */
  builtIn?: boolean
  /** Where an imported theme came from, e.g. "open-vsx:catppuccin.catppuccin-vsc". */
  source?: string
  /** Kitaab's own default: keeps the see-through (vibrancy) sidebar. */
  native?: boolean
}

const SEARCH = {
  light: {
    searchMatchBackground: "#ffde8b",
    searchMatchForeground: "#21180a",
    searchMatchActiveBackground: "#eea52b",
    searchMatchActiveForeground: "#21180a",
  },
  dark: {
    searchMatchBackground: "#8c6c1f",
    searchMatchForeground: "#f5f5f5",
    searchMatchActiveBackground: "#eea52b",
    searchMatchActiveForeground: "#21180a",
  },
}

const n = (l: number) => `oklch(${l} 0 0)`

/** Stock shadcn neutral, as tokens. The sidebar stays transparent so macOS vibrancy shows. */
const KITAB_LIGHT: ThemeColors = {
  canvas: n(1),
  chrome: n(1),
  toolbar: n(1),
  toolbarForeground: n(0.145),
  toolbarBorder: n(0.922),
  toolbarControl: n(0.97),
  toolbarControlForeground: n(0.205),
  toolbarControlHover: n(0.94),
  surface: n(1),
  surfaceRaised: n(0.985),
  surfaceOverlay: n(1),
  text: n(0.145),
  textMuted: n(0.556),
  border: n(0.922),
  input: n(0.922),
  focus: n(0.708),
  accent: n(0.205),
  accentForeground: n(0.985),
  secondary: n(0.97),
  secondaryForeground: n(0.205),
  muted: n(0.97),
  mutedForeground: n(0.556),
  placeholder: n(0.556),
  secondaryLabel: n(0.556),
  iconMuted: n(0.556),
  error: "oklch(0.577 0.245 27.325)",
  errorForeground: "oklch(0.505 0.213 27.518)",
  errorSurface: "oklch(0.971 0.013 17.38)",
  warning: "oklch(0.769 0.188 70.08)",
  warningForeground: "oklch(0.555 0.163 48.998)",
  warningSurface: "oklch(0.987 0.022 95.277)",
  update: "oklch(0.488 0.243 264.376)",
  updateForeground: "oklch(0.488 0.243 264.376)",
  updateSurface: "oklch(0.97 0.014 254.604)",
  accentSurface: n(0.97),
  accentSurfaceForeground: n(0.205),
  messageSurface: n(0.97),
  messageForeground: n(0.145),
  messageAction: n(0.205),
  messageActionForeground: n(0.985),
  messageActionHover: n(0.3),
  codeBackground: n(0.97),
  codeForeground: n(0.145),
  ...SEARCH.light,
  sidebar: "transparent",
  sidebarForeground: n(0.145),
  sidebarMutedForeground: n(0.556),
  sidebarControlSurface: "oklch(0 0 0 / 5%)",
  sidebarRowHover: "oklch(0 0 0 / 5%)",
  sidebarRowActive: "oklch(0 0 0 / 7%)",
  sidebarRowSelected: "oklch(0 0 0 / 8%)",
  sidebarBorder: "oklch(0 0 0 / 8%)",
}

const KITAB_DARK: ThemeColors = {
  canvas: n(0.145),
  chrome: n(0.145),
  toolbar: n(0.145),
  toolbarForeground: n(0.985),
  toolbarBorder: "oklch(1 0 0 / 10%)",
  toolbarControl: n(0.205),
  toolbarControlForeground: n(0.985),
  toolbarControlHover: n(0.269),
  surface: n(0.205),
  surfaceRaised: n(0.18),
  surfaceOverlay: n(0.205),
  text: n(0.985),
  textMuted: n(0.708),
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(1 0 0 / 15%)",
  focus: n(0.556),
  accent: n(0.922),
  accentForeground: n(0.205),
  secondary: n(0.269),
  secondaryForeground: n(0.985),
  muted: n(0.269),
  mutedForeground: n(0.708),
  placeholder: n(0.708),
  secondaryLabel: n(0.708),
  iconMuted: n(0.708),
  error: "oklch(0.704 0.191 22.216)",
  errorForeground: "oklch(0.808 0.114 19.571)",
  errorSurface: "oklch(0.258 0.092 26.042)",
  warning: "oklch(0.769 0.188 70.08)",
  warningForeground: "oklch(0.828 0.189 84.429)",
  warningSurface: "oklch(0.279 0.077 45.635)",
  update: "oklch(0.623 0.214 259.815)",
  updateForeground: "oklch(0.707 0.165 254.624)",
  updateSurface: "oklch(0.282 0.091 267.935)",
  accentSurface: n(0.269),
  accentSurfaceForeground: n(0.985),
  messageSurface: n(0.269),
  messageForeground: n(0.985),
  messageAction: n(0.922),
  messageActionForeground: n(0.205),
  messageActionHover: n(0.85),
  codeBackground: n(0.205),
  codeForeground: n(0.985),
  ...SEARCH.dark,
  sidebar: "transparent",
  sidebarForeground: n(0.985),
  sidebarMutedForeground: n(0.708),
  sidebarControlSurface: "oklch(1 0 0 / 6%)",
  sidebarRowHover: "oklch(1 0 0 / 6%)",
  sidebarRowActive: "oklch(1 0 0 / 9%)",
  sidebarRowSelected: "oklch(1 0 0 / 10%)",
  sidebarBorder: "oklch(1 0 0 / 8%)",
}

export const KITAB_FAMILY: ThemeFamily = {
  id: "kitab",
  name: "Kitaab",
  builtIn: true,
  native: true,
  variants: [
    { id: "light", name: "Light", appearance: "light", colors: KITAB_LIGHT },
    { id: "dark", name: "Dark", appearance: "dark", colors: KITAB_DARK },
  ],
}

/**
 * A full palette from two colors ("two colors, rest derived"): the background sets
 * every surface and the text tint; the accent sets actions, focus and selection.
 */
export function derivePalette(appearance: Appearance, background: string, accent: string): ThemeColors {
  const bg = toOklch(background) ?? toOklch(appearance === "dark" ? "#18181b" : "#ffffff")!
  const dark = appearance === "dark"
  const s = dark ? 1 : -1 // toward contrast
  const step = (d: number, chroma = 1) => shade(bg, s * d, chroma)
  const canvas = formatOklch(bg)
  const tint = Math.min(bg.c * 1.5, 0.03)
  const text = formatOklch({ l: dark ? 0.97 : 0.22, c: tint, h: bg.h, a: 1 })
  const textMuted = formatOklch({ l: dark ? 0.72 : 0.52, c: tint, h: bg.h, a: 1 })
  const accentFg = readableOn(accent, 4.5, dark ? text : "#ffffff", dark ? "#111111" : text)
  const acc = toOklch(accent)
  const accentHover = acc ? formatOklch({ ...acc, l: acc.l + (dark ? 0.05 : -0.05) }) : accent
  const base = dark ? SEARCH.dark : SEARCH.light
  return {
    canvas,
    chrome: canvas,
    toolbar: canvas,
    toolbarForeground: text,
    toolbarBorder: step(0.07),
    toolbarControl: step(0.04),
    toolbarControlForeground: text,
    toolbarControlHover: step(0.07),
    surface: step(dark ? 0.03 : 0.01),
    surfaceRaised: step(dark ? 0.045 : 0.02),
    surfaceOverlay: dark ? step(0.06) : shade(bg, 0.03),
    text,
    textMuted,
    border: step(dark ? 0.09 : 0.08),
    input: step(dark ? 0.13 : 0.12),
    focus: accent,
    accent,
    accentForeground: accentFg,
    secondary: step(0.04),
    secondaryForeground: text,
    muted: step(0.03),
    mutedForeground: textMuted,
    placeholder: textMuted,
    secondaryLabel: textMuted,
    iconMuted: textMuted,
    error: dark ? "oklch(0.704 0.191 22.216)" : "oklch(0.577 0.245 27.325)",
    errorForeground: dark ? "oklch(0.808 0.114 19.571)" : "oklch(0.505 0.213 27.518)",
    errorSurface: mix(canvas, "oklch(0.6 0.2 25)", dark ? 0.18 : 0.08),
    warning: "oklch(0.769 0.188 70.08)",
    warningForeground: dark ? "oklch(0.828 0.189 84.429)" : "oklch(0.555 0.163 48.998)",
    warningSurface: mix(canvas, "oklch(0.77 0.17 70)", dark ? 0.16 : 0.1),
    update: accent,
    updateForeground: accent,
    updateSurface: mix(canvas, accent, dark ? 0.2 : 0.1),
    accentSurface: mix(step(0.05), accent, 0.08),
    accentSurfaceForeground: text,
    messageSurface: mix(step(0.05), accent, 0.1),
    messageForeground: text,
    messageAction: accent,
    messageActionForeground: accentFg,
    messageActionHover: accentHover,
    codeBackground: step(dark ? 0.035 : 0.025),
    codeForeground: text,
    ...base,
    sidebar: dark ? shade(bg, -0.025) : step(0.025),
    sidebarForeground: text,
    sidebarMutedForeground: textMuted,
    sidebarControlSurface: dark ? step(0.03) : step(0.05),
    sidebarRowHover: mix(dark ? step(0.04) : step(0.06), accent, 0.06),
    sidebarRowActive: mix(dark ? step(0.06) : step(0.08), accent, 0.1),
    sidebarRowSelected: mix(dark ? step(0.07) : step(0.09), accent, 0.12),
    sidebarBorder: step(dark ? 0.06 : 0.07),
  }
}

/** Fills tokens a partial palette is missing from the derived palette. */
export function completePalette(appearance: Appearance, partial: Partial<ThemeColors>): ThemeColors {
  const base = derivePalette(
    appearance,
    partial.canvas ?? (appearance === "dark" ? "#18181b" : "#ffffff"),
    partial.accent ?? partial.messageAction ?? (appearance === "dark" ? "#60a5fa" : "#2563eb"),
  )
  const out = { ...base }
  for (const name of TOKEN_NAMES) {
    const v = partial[name]
    if (typeof v === "string" && v.trim()) out[name] = v.trim()
  }
  return out
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "theme"
  )
}
