// A project's look, the same on every device: its initials and the hue it's tinted with.

/** "hermes-desktop" → "HD", "notes" → "NO". */
export function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)
  return letters.toUpperCase()
}

/** The hue a project is tinted with, from its name; the same everywhere it shows. */
export function hue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
