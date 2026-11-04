import { Linking } from "react-native"
import { EnrichedMarkdownText } from "react-native-enriched-markdown"
import { mono, useColors } from "@/lib/theme"

/** Native markdown (GFM), styled like the Mac's prose. */
export function Markdown({ text, size = 16 }: { text: string; size?: number }) {
  const c = useColors()
  return (
    <EnrichedMarkdownText
      flavor="github"
      markdown={text}
      onLinkPress={({ url }) => void Linking.openURL(url)}
      enableTaskListItemToggle={false}
      markdownStyle={{
        paragraph: { fontSize: size, lineHeight: size * 1.45, color: c.text, marginBottom: 10 },
        h1: { fontSize: size * 1.45, fontWeight: "700", color: c.text, marginTop: 8, marginBottom: 8 },
        h2: { fontSize: size * 1.25, fontWeight: "700", color: c.text, marginTop: 8, marginBottom: 6 },
        h3: { fontSize: size * 1.1, fontWeight: "600", color: c.text, marginTop: 6, marginBottom: 4 },
        list: { fontSize: size, lineHeight: size * 1.45, color: c.text, bulletColor: c.textMuted, markerColor: c.textMuted, marginBottom: 10 },
        blockquote: { color: c.textMuted, borderColor: c.border, fontSize: size },
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
        table: { fontSize: size * 0.9, borderColor: c.border, headerBackgroundColor: c.secondary, borderRadius: 8 } as never,
        thematicBreak: { color: c.border } as never,
      }}
    />
  )
}
