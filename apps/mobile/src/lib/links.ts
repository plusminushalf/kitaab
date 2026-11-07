import { router } from "expo-router"
import type { View } from "@kitab/core/store"
import { enterProject, parseKitabLink } from "@kitab/core/links"
import { toast } from "@kitab/core/platform"

// kitaab:// links in replies (see @kitab/core/links), mapped onto this app's routes.

function pathFor(view: View): string | null {
  const e = encodeURIComponent
  switch (view.kind) {
    case "thread":
      return view.threadId ? `/thread/${e(view.threadId)}` : "/thread/new"
    case "routine":
      return `/routine/${e(view.routineId)}`
    case "run":
      return `/run/${e(view.routineId)}/${e(view.runId)}`
    case "routines":
      return "/routines"
    case "personalities":
      return "/personalities"
    case "project":
      return "/project"
    case "done":
      return "/done"
    default:
      return null
  }
}

export async function openKitabLink(url: string) {
  const link = parseKitabLink(url)
  const path = link && pathFor(link.view)
  if (!link || !path) return void toast.error("Kitaab can't open that link")
  if (await enterProject(link)) router.push(path as never)
}
