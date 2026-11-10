// Product analytics for both apps: what gets used, never what's in it. The core says
// what happened (track); each app installs a tracker that sends it to PostHog: the Mac
// with posthog-js (src/renderer/src/lib/analytics.ts), the iPhone with
// posthog-react-native (apps/mobile/src/lib/analytics.ts). Only release builds send.
//
// Events carry counts and kinds only: no thread titles, message text, names, paths,
// hosts or ids. Each device can turn it off in Settings.

import { platform } from "./platform"

/** Kitaab's PostHog project (EU), sent through PostHog's managed reverse proxy on our own domain. The key is public. */
export const POSTHOG = {
  key: "",
  host: "https://a.pitwall.plusminushalf.com",
  ui: "https://eu.posthog.com",
}

export type EventProps = Record<string, string | number | boolean>

let tracker: ((event: string, props?: EventProps) => void) | null = null

export function setTracker(t: typeof tracker) {
  tracker = t
}

/** Sends an event, e.g. track("message_sent", { new_thread: true }). No-op until a tracker is installed. */
export function track(event: string, props?: EventProps) {
  try {
    tracker?.(event, props)
  } catch {}
}

const OFF = "kitaab.analytics.off"
const listeners = new Set<(on: boolean) => void>()

/** Whether this device shares usage (on unless turned off in Settings). */
export function analyticsOn(): boolean {
  return platform().storage.get(OFF) !== "1"
}

export function setAnalyticsOn(on: boolean) {
  platform().storage.set(OFF, on ? null : "1")
  for (const l of listeners) l(on)
}

export function onAnalyticsChange(l: (on: boolean) => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}
