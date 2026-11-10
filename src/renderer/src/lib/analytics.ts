import type { CaptureResult, PostHog } from "posthog-js"
import { POSTHOG, analyticsOn, onAnalyticsChange, setTracker } from "@kitab/core/analytics"

// PostHog in the Mac app: the core's events (track() in packages/core), the app opening,
// and uncaught errors. Only the installed app sends, never `pnpm dev` or `pnpm start`, and
// only while Settings → General → "Share usage" is on.
//
// Unlike the website, nothing is captured on its own: no clicks (they'd carry thread
// titles and message text), no page views, no session recordings. The page's address is
// the app's path on disk, so it's replaced before anything is sent. PostHog keeps a
// random ID for this Mac in localStorage.

const ADDRESS = /url|host|pathname|referr/i

/** Drops what describes where the page lives (the app's path on disk), on the event and on the person. */
function scrub(e: CaptureResult | null): CaptureResult | null {
  if (!e) return e
  for (const bag of [e.properties, e.$set, e.$set_once]) {
    if (!bag) continue
    for (const k of Object.keys(bag)) if (ADDRESS.test(k)) delete bag[k]
  }
  return e
}

let ph: PostHog | null = null

export async function startAnalytics() {
  if (!POSTHOG.key || import.meta.env.DEV) return
  const { version, packaged } = await window.hermes.app.info()
  if (!packaged) return
  const go = async () => {
    if (ph) return ph.opt_in_capturing()
    const { default: posthog } = await import("posthog-js")
    posthog.init(POSTHOG.key, {
      api_host: POSTHOG.host,
      ui_host: POSTHOG.ui,
      defaults: "2026-05-30",
      person_profiles: "identified_only",
      persistence: "localStorage",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_feature_flags: true,
      save_referrer: false,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      before_send: scrub,
    })
    // Turned off once and back on: PostHog remembers the opt-out on its own.
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing()
    posthog.register({ app: "kitaab-mac", app_version: version })
    posthog.capture("app_opened")
    ph = posthog
    setTracker((event, props) => ph?.capture(event, props))
  }
  onAnalyticsChange((on) => (on ? void go() : ph?.opt_out_capturing()))
  if (analyticsOn()) await go()
}
