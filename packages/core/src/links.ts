import type { Id } from "./model"
import { backend } from "./backend"
import { toast } from "./platform"
import { store, type View } from "./store"

// kitab:// links, which the agent writes into replies (see the `kitab` skill in kitab-context.ts):
//   kitab://thread/<session id>?project=<profile>
//   kitab://routine/<cron job id>?project=<profile>
//   kitab://run/<cron job id>/<run session id>?project=<profile>
//   kitab://routines | done | project ?project=<profile>
//   kitab://personalities
// Parsed by hand: React Native's URL has no reliable searchParams.

export type KitabLink = { projectId?: Id; view: View }

export const isKitabLink = (url: string | undefined): url is string => !!url && /^kitab:\/\//i.test(url)

export function parseKitabLink(url: string): KitabLink | null {
  if (!isKitabLink(url)) return null
  const [path, query = ""] = url.replace(/^kitab:\/\//i, "").split("#")[0].split("?")
  const parts = path.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  let projectId: Id | undefined
  for (const pair of query.split("&")) {
    const [k, v = ""] = pair.split("=")
    if (k === "project" && v) projectId = decodeURIComponent(v)
  }
  const [kind, a, b] = parts
  const view: View | null =
    kind === "thread" && a ? { kind: "thread", threadId: a }
    : kind === "routine" && a ? { kind: "routine", routineId: a }
    : kind === "run" && a && b ? { kind: "run", routineId: a, runId: b }
    : kind === "routines" ? { kind: "routines" }
    : kind === "done" ? { kind: "done" }
    : kind === "project" ? { kind: "project" }
    : kind === "personalities" ? { kind: "personalities" }
    : null
  return view ? { projectId, view } : null
}

/** Switches to the link's project if it names another one. False when that project doesn't exist. */
export async function enterProject(link: KitabLink): Promise<boolean> {
  const { projectId } = link
  if (!projectId || projectId === store.get().projectId) return true
  if (!store.get().projects.some((p) => p.id === projectId)) {
    toast.error(`There's no project called ${projectId}`)
    return false
  }
  await backend.selectProject(projectId)
  return true
}

/** Follows a kitab:// link inside the Mac app's own navigation. */
export async function openKitabLink(url: string) {
  const link = parseKitabLink(url)
  if (!link) return void toast.error("Kitab can't open that link")
  if (await enterProject(link)) store.go(link.view)
}
