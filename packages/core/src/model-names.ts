// Readable names for model ids: "claude-opus-5-5" → "Claude Opus 5.5",
// "gpt-5.4-mini" → "GPT-5.4 mini", "claude-sonnet-4-5-20250929" → "Claude Sonnet 4.5 (Sep 2025)".

const UPPER = new Set(["gpt", "o1", "o3", "o4"])
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function modelName(id: string): string {
  let parts = id.split("-")
  let snapshot = ""
  const last = parts.at(-1) ?? ""
  if (/^\d{8}$/.test(last)) {
    snapshot = ` (${MONTHS[Number(last.slice(4, 6)) - 1] ?? ""} ${last.slice(0, 4)})`
    parts = parts.slice(0, -1)
  }

  // Join runs of bare numbers into versions: ["5","5"] → "5.5".
  const words: string[] = []
  for (const p of parts) {
    const prev = words.at(-1)
    if (/^\d+$/.test(p) && prev && /^\d+(\.\d+)*$/.test(prev)) words[words.length - 1] = `${prev}.${p}`
    else words.push(p)
  }

  // "gpt" + "5.4" reads as "GPT-5.4".
  if (UPPER.has(words[0]?.toLowerCase()) && /^\d/.test(words[1] ?? "")) {
    words.splice(0, 2, `${words[0].toUpperCase()}-${words[1]}`)
  }

  const preview = words.at(-1) === "preview"
  if (preview) words.pop()
  const name = words
    .map((w, i) => {
      if (UPPER.has(w.toLowerCase())) return w.toUpperCase()
      if (/^\d/.test(w) || w.includes("-")) return w
      // Size words stay lowercase, as vendors write them ("GPT-5.4 mini").
      if (i > 0 && ["mini", "nano"].includes(w)) return w
      return w[0].toUpperCase() + w.slice(1)
    })
    .join(" ")
  return name + (preview ? " (Preview)" : "") + snapshot
}

/** Short form for the composer button: "Claude Opus 5.5" → "Opus 5.5". */
export function shortModelName(id: string): string {
  return modelName(id).replace(/^Claude /, "").replace(/ \((Preview|[A-Z][a-z]{2} \d{4})\)$/, "")
}

export const EFFORT_LABELS: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
}
