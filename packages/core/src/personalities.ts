import { http, toast } from "./platform"
import { gw } from "./backend"
import type { Id, Message, Personality } from "./model"
import { store } from "./store"
import { metaProject, saveThreadMeta, threadMeta } from "./thread-meta"

// Personalities, in Hermes terms:
//   library            → ui_meta["kitab.personality.<id>"] on the default profile
//   project's cast     → ui_meta["kitab.cast"] on the project's profile, plus a preset
//                        under agent.personalities.<id> in that profile's config.yaml
//   who answers a turn → the session's personality overlay (config.set personality)
// ui_meta is Hermes's client-owned key/value store on a profile; profiles.list returns it.

const PREFIX = "kitab.personality."
const CAST = "kitab.cast"
const NEUTRAL = new Set(["", "none", "default", "neutral", "all"])
const q = encodeURIComponent

/** The profile that holds the library. */
let libraryProfile = "default"

type ProfileRow = { name: string; is_default?: boolean; ui_meta?: Record<string, any> }

// ---- reading what profiles.list returned -----------------------------------------------

export function readLibrary(rows: ProfileRow[]): Personality[] {
  const home = rows.find((r) => r.is_default) ?? rows.find((r) => r.name === "default") ?? rows[0]
  libraryProfile = home?.name ?? "default"
  return Object.entries(home?.ui_meta ?? {})
    .filter(([k, v]) => k.startsWith(PREFIX) && v && typeof v === "object")
    .map(([k, v]) => ({
      id: k.slice(PREFIX.length),
      name: String(v.name || k.slice(PREFIX.length)),
      description: v.description ? String(v.description) : undefined,
      instructions: String(v.instructions ?? ""),
      skills: Array.isArray(v.skills) ? v.skills.filter((x: unknown): x is string => typeof x === "string") : undefined,
      updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : undefined,
    }))
    .sort(byName)
}

export function castOf(row: ProfileRow): Id[] {
  const cast = row.ui_meta?.[CAST]
  return Array.isArray(cast) ? cast.filter((x): x is string => typeof x === "string") : []
}

const byName = (a: Personality, b: Personality) => a.name.localeCompare(b.name)

/** Personalities added to a project, in library order. */
export function projectPersonalities(projectId: Id | null | undefined): Personality[] {
  const s = store.get()
  const ids = s.projects.find((p) => p.id === projectId)?.personalityIds ?? []
  return s.personalities.filter((p) => ids.includes(p.id))
}

// ---- writing ---------------------------------------------------------------------------

async function writeMeta(profile: string, ui_meta: Record<string, unknown>) {
  const r = await gw.call<any>("profiles.configure", { name: profile, ui_meta })
  if (!r?.applied?.ui_meta) throw new Error("Hermes didn't save it")
}

/** What Hermes injects as the session's personality overlay. */
function preset(p: Personality) {
  const lines = [`Your name is ${p.name}.`]
  if (p.description) lines.push(`Your role: ${p.description}`)
  if (p.instructions) lines.push("", p.instructions)
  if (p.skills?.length) {
    lines.push("", `Your skills: ${p.skills.join(", ")}. Open one with skill_view when a task fits it.`)
  }
  lines.push(
    "",
    "When you work out a reusable way of doing your job, save it as a skill with skill_manage. Skills you create are added to your skills.",
  )
  lines.push(
    "",
    "Several personalities can take part in this conversation. Earlier replies may have come from someone else; answer only as yourself.",
  )
  return { description: p.description ?? "", system_prompt: lines.join("\n"), managed_by: "kitab" }
}

/** Writes the personality into the project's config so Hermes can switch to it. */
function writePreset(projectId: Id, p: Personality) {
  return http().put(`/api/config?profile=${q(projectId)}`, {
    config: { agent: { personalities: { [p.id]: preset(p) } } },
    profile: projectId,
  })
}

