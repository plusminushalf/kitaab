import { http, toast } from "./platform"
import type { Id, Skill } from "./model"
import { setPersonalitySkills } from "./personalities"
import { store } from "./store"

// Skills, in Hermes terms:
//   a project's skills      → the skills installed in that project's profile (/api/skills?profile=)
//   off in a project        → skills.disabled in that profile's config.yaml
//   a personality's skills  → names in its library entry (personalities.ts); a hint in its
//                             preset, not a filter: Hermes has no per-personality skill scoping.

const q = encodeURIComponent
const SOURCE: Record<string, Skill["source"]> = { agent: "made", hub: "installed", external: "shared", bundled: "builtin" }
/** What Hermes accepts for a new skill's description: one short sentence (SKILL_PROMPT_DESC_LIMIT). */
export const DESCRIPTION_LIMIT = 60

const byName = (a: Skill, b: Skill) => a.name.localeCompare(b.name)

function toSkill(r: any): Skill {
  return {
    name: String(r.name),
    description: String(r.description ?? ""),
    category: r.category ? String(r.category) : undefined,
    enabled: r.enabled !== false,
    source: SOURCE[r.provenance] ?? "made",
    usage: typeof r.usage === "number" ? r.usage : undefined,
  }
}

function put(projectId: Id, skills: Skill[]) {
  store.set((s) => ({ skills: { ...s.skills, [projectId]: skills } }))
}

/** Reads the skills installed in a project. */
export async function loadSkills(projectId: Id): Promise<Skill[]> {
  const rows = await http().get<any[]>(`/api/skills?profile=${q(projectId)}`)
  const skills = (Array.isArray(rows) ? rows : []).filter((r) => r?.name).map(toSkill).sort(byName)
  put(projectId, skills)
  return skills
}

export async function setSkillEnabled(projectId: Id, name: string, enabled: boolean) {
  await http().put(`/api/skills/toggle?profile=${q(projectId)}`, { name, enabled, profile: projectId })
  put(
    projectId,
    (store.get().skills[projectId] ?? []).map((s) => (s.name === name ? { ...s, enabled } : s)),
  )
}

/** The skill's SKILL.md, frontmatter included. */
export async function readSkill(projectId: Id, name: string): Promise<string> {
  const r = await http().get<{ content: string }>(
    `/api/skills/content?name=${q(name)}&profile=${q(projectId)}`,
  )
  return r.content
}

/** Rewrites a skill's SKILL.md. */
export async function saveSkill(projectId: Id, name: string, content: string) {
  await http().put(`/api/skills/content?profile=${q(projectId)}`, { name, content, profile: projectId })
  await loadSkills(projectId).catch(() => {})
}

/** A skill name Hermes accepts: lowercase letters, digits, and . _ - */
export function skillSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-z0-9]+|[-._]+$/g, "")
    .slice(0, 64)
}

export type NewSkill = { name: string; description: string; body: string }

/** Writes a new skill into the project. Resolves to its name. */
export async function createSkill(projectId: Id, input: NewSkill): Promise<string> {
  const name = skillSlug(input.name)
  if (!name) throw new Error("Give it a name")
  const description = input.description.trim()
  if (!description) throw new Error("Say when to use it")
  if (!input.body.trim()) throw new Error("Write the steps")
  // JSON strings are valid YAML, so quoting is never a problem.
  const content = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${input.body.trim()}\n`
  await post(projectId, name, content)
  return name
}

function post(projectId: Id, name: string, content: string, category?: string) {
  return http().post(`/api/skills?profile=${q(projectId)}`, {
    name,
    content,
    category: category ?? null,
    profile: projectId,
  })
}

/** Where else a skill is installed, for one missing from this project. */
export async function findSkill(name: string, except: Id): Promise<Id | undefined> {
  const others = store.get().projects.filter((p) => p.id !== except)
  // Check what's already loaded before asking the server.
  const loaded = others.find((p) => store.get().skills[p.id]?.some((s) => s.name === name))
  if (loaded) return loaded.id
  const found = await Promise.all(
    others
      .filter((p) => !store.get().skills[p.id])
      .map((p) =>
        loadSkills(p.id)
          .then((list) => (list.some((s) => s.name === name) ? p.id : undefined))
          .catch(() => undefined),
      ),
  )
  return found.find(Boolean)
}

/** Copies a skill's SKILL.md from one project to another. Files next to it stay behind. */
export async function copySkill(name: string, from: Id, to: Id) {
  const content = await readSkill(from, name)
  const category = store.get().skills[from]?.find((s) => s.name === name)?.category
  await post(to, name, content, category)
  await loadSkills(to)
}

// ---- skills a personality makes while it works -----------------------------------------

/** Skill names a turn tried to create, per thread, until the turn ends. */
const created = new Map<Id, Set<string>>()

/** From a tool.start event: notes skill_manage creating a skill. */
export function noteToolStart(threadId: Id, name: string | undefined, args: any) {
  if (name !== "skill_manage" || args?.action !== "create" || typeof args?.name !== "string") return
  const set = created.get(threadId) ?? new Set<string>()
  set.add(args.name)
  created.set(threadId, set)
}

/**
 * When a turn ends: skills the answering personality created become its skills.
 * Checks the project first, since a create can fail or be turned down at approval.
 */
export async function claimCreatedSkills(threadId: Id, projectId: Id, personalityId: Id | undefined) {
  const names = created.get(threadId)
  created.delete(threadId)
  if (!names?.size) return
  const installed = await loadSkills(projectId).catch(() => null)
  const p = store.get().personalities.find((x) => x.id === personalityId)
  if (!installed || !p) return
  const fresh = [...names].filter((n) => installed.some((s) => s.name === n) && !p.skills?.includes(n))
  if (!fresh.length) return
  try {
    await setPersonalitySkills(p.id, [...(p.skills ?? []), ...fresh])
    toast.success(`${p.name} made ${fresh.length === 1 ? "a new skill" : "new skills"}: ${fresh.join(", ")}`)
  } catch (e) {
    toast.error(`Couldn't add ${fresh.join(", ")} to ${p.name}: ${e instanceof Error ? e.message : e}`)
  }
}
