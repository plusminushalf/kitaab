import type { Message, Part, ToolCall } from "./model"

// An assistant turn as it happened: thinking and tool calls interleaved with the text
// written between them. Text, reasoning and tool calls that arrive back to back join the
// part before them, so "ran 3 commands, said something, read a file" is three parts.

export function addText(parts: Part[], text: string): Part[] {
  if (!text) return parts
  const last = parts.at(-1)
  if (last?.type === "text") return [...parts.slice(0, -1), { ...last, text: last.text + text }]
  return [...parts, { type: "text", text }]
}

/** A paragraph break between two stretches of streamed text. */
export function breakText(parts: Part[]): Part[] {
  const last = parts.at(-1)
  if (last?.type !== "text" || !last.text || last.text.endsWith("\n\n")) return parts
  return [...parts.slice(0, -1), { ...last, text: last.text + "\n\n" }]
}

export function addReasoning(parts: Part[], text: string, sep = ""): Part[] {
  if (!text) return parts
  const last = parts.at(-1)
  if (last?.type === "work") {
    const reasoning = last.reasoning ? last.reasoning + sep + text : text
    return [...parts.slice(0, -1), { ...last, reasoning }]
  }
  return [...parts, { type: "work", reasoning: text, tools: [] }]
}

export function addTool(parts: Part[], tool: ToolCall): Part[] {
  const last = parts.at(-1)
  if (last?.type === "work") return [...parts.slice(0, -1), { ...last, tools: [...last.tools, tool] }]
  return [...parts, { type: "work", tools: [tool] }]
}

export function updateTool(parts: Part[], id: string, fn: (t: ToolCall) => ToolCall): Part[] {
  return parts.map((p) => (p.type === "work" && p.tools.some((t) => t.id === id) ? { ...p, tools: p.tools.map((t) => (t.id === id ? fn(t) : t)) } : p))
}

/** A message's parts, built from its flat fields when it has none (an in-flight turn picked up on resume). */
export function partsOf(m: Message): Part[] {
  if (m.parts) return m.parts
  const parts: Part[] = []
  if (m.reasoning || m.tools?.length) parts.push({ type: "work", reasoning: m.reasoning, tools: m.tools ?? [] })
  if (m.text) parts.push({ type: "text", text: m.text })
  return parts
}

/**
 * Splits a turn into the work (everything up to the last tool call, including the text
 * written along the way) and the answer (the text after it). While the turn runs there
 * is no answer yet: all of it is work, shown in order.
 */
export function splitTurn(m: Message): { work: Part[]; answer: string } {
  const parts = partsOf(m).filter((p) => (p.type === "text" ? p.text.trim() : p.reasoning?.trim() || p.tools.length))
  if (m.streaming) return { work: parts, answer: "" }
  let i = parts.length
  while (i > 0 && parts[i - 1].type === "text") i--
  const answer = parts
    .slice(i)
    .map((p) => (p.type === "text" ? p.text.trim() : ""))
    .join("\n\n")
  return { work: parts.slice(0, i), answer }
}

// ---- tool parameters ----------------------------------------------------------

const MAX_ARG = 4000

/** A tool call's arguments, kept small enough to hold in memory and cache: long values are cut. */
export function toolArgs(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue
    if (typeof v === "string") out[k] = v.length > MAX_ARG ? `${v.slice(0, MAX_ARG)}…` : v
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v
    else {
      const json = JSON.stringify(v)
      out[k] = json.length > MAX_ARG ? `${json.slice(0, MAX_ARG)}…` : v
    }
  }
  return Object.keys(out).length ? out : undefined
}

/** The one-line description Hermes sends with a tool call: an app label for connectors, else its argument preview. */
export function toolSummary(p: { labels?: { text?: string }[]; context?: string; preview?: string }): string | undefined {
  const s = p.labels?.[0]?.text || p.context || p.preview
  return typeof s === "string" && s.trim() ? s.trim() : undefined
}

/** A tool call's parameters to show, one per line, each value as written (objects as JSON). */
export function toolParams(call: ToolCall): { key: string; value: string }[] {
  return Object.entries(call.args ?? {}).map(([key, v]) => ({
    key,
    value: typeof v === "string" ? v : JSON.stringify(v, null, 2),
  }))
}
