// Theme files in and out: Kitaab theme files, T3 Code theme files and VS Code color themes.

import { parseJsonc } from "../../../../shared/jsonc"
import { contrast, flatten, isDark, parseColor, readableOn, rgbToHex, type Rgba } from "./color"
import { completePalette, derivePalette, slug, TOKEN_NAMES, type Appearance, type ThemeColors, type ThemeFamily, type ThemeVariant } from "./tokens"

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

export function isVsCodeTheme(v: unknown): boolean {
  return (
    isObject(v) &&
    ((isObject(v.colors) && Object.keys(v.colors).some((k) => k.includes("."))) || Array.isArray(v.tokenColors))
  )
}

function prettyName(raw: string): string {
  const t = raw.trim()
  if (/\s/.test(t) || !/[-_.]/.test(t)) return t
  return t
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ")
}

/** Builds a Kitaab variant from a VS Code color theme (same idea as T3 Code's importer). */
export function variantFromVsCode(theme: Record<string, unknown>, fallbackName = "VS Code theme", uiTheme?: string): ThemeVariant {
  const colors = (isObject(theme.colors) ? theme.colors : {}) as Record<string, unknown>
  const pick = (...keys: string[]): Rgba | null => {
    for (const k of keys) {
      const c = parseColor(colors[k])
      if (c) return c
    }
    return null
  }
  const bgRgb = pick("editor.background", "editorPane.background")
  if (!bgRgb) throw new Error(`That VS Code theme has no "editor.background" color, so there is nothing to build a palette from.`)
  const bg: Rgba = { ...bgRgb, a: 1 }
  const hex = (c: Rgba | null, over: Rgba = bg) => (c ? rgbToHex(flatten(c, over)) : null)
  const on = (over: Rgba, ...keys: string[]) => hex(pick(...keys), over)
  const at = (...keys: string[]) => on(bg, ...keys)

  const type = (typeof theme.type === "string" ? theme.type : uiTheme ?? "").toLowerCase()
  const canvas = rgbToHex(bg)
  const appearance: Appearance =
    type === "light" || type === "hc-light" || type === "vs"
      ? "light"
      : type === "dark" || type === "hc-black" || type === "vs-dark"
        ? "dark"
        : isDark(canvas)
          ? "dark"
          : "light"

  const distinct = (a: string, b: string) => contrast(a, b) >= 1.1
  const widget = at("editorWidget.background", "dropdown.background")
  let accent: string | null = null
  for (const k of ["focusBorder", "button.background", "textLink.foreground", "activityBarBadge.background", "progressBar.background", "badge.background"]) {
    const c = at(k)
    if (c && distinct(c, canvas) && (!widget || distinct(c, widget))) {
      accent = c
      break
    }
  }
  accent ??= appearance === "dark" ? "#60a5fa" : "#2563eb"

  const base = derivePalette(appearance, canvas, accent)
  const readable = (over: string, fallback: string, ...keys: string[]) => {
    const o = parseColor(over) ?? bg
    return readableOn(over, 4.5, on(o, ...keys), fallback)
  }
  const sidebar = at("sideBar.background", "activityBar.background") ?? base.sidebar
  const sidebarRgb = parseColor(sidebar) ?? bg
  const button = at("button.background")
  const action = button && distinct(button, canvas) ? button : accent
  const raised = widget ?? base.surfaceRaised

  let input = base.input
  for (const k of ["input.background", "input.border"]) {
    const c = at(k)
    if (c && distinct(c, canvas)) {
      input = c
      break
    }
  }

  const findHighlight = at("editor.findMatchHighlightBackground") ?? base.searchMatchBackground
  const findActive = at("editor.findMatchBackground") ?? base.searchMatchActiveBackground

  const out: ThemeColors = {
    ...base,
    canvas,
    chrome: canvas,
    toolbar: at("titleBar.activeBackground", "editorGroupHeader.tabsBackground") ?? canvas,
    text: readable(canvas, base.text, "editor.foreground", "foreground"),
    textMuted: readable(canvas, base.textMuted, "descriptionForeground", "disabledForeground"),
    surface: widget ?? base.surface,
    surfaceRaised: raised,
    surfaceOverlay: at("menu.background", "quickInput.background", "dropdown.background") ?? base.surfaceOverlay,
    border: at("panel.border", "editorGroup.border", "contrastBorder") ?? base.border,
    input,
    placeholder: readable(raised, base.placeholder, "input.placeholderForeground"),
    error: at("editorError.foreground", "errorForeground") ?? base.error,
    warning: at("editorWarning.foreground") ?? base.warning,
    accentSurface: at("list.activeSelectionBackground", "list.hoverBackground") ?? base.accentSurface,
    codeBackground: at("textCodeBlock.background") ?? base.codeBackground,
    searchMatchBackground: findHighlight,
    searchMatchForeground: readable(findHighlight, base.searchMatchForeground, "editor.findMatchHighlightForeground", "editor.foreground"),
    searchMatchActiveBackground: findActive,
    searchMatchActiveForeground: readable(findActive, base.searchMatchActiveForeground, "editor.findMatchForeground", "editor.foreground"),
    sidebar,
    sidebarForeground: readable(sidebar, base.sidebarForeground, "sideBar.foreground"),
    sidebarBorder: on(sidebarRgb, "sideBar.border") ?? base.sidebarBorder,
    sidebarRowHover: on(sidebarRgb, "list.hoverBackground") ?? base.sidebarRowHover,
    sidebarRowActive: on(sidebarRgb, "list.inactiveSelectionBackground", "list.hoverBackground") ?? base.sidebarRowActive,
    sidebarRowSelected: on(sidebarRgb, "list.activeSelectionBackground") ?? base.sidebarRowSelected,
    accent,
    focus: accent,
    messageAction: action,
    messageActionForeground: readable(action, base.messageActionForeground, "button.foreground"),
    accentForeground: readable(accent, base.accentForeground, "button.foreground"),
  }
  out.toolbarForeground = readableOn(out.toolbar, 4.5, out.text)
  out.toolbarControlForeground = out.toolbarForeground
  out.messageForeground = readableOn(out.messageSurface, 4.5, out.text)
  out.codeForeground = readableOn(out.codeBackground, 4.5, out.text)
  out.sidebarMutedForeground = readableOn(out.sidebar, 3, out.textMuted, out.sidebarForeground)

  const rawName = [theme.displayName, theme.name].find((v) => typeof v === "string" && v.trim()) as string | undefined
  const name = prettyName(rawName ?? fallbackName).slice(0, 48)
  return { id: slug(name), name, appearance, colors: out }
}