function slug(name: string, taken: Set<string>): Id {
  let base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  if (!base) base = "personality"
  if (NEUTRAL.has(base)) base = `${base}-1`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

export type PersonalityInput = {
  name: string
  description: string
  instructions: string
  /** Leave out to keep the skills it has. */
  skills?: string[]
}

/** Creates (no id) or updates a library personality, then refreshes every project that uses it. */
export async function savePersonality(input: PersonalityInput, id?: Id): Promise<Personality> {
  const s = store.get()
  const name = input.name.trim()
  if (!name) throw new Error("Give it a name")
  const finalId = id ?? slug(name, new Set(s.personalities.map((p) => p.id)))
  const skills = [...new Set(input.skills ?? s.personalities.find((x) => x.id === finalId)?.skills ?? [])]
  const p: Personality = {
    id: finalId,
    name,
    description: input.description.trim() || undefined,
    instructions: input.instructions.trim(),
    skills: skills.length ? skills : undefined,
    updatedAt: Date.now(),
  }
  await writeMeta(libraryProfile, {
    [PREFIX + finalId]: {
      name: p.name,
      description: p.description ?? "",
      instructions: p.instructions,
      skills,
      updatedAt: p.updatedAt,
    },
  })
  store.set((st) => ({ personalities: [...st.personalities.filter((x) => x.id !== finalId), p].sort(byName) }))

  const using = store.get().projects.filter((pr) => pr.personalityIds?.includes(finalId))
  const failed: string[] = []
  await Promise.all(using.map((pr) => writePreset(pr.id, p).catch(() => failed.push(pr.name))))
  if (failed.length) toast.warning(`Saved, but couldn't update ${p.name} in ${failed.join(", ")}`)
  return p
}

/** Adds a personality to a project's cast, or takes it out. */
export async function setInProject(projectId: Id, personalityId: Id, on: boolean) {
  const s = store.get()
  const project = s.projects.find((p) => p.id === projectId)
  const p = s.personalities.find((x) => x.id === personalityId)
  if (!project || !p) return
  const current = project.personalityIds ?? []
  const next = on ? [...new Set([...current, personalityId])] : current.filter((x) => x !== personalityId)
  // The preset first: a cast entry Hermes can't switch to would fail on the first @mention.
  // Taking one out leaves its preset in config.yaml (a merge can't delete keys); nothing points at it.
  if (on) await writePreset(projectId, p)
  await writeMeta(projectId, { [CAST]: next })
  store.set((st) => ({ projects: st.projects.map((pr) => (pr.id === projectId ? { ...pr, personalityIds: next } : pr)) }))
}

/** Replaces the skills a personality reaches for, everywhere it works. */
export function setPersonalitySkills(personalityId: Id, skills: string[]) {
  const p = store.get().personalities.find((x) => x.id === personalityId)
  if (!p) throw new Error("That personality is gone")
  return savePersonality({ name: p.name, description: p.description ?? "", instructions: p.instructions, skills }, p.id)
}

export async function deletePersonality(personalityId: Id) {
  for (const pr of store.get().projects) {
    if (pr.personalityIds?.includes(personalityId)) await setInProject(pr.id, personalityId, false)
  }
  await writeMeta(libraryProfile, { [PREFIX + personalityId]: null })
  store.set((st) => ({ personalities: st.personalities.filter((x) => x.id !== personalityId) }))
}

// ---- threads: cast and who answered each turn (in Hermes, see thread-meta.ts) -------------

/** Personality ids in a thread; the first one is the host. */
export const threadCast = (threadId: Id): Id[] => threadMeta(threadId).cast

/** Labels each assistant turn with the personality that answered it. */
export function applySpeakers(threadId: Id, messages: Message[]): Message[] {
  const { turns } = threadMeta(threadId)
  let turn = -1
  return messages.map((m) => {
    if (m.role === "user") turn++
    else if (m.role === "assistant" && turns[turn]) return { ...m, personalityId: turns[turn] }
    return m
  })
}

// ---- mentions --------------------------------------------------------------------------

const MENTION = /(^|[\s(])@([a-z0-9][a-z0-9-]*)/gi

/** Personalities @mentioned in the text, in order. */
export function mentionsIn(text: string, candidates: Personality[]): Personality[] {
  const found: Personality[] = []
  for (const m of text.matchAll(MENTION)) {
    const p = candidates.find((c) => c.id === m[2].toLowerCase())
    if (p && !found.includes(p)) found.push(p)
  }
  return found
}

// ---- choosing who answers --------------------------------------------------------------

/**
 * Who answers a message with no @mention: whoever in the thread answered last (you're talking
 * with them), else the thread's host. The composer names them, so it must match prepareTurn.
 */
export function plainReplySpeaker(threadId: Id, cast: Id[]): Id | undefined {
  const turns = threadMeta(threadId).turns
  const latestFirst = Object.keys(turns)
    .map(Number)
    .sort((a, b) => b - a)
  for (const i of latestFirst) if (cast.includes(turns[i])) return turns[i]
  return cast[0]
}

/** The personality overlay each live session is on ("" = the project's default). Keyed by runtime id. */
const sessionPersonality = new Map<string, string>()
/** Who is answering the turn in flight, per thread. */
const speaking = new Map<Id, Id | undefined>()

const norm = (v: unknown) => {
  const s = String(v ?? "").trim().toLowerCase()
  return s === "none" || s === "default" || s === "neutral" ? "" : s
}

export function noteSession(runtimeId: string, info: any) {
  sessionPersonality.set(runtimeId, norm(info?.personality))
}
export function forgetSessions() {
  sessionPersonality.clear()
}
export const speakerFor = (threadId: Id) => speaking.get(threadId)

async function projectDefault(projectId: Id): Promise<string> {
  const r = await gw.call<{ value?: string }>("config.get", { key: "personality", profile: projectId })
  return norm(r?.value)
}

/** Puts the session on `want` ("" = project default) without changing the project's default. */
async function switchSession(runtimeId: string, projectId: Id, want: string, fallback: string) {
  const setIt = () => gw.call("config.set", { session_id: runtimeId, key: "personality", value: want || "none" })
  try {
    await setIt()
  } catch (e) {
    // The preset may be missing from this project's config (added on another Mac, or a failed sync).
    const p = store.get().personalities.find((x) => x.id === want)
    if (!p) throw e
    await writePreset(projectId, p)
    await setIt()
  }
  sessionPersonality.set(runtimeId, want)
  // config.set also saves the choice as the project's default. Put the default back.
  if (want !== fallback) {
    await http().put(`/api/config?profile=${q(projectId)}`, {
      config: { display: { personality: fallback } },
      profile: projectId,
    })
  }
}

/**
 * Before a message goes out: works out who answers (the @mentioned personality, else the
 * thread's host), switches the session to them, and remembers it for this turn.
 * Returns the thread's cast so the caller can show it.
 */
export async function prepareTurn(threadId: Id, runtimeId: string, projectId: Id, text: string): Promise<Id[]> {
  const meta = threadMeta(threadId)
  const available = projectPersonalities(projectId)
  const mentioned = mentionsIn(text, available)
  const tagged = mentioned[0]
  let cast = meta.cast.filter((id) => available.some((p) => p.id === id))
  // Everyone mentioned joins the thread, but one turn has one speaker: the first mentioned.
  for (const p of mentioned) if (!cast.includes(p.id)) cast = [...cast, p.id]
  if (mentioned.length > 1) {
    const rest = mentioned.slice(1).map((p) => p.name)
    toast(`${tagged.name} answers this message. To hear from ${rest.join(" and ")} too, @mention them in your next one.`)
  }
  let speaker: Id | undefined = tagged?.id ?? plainReplySpeaker(threadId, cast)

  // Nobody in the thread and nobody tagged: whatever the project uses answers.
  if (speaker || meta.cast.length) {
    try {
      const fallback = await projectDefault(projectId)
      const want = speaker ?? fallback
      if ((sessionPersonality.get(runtimeId) ?? fallback) !== want) await switchSession(runtimeId, projectId, want, fallback)
    } catch (e) {
      const name = available.find((p) => p.id === speaker)?.name ?? "the project default"
      toast.error(`Couldn't hand this to ${name}: ${e instanceof Error ? e.message : e}`)
      speaker = undefined
    }
  }

  const userTurns = (store.get().details[threadId]?.messages ?? []).filter((m) => m.role === "user").length
  const turns = { ...meta.turns }
  if (speaker) turns[userTurns - 1] = speaker
  const run = meta.run ? { ...meta.run, updatedAt: Date.now() } : undefined
  // Saved before the turn goes out, so another device opening the thread mid-reply sees who's answering.
  await saveThreadMeta(metaProject(threadId) ?? projectId, threadId, { cast, turns, run }).catch((e) =>
    console.warn("[thread-meta]", e),
  )
  speaking.set(threadId, speaker)
  return cast
}
