import type { Id } from "./model"
import { gw } from "./backend"
import { platform } from "./platform"

// What Kitab knows about a thread that Hermes doesn't, kept on the server so every
// device sees the same thing:
//   ui_meta["kitab.thread.<session id>"] on the thread's project profile
// One key per thread: ui_meta merges key by key, so two devices editing different
// threads never overwrite each other. Plain threads (no cast, not from a run) have no key.

export type RunOrigin = { routineId: Id; title: string; updatedAt: number; done?: boolean }
export type ThreadMeta = {
  /** Personality ids in the thread; the first one is the host. */
  cast: Id[]
  /** User turn index → the personality that answered it. */
  turns: Record<number, Id>
  /** Set when the thread grew out of a routine run (the thread id is the run's session id). */
  run?: RunOrigin
}

const PREFIX = "kitab.thread."
const EMPTY: ThreadMeta = { cast: [], turns: {} }

type ProfileRow = { name: string; ui_meta?: Record<string, any> }

const metas = new Map<Id, { projectId: Id; meta: ThreadMeta }>()

function parse(v: any): ThreadMeta | null {
  if (!v || typeof v !== "object") return null
  const cast = Array.isArray(v.cast) ? v.cast.filter((x: unknown): x is string => typeof x === "string") : []
  const turns: Record<number, Id> = {}
  if (v.turns && typeof v.turns === "object") {
    for (const [k, id] of Object.entries(v.turns)) if (typeof id === "string" && /^\d+$/.test(k)) turns[Number(k)] = id
  }
  const r = v.run
  const run =
    r && typeof r === "object" && typeof r.routineId === "string"
      ? {
          routineId: r.routineId,
          title: String(r.title ?? "Routine run"),
          updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
          done: r.done === true || undefined,
        }
      : undefined
  return { cast, turns, run }
}

/** Rebuilds the cache from what profiles.list returned. */
export function readThreadMeta(rows: ProfileRow[]) {
  metas.clear()
  for (const row of rows) {
    for (const [k, v] of Object.entries(row.ui_meta ?? {})) {
      if (!k.startsWith(PREFIX)) continue
      const meta = parse(v)
      if (meta) metas.set(k.slice(PREFIX.length), { projectId: row.name, meta })
    }
  }
}

export const threadMeta = (threadId: Id): ThreadMeta => metas.get(threadId)?.meta ?? EMPTY

/** The project a thread's metadata lives in, when it has any. */
export const metaProject = (threadId: Id): Id | undefined => metas.get(threadId)?.projectId

/** Threads that grew out of routine runs, with their project. */
export function runThreads(projectId?: Id): { id: Id; projectId: Id; run: RunOrigin }[] {
  const out: { id: Id; projectId: Id; run: RunOrigin }[] = []
  for (const [id, v] of metas) if (v.meta.run && (!projectId || v.projectId === projectId)) out.push({ id, projectId: v.projectId, run: v.meta.run })
  return out
}

export const runOrigin = (threadId: Id) => {
  const v = metas.get(threadId)
  return v?.meta.run ? { projectId: v.projectId, ...v.meta.run } : undefined
}

const same = (a: ThreadMeta, b: ThreadMeta) => JSON.stringify(a) === JSON.stringify(b)

/** Saves a thread's metadata (cache first, then Hermes). Skips the write when nothing changed. */
export async function saveThreadMeta(projectId: Id, threadId: Id, patch: Partial<ThreadMeta>) {
  const prev = metas.get(threadId)?.meta ?? EMPTY
  const next: ThreadMeta = { ...prev, ...patch }
  if (!next.run) delete next.run
  if (metas.has(threadId) && same(prev, next)) return
  metas.set(threadId, { projectId, meta: next })
  const r = await gw.call<any>("profiles.configure", { name: projectId, ui_meta: { [PREFIX + threadId]: next } })
  if (!r?.applied?.ui_meta) throw new Error("Hermes didn't save the thread's details")
}

// ---- one-time move of what older versions kept on this Mac ----------------------------

const LOCAL_THREADS = "kitab.threadPersonalities"
const LOCAL_RUNS = "runThreads"

function readLocal(key: string): Record<string, any> {
  try {
    return JSON.parse(platform().storage.get(key) ?? "{}") ?? {}
  } catch {
    return {}
  }
}
function writeLocal(key: string, value: Record<string, any>) {
  try {
    platform().storage.set(key, Object.keys(value).length ? JSON.stringify(value) : null)
  } catch {}
}

/**
 * Uploads thread metadata older versions kept in localStorage. Run threads know their
 * project; plain threads are moved once a project lists them (pass its session ids).
 */
export async function migrateLocal(projectId?: Id, sessionIds: Id[] = []) {
  const runs = readLocal(LOCAL_RUNS)
  const threads = readLocal(LOCAL_THREADS)
  const moves: { id: Id; project: Id; run?: any }[] = []
  for (const [id, v] of Object.entries(runs)) if (typeof v?.profile === "string") moves.push({ id, project: v.profile, run: v })
  if (projectId) for (const id of sessionIds) if (threads[id] && !runs[id]) moves.push({ id, project: projectId })
  if (!moves.length) return
  await Promise.all(
    moves.map(async ({ id, project, run }) => {
      const local = parse({ ...threads[id], run })
      // Already on the server (another device, or an earlier move): the server wins.
      if (local && !metas.has(id)) {
        try {
          await saveThreadMeta(project, id, local)
        } catch {
          return // keep it locally and try again next time
        }
      }
      delete threads[id]
      delete runs[id]
    }),
  )
  writeLocal(LOCAL_RUNS, runs)
  writeLocal(LOCAL_THREADS, threads)
}
