import type { Id, Project } from "./model"
import { store } from "./store"

// The order you put projects in (the project switcher, ⌘1–⌘9). It lives on the
// server so the Mac and the iPhone agree:
//   ui_meta["kitab.projectOrder"] = [projectId, …] on the default profile
// Projects missing from the list (new ones, or made elsewhere) follow, in Hermes's order.

const KEY = "kitab.projectOrder"

type ProfileRow = { name: string; is_default?: boolean; ui_meta?: Record<string, any> }

let home = "default"
let order: Id[] = []

/** `projects` in your order. */
export function inOrder(projects: Project[]): Project[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  return projects
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (rank.get(a.p.id) ?? order.length + a.i) - (rank.get(b.p.id) ?? order.length + b.i))
    .map((x) => x.p)
}

/** Picks up your order from what profiles.list returned. Call before setting projects. */
export function readProjectOrder(rows: ProfileRow[]) {
  const row = rows.find((r) => r.is_default) ?? rows.find((r) => r.name === "default") ?? rows[0]
  home = row?.name ?? "default"
  const v = row?.ui_meta?.[KEY]
  order = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

/** Saves a new order for every device. Shows it at once and puts it back if Hermes refuses. */
export async function writeProjectOrder(gw: { call<T>(method: string, params: any): Promise<T> }, ids: Id[]) {
  const before = order
  order = ids
  store.set((s) => ({ projects: inOrder(s.projects) }))
  try {
    const r = await gw.call<any>("profiles.configure", { name: home, ui_meta: { [KEY]: ids } })
    if (!r?.applied?.ui_meta) throw new Error("Hermes didn't save the project order")
  } catch (e) {
    order = before
    store.set((s) => ({ projects: inOrder(s.projects) }))
    throw e
  }
}
