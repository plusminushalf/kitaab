import { GENERAL, NO_PROJECT, type Id, type Project, type Thread } from "./model"
import { http, platform } from "./platform"
import { store } from "./store"

// Projects inside a profile. Hermes keeps them itself (projects.db in each profile, the
// projects.* gateway calls): a name, a color and one or more folders on the server.
//   Hermes project        → Project
//   session's cwd         → which project a thread is in (the project owning that folder)
//   no cwd / no owner     → General, the project every profile has (not stored in Hermes)
// A new thread in a project starts with the project's folder as its working directory, so
// Hermes, its terminal and its files all work there.

type Gw = { call<T>(method: string, params: any): Promise<T> }

function toProject(profileId: Id, p: any): Project {
  const folders: string[] = Array.isArray(p.folders)
    ? [...p.folders]
        .sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary))
        .map((f) => (typeof f === "string" ? f : f?.path))
        .filter((f): f is string => typeof f === "string" && !!f)
    : []
  const folder = (typeof p.primary_path === "string" && p.primary_path) || folders[0] || undefined
  if (folder && !folders.includes(folder)) folders.unshift(folder)
  return { id: p.id, profileId, name: p.name || p.slug || "Project", folder, folders, color: p.color || undefined }
}

/** The project picked last in each profile on this device, so switching back keeps it. */
const KEY = "kitab.project."
const localStorage_ = () => platform().storage
export function savedProject(profileId: Id): Id {
  try {
    return localStorage_().get(KEY + profileId) ?? GENERAL
  } catch {
    return GENERAL
  }
}
export function saveProject(profileId: Id, projectId: Id) {
  try {
    localStorage_().set(KEY + profileId, projectId === GENERAL ? null : projectId)
  } catch {}
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p)

/** The project owning `cwd`: the one with the deepest folder `cwd` is in. GENERAL when none does. */
export function projectFor(projects: Project[], cwd: string | undefined): Id {
  if (!cwd) return GENERAL
  const dir = trimSlash(cwd)
  let best: { id: Id; depth: number } | null = null
  for (const p of projects) {
    for (const raw of p.folders) {
      const f = trimSlash(raw)
      if (dir !== f && !dir.startsWith(f === "/" ? "/" : f + "/")) continue
      if (!best || f.length > best.depth) best = { id: p.id, depth: f.length }
    }
  }
  return best?.id ?? GENERAL
}

/** Puts each of the profile's threads in its project again (after the projects changed). */
function reassign(profileId: Id) {
  const projects = store.get().projects[profileId] ?? []
  const fix = (list: Thread[]) =>
    list.map((t) => {
      if (t.profileId !== profileId) return t
      // A thread made here before Hermes stored its folder keeps the project it was made in.
      if (!t.cwd && t.projectId !== GENERAL && projects.some((p) => p.id === t.projectId)) return t
      const projectId = projectFor(projects, t.cwd)
      return projectId === t.projectId ? t : { ...t, projectId }
    })
  store.set((s) => ({ threads: fix(s.threads), done: fix(s.done) }))
}

/** Reads a profile's projects from Hermes. */
export async function loadProjects(gw: Gw, profileId: Id): Promise<Project[]> {
  const r = await gw.call<{ projects?: any[] }>("projects.list", { profile: profileId })
  const projects = (r.projects ?? []).filter((p) => !p.archived).map((p) => toProject(profileId, p))
  store.set((s) => ({
    projects: { ...s.projects, [profileId]: projects },
    // The picked project went away (removed on another device): back to General.
    projectId: s.profileId === profileId && s.projectId !== GENERAL && !projects.some((p) => p.id === s.projectId) ? GENERAL : s.projectId,
  }))
  reassign(profileId)
  return projects
}

/** A folder name for a project: lowercase letters, digits and "-". */
export function folderNameFor(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")
      .slice(0, 64) || "project"
  )
}

/** Makes `path` on the server (and its parents). Resolves to the absolute path Hermes made. */
async function mkdir(path: string): Promise<string> {
  const r = await http().post<{ path?: string; entry?: { path?: string } }>("/api/files/mkdir", { path })
  const made = r?.entry?.path || r?.path
  return made && made.startsWith("/") ? made : path
}

export async function createProject(gw: Gw, profileId: Id, name: string, folder?: string): Promise<Project> {
  const title = name.trim()
  if (!title) throw new Error("Give the project a name")
  const taken = (store.get().projects[profileId] ?? []).some((p) => p.name.toLowerCase() === title.toLowerCase())
  if (taken || title.toLowerCase() === "general") throw new Error(`There's already a project called ${title}`)
  // Without a folder of your own, it gets one: ~/kitaab/<profile>/<project>.
  const path = await mkdir(folder?.trim() || `~/kitaab/${profileId}/${folderNameFor(title)}`)
  const r = await gw.call<{ project?: any }>("projects.create", {
    profile: profileId,
    name: title,
    folders: [path],
    primary_path: path,
  })
  if (!r.project) throw new Error("Hermes didn't make the project")
  const project = toProject(profileId, r.project)
  store.set((s) => ({ projects: { ...s.projects, [profileId]: [...(s.projects[profileId] ?? []).filter((p) => p.id !== project.id), project] } }))
  // Threads already working in that folder belong to it now.
  reassign(profileId)
  return project
}

export async function renameProject(gw: Gw, profileId: Id, id: Id, name: string) {
  const title = name.trim()
  if (!title) throw new Error("Give the project a name")
  const r = await gw.call<{ project?: any }>("projects.update", { profile: profileId, id, name: title })
  const project = r.project ? toProject(profileId, r.project) : null
  store.set((s) => ({
    projects: {
      ...s.projects,
      [profileId]: (s.projects[profileId] ?? []).map((p) => (p.id === id ? (project ?? { ...p, name: title }) : p)),
    },
  }))
}

/** Archives it in Hermes: its folder and threads stay, and the threads show in General. */
export async function removeProject(gw: Gw, profileId: Id, id: Id) {
  await gw.call("projects.archive", { profile: profileId, id })
  store.set((s) => ({
    projects: { ...s.projects, [profileId]: (s.projects[profileId] ?? []).filter((p) => p.id !== id) },
    projectId: s.profileId === profileId && s.projectId === id ? GENERAL : s.projectId,
  }))
  if (savedProject(profileId) === id) saveProject(profileId, GENERAL)
  reassign(profileId)
}

/** The project a new thread starts in: the picked one, if it's still there. */
export function currentProject(): Project | undefined {
  const s = store.get()
  if (!s.profileId || s.projectId === GENERAL) return undefined
  return s.projects[s.profileId]?.find((p) => p.id === s.projectId)
}

/** General plus the profile's projects, as the lists show them. */
export function projectsOf(profileId: Id | null): Project[] {
  const s = store.get()
  const general: Project = { id: GENERAL, profileId: profileId ?? "default", name: NO_PROJECT, folders: [] }
  return profileId ? [general, ...(s.projects[profileId] ?? [])] : [general]
}
