// React Native's Hermes engine has no Intl.RelativeTimeFormat; fall back to short plain words there.
const rtf =
  typeof Intl.RelativeTimeFormat === "function"
    ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" })
    : {
        format(n: number, unit: "minute" | "hour" | "day") {
          const short = { minute: "m", hour: "h", day: "d" }[unit]
          return n < 0 ? `${-n}${short} ago` : `in ${n}${short}`
        },
      }

export function relativeTime(ms: number | undefined): string {
  if (!ms) return ""
  const diff = (ms - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return "now"
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour")
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day")
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function dateTime(ms: number | undefined): string {
  if (!ms) return ""
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function bytes(n: number | undefined): string {
  if (!n) return ""
  const units = ["B", "KB", "MB", "GB"]
  let i = 0
  while (n >= 1024 && i < units.length - 1) (n /= 1024), i++
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`
}
