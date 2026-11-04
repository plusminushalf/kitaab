// Turns a routine's schedule into plain words: "Every 10 min", "Daily at 8:00".
// Covers the common shapes; anything else is shown as written.

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"]

const time = (h: number, m: number) =>
  new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

const pad = (m: number) => `:${String(m).padStart(2, "0")}`

function list(items: string[]) {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

/** Expands one cron field ("5,35", "*\/10", "8-17", "*") into numbers, or null for "*". */
function expand(field: string, min: number, max: number): number[] | null {
  if (field === "*") return null
  const out = new Set<number>()
  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/")
    const step = stepStr ? Number(stepStr) : 1
    let [lo, hi] = range === "*" ? [min, max] : range.split("-").map(Number)
    if (hi === undefined) hi = stepStr ? max : lo
    if (![lo, hi, step].every(Number.isFinite) || step <= 0) throw new Error("bad field")
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

/** Even spacing across the hour, e.g. [5, 35] → 30. */
function evenStep(values: number[], span: number) {
  if (values.length < 2) return null
  const step = values[1] - values[0]
  const even = values.every((v, i) => i === 0 || v - values[i - 1] === step) && step * values.length === span
  return even ? step : null
}

function days(dow: string): string | null {
  if (dow === "*") return null
  if (dow === "1-5") return "Weekdays"
  if (dow === "0,6" || dow === "6,0") return "Weekends"
  const d = expand(dow, 0, 6)
  return d ? list(d.map((n) => DAYS[n % 7])) : null
}

export function humanSchedule(expr: string): string {
  const s = expr.trim()

  // Hermes interval form: "every 30m", "every 2h", "every 1d".
  const every = s.match(/^every\s+(\d+)\s*([smhd])$/i)
  if (every) {
    const n = Number(every[1])
    const unit = { s: "sec", m: "min", h: n === 1 ? "hour" : "hours", d: n === 1 ? "day" : "days" }[every[2].toLowerCase()]
    return n === 1 && (unit === "hour" || unit === "day") ? `Every ${unit}` : `Every ${n} ${unit}`
  }

  const f = s.split(/\s+/)
  if (f.length !== 5) return s
  const [mi, hr, dom, mon, dow] = f
  if (dom !== "*" || mon !== "*") return s

  try {
    const mins = expand(mi, 0, 59)
    const hours = expand(hr, 0, 23)
    const when = days(dow)
    const prefix = (text: string) => (when ? `${when}, ${text[0].toLowerCase()}${text.slice(1)}` : text)

    // Every hour of the day.
    if (!hours) {
      if (!mins) return prefix("Every minute")
      const step = mi.startsWith("*/") ? Number(mi.slice(2)) : evenStep(mins, 60)
      if (step && mins[0] === 0) return prefix(`Every ${step} min`)
      if (step) return prefix(`Every ${step} min, at ${list(mins.map(pad))}`)
      if (mins.length === 1) return prefix(mins[0] === 0 ? "Every hour" : `Every hour at ${pad(mins[0])}`)
      return prefix(`Every hour at ${list(mins.map(pad))}`)
    }

    // Specific hours.
    if (!mins) return s
    const step = hr.startsWith("*/") ? Number(hr.slice(2)) : evenStep(hours, 24)
    if (step && mins.length === 1 && hours[0] === 0) {
      return prefix(`Every ${step} hours${mins[0] ? ` at ${pad(mins[0])}` : ""}`)
    }
    // Several hours × several minutes: name the hours, then the minutes.
    // e.g. "0,30 8,12,19" → "Daily at 08:00, 12:00 and 19:00, and :30 past each".
    if (hours.length > 1 && mins.length > 1) {
      const [first, ...rest] = mins
      const text = `at ${list(hours.map((h) => time(h, first)))}, and ${list(rest.map(pad))} past each`
      return when ? `${when} ${text}` : `Daily ${text}`
    }
    const times = hours.flatMap((h) => mins.map((m) => time(h, m)))
    if (times.length > 6) return s
    return when ? `${when} at ${list(times)}` : `Daily at ${list(times)}`
  } catch {
    return s
  }
}
