import { PostHog } from "posthog-react-native"
import { nativeApplicationVersion } from "expo-application"
import { POSTHOG, analyticsOn, onAnalyticsChange, setTracker } from "@kitab/core/analytics"

// PostHog on the iPhone: the core's events (track() in packages/core), the app opening,
// coming to the front and going to the back, and uncaught JS errors. Only Release builds
// send, never one running from Metro, and only while Settings → "Share usage" is on.
//
// Nothing is captured on its own: no taps (they'd carry thread titles and message text),
// no screens (their params are thread ids), no session replay. PostHog keeps a random ID
// for this iPhone in a file in the app's documents.

let ph: PostHog | null = null

function start() {
  if (ph) return void ph.optIn()
  ph = new PostHog(POSTHOG.key, {
    host: POSTHOG.host,
    persistence: "file",
    captureAppLifecycleEvents: true,
    enableSessionReplay: false,
    disableSurveys: true,
    preloadFeatureFlags: false,
    errorTracking: { autocapture: { uncaughtExceptions: true, unhandledRejections: true, console: false } },
  })
  const client = ph
  setTracker((event, props) => client.capture(event, props))
  void client.ready().then(async () => {
    // Turned off once and back on: PostHog remembers the opt-out on its own.
    if (client.optedOut) await client.optIn()
    await client.register({ app: "kitaab-iphone", app_version: nativeApplicationVersion ?? "" })
    client.capture("app_opened")
  })
}

export function startAnalytics() {
  if (!POSTHOG.key || __DEV__) return
  onAnalyticsChange((on) => (on ? start() : void ph?.optOut()))
  if (analyticsOn()) start()
}
