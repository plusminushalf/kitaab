import type { Attachment } from "./model"
import { fileUrl } from "./server-files"

// Hermes stores a user message with its attachments expanded inline:
//
//   @file:path/a.csv
//   what the person typed
//   @image:/home/me/.hermes/images/upload_x.png [screenshot]
//
//   --- Attached Context ---
//   📄 @file:path/a.csv (10651 tokens)
//   ```…file contents…```
//
// For display we keep only what was typed and turn ref lines at the start or
// end into attachments (the official app does the same). A ref inside a
// sentence stays where it is.

const CONTEXT_MARKER = "--- Attached Context ---"
const REF_LINE = /^@(file|image):(`[^`]+`|\S+)(?:\s+\[[^\]]*\])?$/

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/i
const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i

/** Relative refs are relative to the session's working directory, normally the home directory. */
const serverPath = (p: string) => (p.startsWith("/") || p.startsWith("~") ? p : `~/${p}`)

export function toAttachment(rawPath: string, hint?: "image" | "file"): Attachment {
  const path = serverPath(rawPath)
  const name = path.split("/").pop() || path
  const kind = hint === "image" || IMAGE.test(name) ? "image" : VIDEO.test(name) ? "video" : "file"
  return { kind, name, path, url: kind === "file" ? undefined : fileUrl(path) }
}

export function splitUserText(raw: string): { text: string; attachments: Attachment[] } {
  let text = raw
  const cut = text.indexOf(CONTEXT_MARKER)
  if (cut !== -1) text = text.slice(0, cut)
  // A label can sit on the next line: "@image:/x.png\n[screenshot]".
  text = text.replace(/(@(?:file|image):(?:`[^`]+`|\S+))[ \t]*\n[ \t]*(\[[^\]\n]*\])[ \t]*(?=\n|$)/g, "$1 $2")

  const lines = text.split("\n")
  const lead: Attachment[] = []
  const trail: Attachment[] = []
  const take = (line: string) => {
    const [, kind, ref] = line.trim().match(REF_LINE)!
    return toAttachment(ref.replace(/^`|`$/g, ""), kind === "image" ? "image" : undefined)
  }
  while (lines.length && REF_LINE.test(lines[0].trim())) lead.push(take(lines.shift()!))
  while (lines.length && (lines.at(-1)!.trim() === "" || REF_LINE.test(lines.at(-1)!.trim()))) {
    const line = lines.pop()!
    if (line.trim()) trail.unshift(take(line))
  }
  return { text: lines.join("\n").trim(), attachments: [...lead, ...trail] }
}

/**
 * A list preview without attachment refs. Hermes's previews are one line, cut at 80
 * characters, so a ref can be cut off too ("@image:/home/me/.hermes/i...").
 */
export function previewText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const text = raw
    .replace(/@(?:file|image|url|folder):(?:`[^`]*`?|\S+)(?:\s+\[[^\]]*\]?)?/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return text && text !== "..." && text !== "…" ? text : undefined
}

const IMAGE_TAG = /\[Image[  ]#(\d+)\]/g

/**
 * Splits a message around its `[Image #N]` tags (the Nth image sent with it), so the apps can
 * draw each tag as a pill: text stays a string, a tag becomes its number.
 */
export function splitImageTags(text: string): (string | number)[] {
  const out: (string | number)[] = []
  let at = 0
  for (const m of text.matchAll(IMAGE_TAG)) {
    if (m.index > at) out.push(text.slice(at, m.index))
    out.push(Number(m[1]))
    at = m.index + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}
