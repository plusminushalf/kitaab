// Small color toolkit for themes: parse CSS colors, work in OKLCH, measure contrast.
// Only what the theme engine needs; no dependency.

export type Rgba = { r: number; g: number; b: number; a: number } // 0..1
export type Oklch = { l: number; c: number; h: number; a: number }

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

export function parseColor(input: unknown): Rgba | null {
  if (typeof input !== "string") return null
  const s = input.trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    let hex = m[1]
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("")
    if (hex.length !== 6 && hex.length !== 8) return null
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) : 1 }
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/)
  if (m) {
    const alpha = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1
    return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: alpha }
  }
  m = s.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/)
  if (m) {
    const l = m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1])
    const alpha = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1
    return oklchToRgb({ l, c: parseFloat(m[2]), h: parseFloat(m[3]), a: alpha })
  }
  if (s === "white") return { r: 1, g: 1, b: 1, a: 1 }
  if (s === "black") return { r: 0, g: 0, b: 0, a: 1 }
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 }
  return null
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function rgbToOklch({ r, g, b, a }: Rgba): Oklch {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.sqrt(A * A + B * B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h: c < 1e-4 ? 0 : h, a }
}

export function oklchToRgb({ l, c, h, a }: Oklch): Rgba {
  const hr = (h * Math.PI) / 180
  const A = c * Math.cos(hr), B = c * Math.sin(hr)
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return {
    r: clamp(fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)),
    g: clamp(fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)),
    b: clamp(fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)),
    a,
  }
}

export function toOklch(input: string): Oklch | null {
  const rgb = parseColor(input)
  return rgb ? rgbToOklch(rgb) : null
}

export function formatOklch({ l, c, h, a }: Oklch): string {
  const base = `oklch(${clamp(l).toFixed(4)} ${Math.max(0, c).toFixed(4)} ${h.toFixed(2)}`
  return a < 1 ? `${base} / ${(a * 100).toFixed(0)}%)` : `${base})`
}

export function toHex(input: string): string {
  const c = parseColor(input)
  return c ? rgbToHex(c) : "#000000"
}

export function rgbToHex(c: Rgba): string {
  const h = (v: number) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0")
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

/** Paints a translucent color over an opaque one. */
export function flatten(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 1) return fg
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

export function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

export function contrast(a: string | Rgba, b: string | Rgba): number {
  const x = typeof a === "string" ? parseColor(a) : a
  const y = typeof b === "string" ? parseColor(b) : b
  if (!x || !y) return 1
  const l1 = luminance(x), l2 = luminance(y)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

export function isDark(input: string): boolean {
  const c = parseColor(input)
  return c ? luminance(c) < 0.179 : false
}

/** Moves a color's lightness by dl and scales its chroma. */
export function shade(input: string | Oklch, dl: number, chroma = 1): string {
  const c = typeof input === "string" ? toOklch(input) : input
  if (!c) return typeof input === "string" ? input : "transparent"
  return formatOklch({ ...c, l: clamp(c.l + dl), c: c.c * chroma })
}

/** Mixes two colors in OKLab; t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const x = toOklch(a), y = toOklch(b)
  if (!x || !y) return a
  const ax = x.c * Math.cos((x.h * Math.PI) / 180), bx = x.c * Math.sin((x.h * Math.PI) / 180)
  const ay = y.c * Math.cos((y.h * Math.PI) / 180), by = y.c * Math.sin((y.h * Math.PI) / 180)
  const A = ax + (ay - ax) * t, B = bx + (by - bx) * t
  const c = Math.sqrt(A * A + B * B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return formatOklch({ l: x.l + (y.l - x.l) * t, c, h, a: 1 })
}

/** The first candidate that reaches the contrast ratio against bg, else black or white. */
export function readableOn(bg: string, ratio: number, ...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) if (c && contrast(c, bg) >= ratio) return c
  return isDark(bg) ? "#ffffff" : "#000000"
}
