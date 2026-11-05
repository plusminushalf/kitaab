// Direct URLs for files on the Hermes server (images and video in the transcript).
// Hermes accepts the session token as ?token= on /api/files/download only, and
// serves <img>/<video> requests there inline.

let access: { base: string; token: string } | null = null

export function setFileAccess(value: { base: string; token: string } | undefined) {
  access = value ?? null
}

export function fileUrl(path: string): string | undefined {
  if (!access) return undefined
  return `${access.base}/api/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(access.token)}`
}

// Images in replies: the agent writes ![alt](/home/me/out/card.png) with a path on the
// server (see RENDERING in kitab-context.ts). Those paths become download URLs; web
// URLs and data: URLs are left alone.

/** The server path behind an image src, if it names one: /abs, ~/rel or file:///abs. */
export function serverPath(src: string): string | undefined {
  let s = src.trim()
  if (/^file:\/\//i.test(s)) s = s.replace(/^file:\/\/(localhost)?/i, "")
  if (!/^(\/(?!\/)|~\/)/.test(s)) return undefined
  try {
    s = decodeURIComponent(s)
  } catch {}
  return s
}

/** A loadable URL for an image src in a reply (undefined when it isn't a server path or we're offline). */
export function serverImageUrl(src: string): string | undefined {
  const path = serverPath(src)
  return path ? fileUrl(path) : undefined
}

const IMAGE = /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?)\s*\)/g

/**
 * Rewrites markdown image targets that are server paths into download URLs, for renderers
 * that load images themselves (the iPhone's native markdown). Code blocks and code spans
 * are left as written.
 */
export function withServerImages(markdown: string): string {
  if (!access || !markdown.includes("![")) return markdown
  let fence: string | null = null
  return markdown
    .split("\n")
    .map((line) => {
      const f = /^\s*(`{3,}|~{3,})/.exec(line)
      if (f) {
        if (fence === null) fence = f[1][0]
        else if (f[1][0] === fence) fence = null
        return line
      }
      if (fence !== null || !line.includes("![")) return line
      // Odd pieces are code spans.
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) =>
          i % 2
            ? part
            : part.replace(IMAGE, (whole, alt: string, target: string, title: string) => {
                const url = serverImageUrl(target.replace(/^<|>$/g, ""))
                return url ? `![${alt}](${url}${title})` : whole
              }),
        )
        .join("")
    })
    .join("\n")
}
