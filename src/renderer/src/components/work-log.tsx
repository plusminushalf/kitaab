import { useState } from "react"
import { Brain, ChevronDown, ChevronRight, Globe, SquareTerminal, Wrench, FileText, Code, BookOpen, Split } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import type { Message, Part, ToolCall } from "@kitab/core/model"
import { Markdown } from "@/components/markdown"

// The work behind an answer, the way T3 Code shows it: one "Worked for 3m 8s"
// line that opens to the thinking, tool calls and the text written between them,
// in the order they happened, with runs of the same tool folded into one row
// ("Ran 8 commands"). Open while the turn is running.

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

/** Plain words for a group of calls to the same tool. */
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
    case "delegate_task":
      return `Handed off ${plural(n, "a task", "tasks")}`
    case "vision_analyze":
      return `Looked at ${plural(n, "an image", "images")}`
    default:
      return n > 1 ? `${name} ×${n}` : name
  }
}

function iconFor(name: string) {
  if (name === "terminal") return SquareTerminal
  if (name === "execute_code") return Code
  if (name.startsWith("web_")) return Globe
  if (name.includes("file") || name === "patch") return FileText
  if (name.startsWith("skill")) return BookOpen
  if (name === "delegate_task") return Split
  return Wrench
}

function duration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** `work` is the turn up to its answer (see splitTurn in @kitab/core/turn). */
export function WorkLog({ message: m, work }: { message: Message; work: Part[] }) {
  const running = Boolean(m.streaming)
  const [open, setOpen] = useState<boolean | null>(null) // null = follow running state
  if (!work.length) return null

  const expanded = open ?? running
  const ms = m.startedAt && m.endedAt ? m.endedAt - m.startedAt : 0
  const label = running ? "Working…" : ms ? `Worked for ${duration(ms)}` : "Worked"

  return (
    <div className="flex flex-col text-sm text-muted-foreground">
      <button
        className="flex w-fit items-center gap-1.5 py-1 hover:text-foreground"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
      >
        {running && <Spinner className="size-3.5" />}
        <span>{label}</span>
        <ChevronDown className={"size-3.5 transition-transform " + (expanded ? "" : "-rotate-90")} />
      </button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-3">
          {work.map((p, i) =>
            p.type === "text" ? (
              <Markdown key={i} text={p.text.trim()} />
            ) : (
              <div key={i} className="flex flex-col gap-0.5 border-l pl-3">
                {p.reasoning?.trim() && <ThinkingRow text={p.reasoning} />}
                {groupTools(p.tools).map((g, j) => (
                  <ToolGroupRow key={`${g.name}-${j}`} group={g} />
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

function ThinkingRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const first = text.trim().split("\n")[0]
  return (
    <div>
      <button className="flex w-full min-w-0 items-center gap-2 py-0.5 text-left hover:text-foreground" onClick={() => setOpen(!open)}>
        <Brain className="size-4 shrink-0" />
        <span className="truncate">{first}</span>
      </button>
      {open && <div className="selectable ml-6 py-1 text-xs whitespace-pre-wrap">{text}</div>}
    </div>
  )
}

function ToolGroupRow({ group }: { group: Group }) {
  const [open, setOpen] = useState(false)
  const Icon = iconFor(group.name)
  const running = group.calls.some((c) => c.status === "running")
  const single = group.calls.length === 1 ? group.calls[0] : null

  return (
    <div>
      <button
        className="flex w-full min-w-0 items-center gap-2 py-0.5 text-left hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {running ? <Spinner className="size-4 shrink-0" /> : <Icon className="size-4 shrink-0" />}
        <span className="shrink-0">{describe(group.name, group.calls.length)}</span>
        {single?.summary && !open && <span className="truncate font-mono text-xs opacity-70">{single.summary}</span>}
        {!single && <ChevronRight className={"size-3.5 shrink-0 transition-transform " + (open ? "rotate-90" : "")} />}
      </button>
      {open && (
        <div className="ml-6 flex flex-col gap-0.5 py-0.5">
          {group.calls.map((c) => (
            <div key={c.id} className="selectable truncate font-mono text-xs opacity-80" title={c.summary}>
              {c.summary || c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
