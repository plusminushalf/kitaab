import type { Id } from "./model"
import { backend } from "./backend"
import { toast } from "./platform"
import { store, type View } from "./store"

// kitaab:// links, which the agent writes into replies (see the `kitab` skill in kitab-context.ts):
//   kitaab://thread/<session id>?profile=<profile>
//   kitaab://routine/<cron job id>?profile=<profile>
//   kitaab://run/<cron job id>/<run session id>?profile=<profile>
//   kitaab://routines | done | profile ?profile=<profile>
//   kitaab://personalities
// Links from before profiles held projects say ?project=<profile> and kitaab://project (the
// profile's settings); both still work.
// Parsed by hand: React Native's URL has no reliable searchParams.

export type KitabLink = { profileId?: Id; view: View }

export const isKitabLink = (url: string | undefined): url is string => !!url && /^kitaa?b:\/\//i.test(url)

export function parseKitabLink(url: string): KitabLink | null {
  if (!isKitabLink(url)) return null
  const [path, query = ""] = url.replace(/^kitaa?b:\/\//i, "").split("#")[0].split("?")
  const parts = path.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  let profileId: Id | undefined
  for (const pair of query.split("&")) {
    const [k, v = ""] = pair.split("=")
    if ((k === "profile" || (k === "project" && !profileId)) && v) profileId = decodeURIComponent(v)
  }
  const [kind, a, b] = parts
  const view: View | null =
    kind === "thread" && a ? { kind: "thread", threadId: a }
    : kind === "routine" && a ? { kind: "routine", routineId: a }
    : kind === "run" && a && b ? { kind: "run", routineId: a, runId: b }
    : kind === "routines" ? { kind: "routines" }
    : kind === "done" ? { kind: "done" }
    : kind === "profile" || kind === "project" ? { kind: "profile" }
    : kind === "personalities" ? { kind: "personalities" }
    : null
  return view ? { profileId, view } : null
}

/** Switches to the link's profile if it names another one. False when that profile doesn't exist. */
export async function enterProfile(link: KitabLink): Promise<boolean> {
  const { profileId } = link
  if (!profileId || profileId === store.get().profileId) return true
  if (!store.get().profiles.some((p) => p.id === profileId)) {
    toast.error(`There's no profile called ${profileId}`)
    return false
  }
  await backend.selectProfile(profileId)
  return true
}

/** Follows a kitaab:// link inside the Mac app's own navigation. */
export async function openKitabLink(url: string) {
  const link = parseKitabLink(url)
  if (!link) return void toast.error("Kitaab can't open that link")
  if (await enterProfile(link)) store.go(link.view)
}
