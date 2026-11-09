import { useColorScheme } from "react-native"
import { hue } from "@kitab/core/project-color"

// A project's colors, as the Mac draws them (oklch in its CSS). React Native has no oklch,
// so they're converted to sRGB here.

/** oklch(l c h / alpha) as an rgba() string, or as opaque rgb() laid over `over` (r, g, b). */
export function oklch(l: number, c: number, h: number, alpha = 1, over?: [number, number, number]): string {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  const [r, g, bl] = linear.map((x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
    return Math.min(1, Math.max(0, v)) * 255
  })
  if (over) {
    const mix = (x: number, i: number) => Math.round(x * alpha + over[i] * (1 - alpha))
    return `rgb(${mix(r, 0)},${mix(g, 1)},${mix(bl, 2)})`
  }
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(bl)},${alpha})`
}

export type ProjectTint = {
  /** Initials badge and routine tag. */
  badge: string
  badgeText: string
  /** An open folder: its card (opaque, so swiping a row in it shows nothing through) and hairline edge. */
  card: string
  cardBorder: string
  /** The folder icon, its name and its chevron. */
  icon: string
  name: string
  chevron: string
  /** A row inside the open folder while pressed (opaque too). */
  pressed: string
}

/** The colors a project is drawn in, from its name, in the current color scheme. */
export function useProjectTint(name: string): ProjectTint {
  const dark = useColorScheme() === "dark"
  return projectTint(name, dark)
}

const cache = new Map<string, ProjectTint>()

export function projectTint(name: string, dark: boolean): ProjectTint {
  const key = `${dark ? 1 : 0}${name}`
  const hit = cache.get(key)
  if (hit) return hit
  const h = hue(name)
  // The canvas the folder sits on (theme.ts), for the opaque fills.
  const canvas: [number, number, number] = dark ? [10, 10, 10] : [255, 255, 255]
  const tint: ProjectTint = dark
    ? {
        badge: oklch(0.62, 0.17, h, 0.22),
        badgeText: oklch(0.74, 0.15, h),
        card: oklch(0.5, 0.11, h, 0.24, canvas),
        cardBorder: oklch(0.72, 0.12, h, 0.18),
        icon: oklch(0.76, 0.14, h),
        name: oklch(0.82, 0.1, h),
        chevron: oklch(0.76, 0.1, h, 0.8),
        pressed: oklch(0.62, 0.17, h, 0.16 + 0.24, canvas),
      }
    : {
        badge: oklch(0.62, 0.17, h, 0.16),
        badgeText: oklch(0.5, 0.17, h),
        card: oklch(0.62, 0.17, h, 0.1, canvas),
        cardBorder: oklch(0.62, 0.17, h, 0.2),
        icon: oklch(0.55, 0.17, h),
        name: oklch(0.38, 0.1, h),
        chevron: oklch(0.55, 0.12, h, 0.8),
        pressed: oklch(0.62, 0.17, h, 0.1 + 0.12, canvas),
      }
  cache.set(key, tint)
  return tint
}
