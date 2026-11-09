import type { ModelChoice } from "./store"
import { store } from "./store"

// Your default model for new threads, set in Settings → Threads. It lives on the
// server so the Mac and the iPhone agree:
//   ui_meta["kitab.defaultModel"] = { model, provider, effort?, fast? } on the default profile
// A project whose providers don't offer that model keeps its own (its Hermes config).

const KEY = "kitab.defaultModel"

type ProfileRow = { name: string; is_default?: boolean; ui_meta?: Record<string, any> }

let home = "default"

function parse(v: any): ModelChoice | null {
  if (!v || typeof v !== "object" || typeof v.model !== "string" || typeof v.provider !== "string") return null
  return {
    model: v.model,
    provider: v.provider,
    effort: typeof v.effort === "string" ? v.effort : undefined,
    fast: typeof v.fast === "boolean" ? v.fast : undefined,
  }
}

/** Picks up your default from what profiles.list returned. */
export function readMyModel(rows: ProfileRow[]) {
  const row = rows.find((r) => r.is_default) ?? rows.find((r) => r.name === "default") ?? rows[0]
  home = row?.name ?? "default"
  store.set({ myModel: parse(row?.ui_meta?.[KEY]) })
  resolveDefault()
}

/** Writes your default (null clears it) for every device. */
export async function writeMyModel(gw: { call<T>(method: string, params: any): Promise<T> }, choice: ModelChoice | null) {
  const value = choice
    ? { model: choice.model, provider: choice.provider, effort: choice.effort, fast: choice.fast }
    : null
  const r = await gw.call<any>("profiles.configure", { name: home, ui_meta: { [KEY]: value } })
  if (!r?.applied?.ui_meta) throw new Error("Hermes didn't save it")
  store.set({ myModel: choice })
  resolveDefault()
}

/** Your default when the open project can run it, else null. */
export function usableMyModel(): ModelChoice | null {
  const { myModel, models } = store.get()
  if (!myModel) return null
  const provider = models.find((p) => p.slug === myModel.provider)
  return provider?.models.includes(myModel.model) ? myModel : null
}

/** Sets what new threads start on from your default and the project's. */
export function resolveDefault() {
  const s = store.get()
  const mine = usableMyModel()
  store.set({
    defaultModel: mine ? { ...mine, effort: mine.effort ?? s.profileEffort } : s.profileModel,
    defaultEffort: mine?.effort ?? s.profileEffort,
  })
}
