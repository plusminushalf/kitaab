import { GENERAL, type Id } from "./model"
import { gw } from "./backend"

// Which project each routine is filed under. Hermes's cron jobs have no project of their own,
// so Kitaab tags them, on the server so every device sees the same thing:
//   ui_meta["kitab.routine.<cron job id>"] = { project: <Hermes project id>, at: <ms> }
// on the routine's profile. No key: the routine is in General.
//
// Kitaab's Hermes plugin (kitaab-plugin.ts) writes the key itself when the agent makes a
// routine in a thread, using that thread's project, and its set_routine_project tool moves
// one. The app reads the keys and can move a routine too.

const PREFIX = "kitab.routine."
/** A tag whose routine is gone is dropped, but only once it's this old: a routine made a
 *  moment ago can be tagged before the job list we compare against has it. */
const ORPHAN_AFTER_MS = 60 * 60 * 1000

type ProfileRow = { name: string; ui_meta?: Record<string, any> }
type Tag = { profileId: Id; project: Id; at: number }

const tags = new Map<Id, Tag>()

/** Rebuilds the cache from what profiles.list returned. */
export function readRoutineTags(rows: ProfileRow[]) {
  tags.clear()
  for (const row of rows) {
    for (const [k, v] of Object.entries(row.ui_meta ?? {})) {
      if (!k.startsWith(PREFIX) || !v || typeof v !== "object" || typeof v.project !== "string" || !v.project) continue
      tags.set(k.slice(PREFIX.length), { profileId: row.name, project: v.project, at: typeof v.at === "number" ? v.at : 0 })
    }
  }
}

/** The project a routine is filed under; GENERAL when it has no tag. */
export const routineProject = (routineId: Id): Id => tags.get(routineId)?.project ?? GENERAL

/** Files a routine under a project (GENERAL removes the tag). */
export async function saveRoutineProject(profileId: Id, routineId: Id, projectId: Id) {
  const general = projectId === GENERAL
  if (routineProject(routineId) === projectId) return
  const value = general ? null : { project: projectId, at: Date.now() }
  const prev = tags.get(routineId)
  if (general) tags.delete(routineId)
  else tags.set(routineId, { profileId, project: projectId, at: value!.at })
  try {
    // ui_meta merges key by key; null removes the key.
    const r = await gw.call<any>("profiles.configure", { name: profileId, ui_meta: { [PREFIX + routineId]: value } })
    if (!r?.applied?.ui_meta) throw new Error("Hermes didn't save the routine's project")
  } catch (e) {
    if (prev) tags.set(routineId, prev)
    else tags.delete(routineId)
    throw e
  }
}

/** Drops tags of routines that no longer exist (pass every routine id Hermes listed). */
export async function forgetGoneRoutines(routineIds: Id[]) {
  const live = new Set(routineIds)
  const cutoff = Date.now() - ORPHAN_AFTER_MS
  const gone = new Map<Id, Record<string, null>>()
  for (const [id, tag] of tags) {
    if (live.has(id) || tag.at > cutoff) continue
    tags.delete(id)
    gone.set(tag.profileId, { ...(gone.get(tag.profileId) ?? {}), [PREFIX + id]: null })
  }
  for (const [name, ui_meta] of gone) await gw.call("profiles.configure", { name, ui_meta }).catch(() => {})
}
