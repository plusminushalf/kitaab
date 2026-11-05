import { useMemo } from "react"
import { Linking } from "react-native"
import { EnrichedMarkdownText } from "react-native-enriched-markdown"
import { mono, useColors } from "@/lib/theme"
import { isKitabLink } from "@kitab/core/links"
import { openKitabLink } from "@/lib/links"

const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * The native renderer only draws tables at the top level; one indented under a list
 * item comes out as run-together text. Lift such tables out to the top level.
 */
export function liftNestedTables(text: string): string {
  if (!text.includes("|")) return text
  const lines = text.split("\n")
  const out: string[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f) fence = fence === null ? f[1][0] : line.trim().startsWith(fence) ? null : fence
    if (fence !== null || !/^\s+\|/.test(line)) {
      out.push(line)
      continue
    }
    let j = i
    while (j < lines.length && /^\s+\|/.test(lines[j])) j++
    const block = lines.slice(i, j)
    if (block.length >= 2 && DELIMITER_ROW.test(block[1])) {
      if (out.length && out[out.length - 1].trim()) out.push("")
      out.push(...block.map((l) => l.trimStart()))
      if (j < lines.length && lines[j].trim()) out.push("")
    } else out.push(...block)
    i = j - 1
  }
  return out.join("\n")
}

/** Native markdown (GFM), styled like the Mac's prose. */
export function Markdown({ text, size = 16 }: { text: string; size?: number }) {
  const c = useColors()
  const markdown = useMemo(() => liftNestedTables(text), [text])
  return (
    <EnrichedMarkdownText
      flavor="github"
      markdown={markdown}
      onLinkPress={({ url }) => void (isKitabLink(url) ? openKitabLink(url) : Linking.openURL(url))}
      enableTaskListItemToggle={false}
      markdownStyle={{
        paragraph: { fontSize: size, lineHeight: size * 1.45, color: c.text, marginBottom: 10 },
        h1: { fontSize: size * 1.45, fontWeight: "700", color: c.text, marginTop: 8, marginBottom: 8 },
        h2: { fontSize: size * 1.25, fontWeight: "700", color: c.text, marginTop: 8, marginBottom: 6 },
        h3: { fontSize: size * 1.1, fontWeight: "600", color: c.text, marginTop: 6, marginBottom: 4 },
        list: { fontSize: size, lineHeight: size * 1.45, color: c.text, bulletColor: c.textMuted, markerColor: c.textMuted, marginBottom: 10 },
        h4: { fontSize: size, fontWeight: "600", color: c.text, marginTop: 6, marginBottom: 4 },
        h5: { fontSize: size * 0.95, fontWeight: "600", color: c.text, marginTop: 4, marginBottom: 4 },
        h6: { fontSize: size * 0.9, fontWeight: "600", color: c.textMuted, marginTop: 4, marginBottom: 4 },
        blockquote: { color: c.textMuted, borderColor: c.border, backgroundColor: "transparent", fontSize: size },
        strikethrough: { color: c.textMuted },
        underline: { color: c.text },
        highlight: { color: c.text, backgroundColor: c.warningSurface },
        spoiler: { color: c.textMuted },
        taskList: { checkedColor: c.text, borderColor: c.textMuted, checkmarkColor: c.canvas, checkedTextColor: c.textMuted },
        link: { color: c.text, underline: true },
        strong: { fontWeight: "600" } as never,
        code: { fontFamily: mono, fontSize: size * 0.85, color: c.text, backgroundColor: c.codeBackground, borderColor: c.border },
        codeBlock: {
          fontFamily: mono,
          fontSize: size * 0.8,
          lineHeight: size * 1.15,
          color: c.text,
          backgroundColor: c.codeBackground,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: 10,
          padding: 12,
          marginBottom: 10,
        },
        // The library's table defaults are light-only (white rows, near-black header text), so set every color.
        table: {
          fontSize: size * 0.9,
          color: c.text,
          headerTextColor: c.text,
          headerBackgroundColor: c.secondary,
          rowEvenBackgroundColor: c.surface,
          rowOddBackgroundColor: c.surfaceRaised,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: 8,
        },
        thematicBreak: { color: c.border } as never,
      }}
    />
  )
}