/**
 * Groups variants into one family. Mirrors how T3 Code shows "Catppuccin" with
 * Latte, Mocha +2: one card, each flavour pickable for light or dark mode.
 */
export function familyFromVariants(name: string, variants: ThemeVariant[], source?: string): ThemeFamily {
  // Drop the words every variant shares: "Catppuccin Mocha", "Catppuccin Latte" → "Mocha", "Latte".
  const words = variants.map((v) => v.name.split(/\s+/))
  let shared = 0
  if (variants.length > 1)
    while (words.every((w) => w.length > shared + 1 && w[shared].toLowerCase() === words[0][shared].toLowerCase())) shared++
  const seen = new Set<string>()
  const unique = variants.map((v, i) => {
    const short = words[i].slice(shared).join(" ").replace(/^[-:–]\s*/, "") || v.name
    let id = slug(short)
    for (let n = 2; seen.has(id); n++) id = `${slug(short)}-${n}`
    seen.add(id)
    return { ...v, id, name: short }
  })
  return { id: `${slug(name)}-${Math.random().toString(36).slice(2, 7)}`, name, variants: unique, source }
}

/** Accepts a Kitaab theme file, a T3 Code theme file or a VS Code color theme. */
export function parseThemeFile(text: string, fileName?: string): ThemeFamily {
  let data: unknown
  try {
    data = parseJsonc(text)
  } catch {
    throw new Error("That theme file is not valid JSON.")
  }
  if (!isObject(data)) throw new Error("Theme files must contain a JSON object.")

  if (isVsCodeTheme(data)) {
    const v = variantFromVsCode(data, fileName?.replace(/\.[^.]+$/, "") ?? "VS Code theme")
    return familyFromVariants(v.name, [{ ...v, name: v.appearance === "dark" ? "Dark" : "Light" }])
  }

  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, 48) : "Imported theme"

  // Kitaab: { kitabTheme: 1, name, variants: [{ name, appearance, colors }] }
  if (Array.isArray(data.variants)) {
    const variants = data.variants.filter(isObject).map((v, i): ThemeVariant => {
      const appearance: Appearance = v.appearance === "dark" ? "dark" : "light"
      return {
        id: typeof v.id === "string" ? v.id : `v${i}`,
        name: typeof v.name === "string" ? v.name : appearance === "dark" ? "Dark" : "Light",
        appearance,
        colors: completePalette(appearance, pickTokens(v.colors)),
      }
    })
    if (!variants.length) throw new Error("That theme file has no variants.")
    return { id: `${slug(name)}-${Math.random().toString(36).slice(2, 7)}`, name, variants }
  }

  // T3 Code: { version: 1, name, appearance, colors, variants?: { dark: {...} } }
  if (isObject(data.colors)) {
    const appearance: Appearance = data.appearance === "dark" ? "dark" : "light"
    const variants: ThemeVariant[] = [
      { id: appearance, name: appearance === "dark" ? "Dark" : "Light", appearance, colors: completePalette(appearance, pickTokens(data.colors)) },
    ]
    const other = isObject(data.variants) ? data.variants : {}
    for (const mode of ["light", "dark"] as const) {
      if (mode !== appearance && isObject(other[mode]))
        variants.push({ id: mode, name: mode === "dark" ? "Dark" : "Light", appearance: mode, colors: completePalette(mode, pickTokens(other[mode])) })
    }
    return { id: `${slug(name)}-${Math.random().toString(36).slice(2, 7)}`, name, variants }
  }

  throw new Error("That file isn't a theme Kitaab understands. Use a Kitaab, T3 Code or VS Code theme file.")
}

function pickTokens(v: unknown): Partial<ThemeColors> {
  if (!isObject(v)) return {}
  const out: Partial<ThemeColors> = {}
  for (const k of TOKEN_NAMES) if (typeof v[k] === "string") out[k] = v[k] as string
  return out
}

export function exportThemeFile(family: ThemeFamily): string {
  return JSON.stringify(
    {
      kitabTheme: 1,
      name: family.name,
      variants: family.variants.map((v) => ({ id: v.id, name: v.name, appearance: v.appearance, colors: v.colors })),
    },
    null,
    2,
  )
}
