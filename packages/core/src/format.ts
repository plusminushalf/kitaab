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

/**
 * When a routine runs next. Once that time has passed the scheduler picks it up on
 * its next tick, so it reads "Due now" rather than "in the past"; well past that, it
 * has stalled and reads "Overdue". `prefix` leads a future time ("Next in 5 min");
 * pass "" where a label already says what the time is.
 */
export function nextRun(ms: number, prefix = "Next"): string {
  const late = Date.now() - ms
  if (late >= 10 * 60_000) return "Overdue"
  if (late > -60_000) return "Due now"
  return prefix ? `${prefix} ${relativeTime(ms)}` : relativeTime(ms)
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

/**
 * A server path as people read it: the home folder shown as `~`, so
 * /home/me/.hermes/profiles/x reads ~/.hermes/profiles/x. Display only; copy the real path.
 */
export function homePath(path: string): string {
  return path.replace(/^(?:\/home\/[^/]+|\/Users\/[^/]+|\/root)(?=\/|$)/, "~")
}

const SOURCE_NAMES: Record<string, string> = {
  tui: "Terminal",
  cli: "CLI",
  acp: "Editor",
  api_server: "API",
  webhook: "Webhook",
  msgraph_webhook: "Microsoft Graph",
  whatsapp: "WhatsApp",
  whatsapp_cloud: "WhatsApp",
  sms: "SMS",
  email: "Email",
  bluebubbles: "iMessage",
  wecom: "WeCom",
  wecom_callback: "WeCom",
  qqbot: "QQ",
  dingtalk: "DingTalk",
}

/** Where a thread was started, for threads not started in Kitaab ("Telegram", "CLI", …). */
export function sourceName(source: string | undefined): string | undefined {
  if (!source || source === "desktop" || source === "cron") return undefined
  return SOURCE_NAMES[source] ?? source.charAt(0).toUpperCase() + source.slice(1).replace(/_/g, " ")
}
