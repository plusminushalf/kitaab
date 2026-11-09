import { memo, useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { Image } from "expo-image"
import * as Clipboard from "expo-clipboard"
import * as Haptics from "expo-haptics"
import type { Message, Part, ToolCall } from "@kitab/core/model"
import { splitTurn } from "@kitab/core/turn"
import { splitImageTags } from "@kitab/core/user-text"
import { useStore } from "@/lib/store"
import { useColors } from "@/lib/theme"
import { Markdown } from "./markdown"
import { Avatar, Icon } from "./ui"

// One turn in a thread. Same reading as the Mac: user messages in a bubble on the right,
// answers full width with a "Worked for …" line that opens to the thinking, tool calls and
// the text written between them, in the order they happened.

type Group = { name: string; calls: ToolCall[] }

function groupTools(tools: ToolCall[]): Group[] {
  const groups: Group[] = []
  for (const t of tools) {
    const last = groups.at(-1)
    if (last && last.name === t.name) last.calls.push(t)
    else groups.push({ name: t.name, calls: [t] })
  }
  return groups
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

function describe(name: string, n: number): string {
  switch (name) {
    case "terminal":
      return `Ran ${plural(n, "a command", "commands")}`
    case "execute_code":
      return `Ran ${plural(n, "some code", "code blocks")}`
    case "read_file":
      return `Read ${plural(n, "a file", "files")}`
    case "write_file":
    case "patch":
      return `Edited ${plural(n, "a file", "files")}`
    case "search_files":
      return `Searched files${n > 1 ? ` ${n} times` : ""}`
    case "web_search":
      return `Searched the web${n > 1 ? ` ${n} times` : ""}`
    case "web_extract":
      return `Read ${plural(n, "a web page", "web pages")}`
    case "skill_view":
      return `Opened ${plural(n, "a skill", "skills")}`
    case "skill_manage":
      return `Updated ${plural(n, "a skill", "skills")}`
    case "vision_analyze":
      return `Looked at ${plural(n, "an image", "images")}`
    default:
      return n > 1 ? `${name} ×${n}` : name
  }
}

function iconFor(name: string) {
  if (name === "terminal") return "apple.terminal" as const
  if (name === "execute_code") return "chevron.left.forwardslash.chevron.right" as const
  if (name.startsWith("web_")) return "globe" as const
  if (name.includes("file") || name === "patch") return "doc.text" as const
  if (name.startsWith("skill")) return "book" as const
  return "wrench.and.screwdriver" as const
}

function duration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// While the turn runs its steps show in full, with "Working…" as the last line, where the
// next step lands. Once it ends they fold under a "Worked for …" line above the answer.
function WorkLog({ message: m, work }: { message: Message; work: Part[] }) {
  const c = useColors()
  const [open, setOpen] = useState(false)

  if (m.streaming) {
    return (
      <View style={{ gap: 10, marginBottom: 8 }}>
        <Steps work={work} running />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
          <ActivityIndicator size="small" />
          <Text style={{ color: c.textMuted, fontSize: 14 }}>Working…</Text>
        </View>
      </View>
    )
  }

  if (!work.length) return null
  const ms = m.startedAt && m.endedAt ? m.endedAt - m.startedAt : 0
  return (
    <View style={{ marginBottom: 8 }}>
      <Pressable onPress={() => setOpen(!open)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
        <Text style={{ color: c.textMuted, fontSize: 14 }}>{ms ? `Worked for ${duration(ms)}` : "Worked"}</Text>
        <Icon name={open ? "chevron.down" : "chevron.right"} size={11} color={c.textMuted} weight="semibold" />
      </Pressable>
      {open ? (
        <View style={{ gap: 10, marginTop: 4 }}>
          <Steps work={work} running={false} />
        </View>
      ) : null}
    </View>
  )
}

function Steps({ work, running }: { work: Part[]; running: boolean }) {
  return work.map((p, i) => (p.type === "text" ? <Markdown key={i} text={p.text.trim()} /> : <WorkPart key={i} part={p} running={running} />))
}

function WorkPart({ part, running }: { part: Extract<Part, { type: "work" }>; running: boolean }) {
  const c = useColors()
  const reasoning = part.reasoning?.trim()
  return (
    <View style={{ marginLeft: 4, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: c.border, gap: 8 }}>
      {reasoning ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Icon name="brain" size={14} color={c.textMuted} />
          <Text style={{ flex: 1, color: c.textMuted, fontSize: 13, lineHeight: 18 }} numberOfLines={running ? undefined : 8}>
            {reasoning}
          </Text>
        </View>
      ) : null}
      {groupTools(part.tools).map((g, i) => {
        const busy = g.calls.some((t) => t.status === "running")
        const summary = g.calls.length === 1 ? g.calls[0].summary : undefined
        return (
          <View key={`${g.name}-${i}`} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <Icon name={iconFor(g.name)} size={14} color={c.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 13 }}>{describe(g.name, g.calls.length)}</Text>
              {summary ? (
                <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 1 }} numberOfLines={2}>
                  {summary}
                </Text>
              ) : null}
            </View>
            {busy ? <ActivityIndicator size="small" /> : null}
          </View>
        )
      })}
    </View>
  )
}

function copy(text: string) {
  void Clipboard.setStringAsync(text)
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
}

export const MessageRow = memo(function MessageRow({ message: m }: { message: Message }) {
  const c = useColors()
  const speaker = useStore((s) => s.personalities.find((p) => p.id === m.personalityId))
  const { work, answer } = splitTurn(m)

  if (m.role === "user") {
    return (
      <View style={{ alignItems: "flex-end", paddingHorizontal: 16, paddingVertical: 6 }}>
        {m.attachments?.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", marginBottom: 6, maxWidth: "85%" }}>
            {m.attachments.map((a, i) =>
              a.kind === "image" && a.url ? (
                <Image key={i} source={{ uri: a.url }} style={{ width: 120, height: 120, borderRadius: 12, backgroundColor: c.secondary }} contentFit="cover" />
              ) : (
                <View key={i} style={{ flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: c.secondary, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Icon name="doc" size={13} color={c.textMuted} />
                  <Text style={{ color: c.text, fontSize: 13 }} numberOfLines={1}>
                    {a.name}
                  </Text>
                </View>
              ),
            )}
          </View>
        ) : null}
        {m.text ? (
          <Pressable onLongPress={() => copy(m.text)} style={{ maxWidth: "85%", backgroundColor: c.messageSurface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 }}>
            <Text style={{ color: c.text, fontSize: 16, lineHeight: 22 }} selectable>
              {/* [Image #N] tags (pasted on the Mac) read as pills, as they do there. */}
              {splitImageTags(m.text).map((t, i) =>
                typeof t === "string" ? (
                  t
                ) : (
                  <Text key={i} style={{ backgroundColor: c.secondary, fontSize: 13, fontWeight: "600" }}>
                    {` Image #${t} `}
                  </Text>
                ),
              )}
            </Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      {speaker ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <Avatar name={speaker.name} size={20} />
          <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>{speaker.name}</Text>
        </View>
      ) : null}
      <WorkLog message={m} work={work} />
      {answer ? <Markdown text={answer} /> : null}
    </View>
  )
})
