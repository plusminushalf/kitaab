import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Check, ChevronDown, Copy, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/page-header"
import type { Id, Personality, Project, Skill } from "@/lib/model"
import { setPersonalitySkills } from "@/lib/personalities"
import {
  copySkill,
  createSkill,
  DESCRIPTION_LIMIT,
  findSkill,
  loadSkills,
  readSkill,
  saveSkill,
  setSkillEnabled,
  skillSlug,
} from "@/lib/skills"
import { store, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const GROUPS: { source: Skill["source"]; title: string }[] = [
  { source: "made", title: "Made in this project" },
  { source: "installed", title: "Installed" },
  { source: "shared", title: "Shared folders" },
  { source: "builtin", title: "Built into Hermes" },
]

/** The current project's configuration: its skills, and which ones each personality reaches for. */
export function ProjectView() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const connected = useStore((s) => s.connection.state === "connected")
  const skills = useStore((s) => (project ? s.skills[project.id] : undefined))
  const library = useStore((s) => s.personalities)
  const cast = useMemo(() => library.filter((p) => project?.personalityIds?.includes(p.id)), [library, project])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [showBuiltin, setShowBuiltin] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<Id | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!project || !connected) return
    setLoading(true)
    loadSkills(project.id)
      .catch((e) => toast.error(`Couldn't load skills: ${message(e)}`))
      .finally(() => setLoading(false))
  }, [project?.id, connected])

  /** Skill name → the cast members who reach for it. */
  const usedBy = useMemo(() => {
    const m = new Map<string, Personality[]>()
    for (const p of cast) for (const n of p.skills ?? []) m.set(n, [...(m.get(n) ?? []), p])
    return m
  }, [cast])

  const shown = useMemo(() => {
    const t = query.trim().toLowerCase()
    const list = skills ?? []
    return t ? list.filter((s) => s.name.includes(t) || s.description.toLowerCase().includes(t)) : list
  }, [skills, query])

  if (!project)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Project" />
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Project" subtitle={project.name}>
        <Button size="sm" variant="ghost" className="app-no-drag" disabled={!connected} onClick={() => setCreating(true)}>
          <Plus />
          New skill
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col p-6">
          <Section
            title="Personalities"
            count={cast.length}
            hint={`A personality's skills go with it to every project it joins. Everyone in ${project.name} can open any skill that's on.`}
          >
            {cast.length === 0 ? (
              <div className="flex flex-col items-start gap-2 px-4 py-4 text-sm text-muted-foreground">
                No personalities in {project.name} yet.
                <Button size="sm" variant="outline" onClick={() => store.go({ kind: "personalities" })}>
                  Add personalities
                </Button>
              </div>
            ) : (
              cast.map((p) => (
                <CastRow key={p.id} personality={p} skills={skills} onChoose={() => setChoosing(p.id)} />
              ))
            )}
          </Section>
          <div className="mb-3 flex items-center gap-2 rounded-lg border px-2.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              placeholder="Search skills…"
              className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
              onChange={(e) => setQuery(e.target.value)}
            />
            {loading && <Spinner className="size-3.5 text-muted-foreground" />}
          </div>

          {skills && shown.length === 0 && (
            <p className="px-1 pb-8 text-sm text-muted-foreground">
              {query.trim() ? "No matching skills." : "No skills in this project yet."}
            </p>
          )}

          {GROUPS.map(({ source, title }) => {
            const rows = shown.filter((s) => s.source === source)
            if (!rows.length) return null
            const collapsed = source === "builtin" && !showBuiltin && !query.trim()
            return (
              <Section
                key={source}
                title={title}
                count={rows.length}
                action={
                  source === "builtin" && !query.trim() ? (
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowBuiltin((v) => !v)}
                    >
                      {showBuiltin ? "Hide" : "Show"}
                      <ChevronDown className={cn("size-3 transition-transform", showBuiltin && "rotate-180")} />
                    </button>
                  ) : undefined
                }
              >
                {!collapsed &&
                  rows.map((s) => (
                    <SkillRow
                      key={s.name}
                      skill={s}
                      projectId={project.id}
                      usedBy={usedBy.get(s.name)}
                      disabled={!connected}
                      onOpen={() => setViewing(s.name)}
                    />
                  ))}
              </Section>
            )
          })}
        </div>
      </div>

      {viewing && (
        <SkillSheet
          name={viewing}
          project={project}
          cast={cast}
          onClose={() => setViewing(null)}
        />
      )}
      {choosing && (
        <PersonalitySkillsDialog
          personalityId={choosing}
          project={project}
          onClose={() => setChoosing(null)}
        />
      )}
      {creating && (
        <Dialog open onOpenChange={(open) => !open && setCreating(false)}>
          <DialogContent className="sm:max-w-lg">
            <NewSkillForm project={project} cast={cast} onDone={() => setCreating(false)} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function Section({
  title,
  count,
  action,
  hint,
  children,
}: {
  title: string
  count?: number
  action?: ReactNode
  hint?: string
  children: ReactNode
}) {
  const empty = Array.isArray(children) ? children.every((c) => !c) : !children
  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-baseline gap-2 px-1 text-xs font-medium text-muted-foreground">
        {title}
        {count != null && <span className="text-muted-foreground/70 tabular-nums">{count}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </h2>
      {!empty && <div className="divide-y overflow-hidden rounded-xl border bg-card">{children}</div>}
      {hint && <p className="mt-2 px-1 text-xs text-muted-foreground">{hint}</p>}
    </section>
  )
}

/** A personality in the cast, with the skills it reaches for and how each one stands here. */
function CastRow({ personality: p, skills, onChoose }: { personality: Personality; skills?: Skill[]; onChoose: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm font-medium">
          {p.name}
          <span className="font-mono text-xs font-normal text-muted-foreground">@{p.id}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {!p.skills?.length && <span className="text-xs text-muted-foreground">No skills yet</span>}
          {p.skills?.map((n) => {
            const s = skills?.find((x) => x.name === n)
            const state = !skills ? "loading" : !s ? "missing" : s.enabled ? "ok" : "off"
            return (
              <Badge
                key={n}
                variant={state === "ok" || state === "loading" ? "secondary" : "outline"}
                className={cn("font-normal", (state === "missing" || state === "off") && "text-muted-foreground")}
                title={
                  state === "missing"
                    ? "Not installed in this project"
                    : state === "off"
                      ? "Turned off in this project"
                      : s?.description
                }
              >
                {n}
                {state === "missing" && <span className="text-warning-foreground">· not here</span>}
                {state === "off" && <span>· off</span>}
              </Badge>
            )
          })}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onChoose}>
        Choose skills
      </Button>
    </div>
  )
}

function SkillRow({
  skill: s,
  projectId,
  usedBy,
  disabled,
  onOpen,
}: {
  skill: Skill
  projectId: Id
  usedBy?: Personality[]
  disabled: boolean
  onOpen: () => void
}) {
  const [busy, setBusy] = useState(false)
  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      await setSkillEnabled(projectId, s.name, on)
    } catch (e) {
      toast.error(`Couldn't turn ${s.name} ${on ? "on" : "off"}: ${message(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const meta = [usedBy?.length ? `Used by ${usedBy.map((p) => p.name).join(", ")}` : null, s.category]
    .filter(Boolean)
    .join(" · ")
  return (
    <div className="flex items-center gap-3 pr-4">
      <button
        onClick={onOpen}
        className="min-w-0 flex-1 px-4 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
      >
        <div className={cn("truncate text-sm font-medium", !s.enabled && "text-muted-foreground")}>{s.name}</div>
        <div className="truncate text-xs text-muted-foreground">{s.description}</div>
        {meta && <div className="truncate text-xs text-muted-foreground/80">{meta}</div>}
      </button>
      <Switch
        checked={s.enabled}
        disabled={disabled || busy}
        onCheckedChange={(on) => void toggle(on)}
        aria-label={`${s.enabled ? "Turn off" : "Turn on"} ${s.name}`}
        title={s.enabled ? "On in this project" : "Off in this project"}
      />
    </div>
  )
}

/** One skill: what it says (editable when it was made here) and who reaches for it. */
function SkillSheet({ name, project, cast, onClose }: { name: string; project: Project; cast: Personality[]; onClose: () => void }) {
  const skill = useStore((s) => s.skills[project.id]?.find((x) => x.name === name))
  const [content, setContent] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const editable = skill?.source === "made"

  useEffect(() => {
    let live = true
    readSkill(project.id, name)
      .then((c) => {
        if (!live) return
        setContent(c)
        setDraft(c)
      })
      .catch((e) => toast.error(`Couldn't open ${name}: ${message(e)}`))
    return () => {
      live = false
    }
  }, [project.id, name])

  const save = async () => {
    setSaving(true)
    try {
      await saveSkill(project.id, name, draft)
      setContent(draft)
      toast.success(`Saved ${name}`)
    } catch (e) {
      toast.error(message(e))
    } finally {
      setSaving(false)
    }
  }

  const assign = async (p: Personality, on: boolean) => {
    const next = on ? [...(p.skills ?? []), name] : (p.skills ?? []).filter((n) => n !== name)
    try {
      await setPersonalitySkills(p.id, next)
    } catch (e) {
      toast.error(`Couldn't update ${p.name}: ${message(e)}`)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && !saving && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="font-mono">{name}</SheetTitle>
          <SheetDescription>
            {skill?.description}
            {!editable && skill && (
              <span className="mt-1 block text-xs">
                {skill.source === "builtin"
                  ? "Built into Hermes. Read only here."
                  : skill.source === "installed"
                    ? "Installed from a skills hub. Read only here."
                    : "From a shared folder. Read only here."}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {cast.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Who reaches for it</Label>
              <div className="flex flex-wrap gap-1.5">
                {cast.map((p) => {
                  const on = Boolean(p.skills?.includes(name))
                  return (
                    <Button
                      key={p.id}
                      size="sm"
                      variant={on ? "secondary" : "outline"}
                      aria-pressed={on}
                      onClick={() => void assign(p, !on)}
                    >
                      {on && <Check />}
                      {p.name}
                    </Button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <Label htmlFor="skill-content">SKILL.md</Label>
            {content === null ? (
              <div className="flex flex-1 items-center justify-center py-10">
                <Spinner className="text-muted-foreground" />
              </div>
            ) : (
              <Textarea
                id="skill-content"
                value={draft}
                readOnly={!editable}
                spellCheck={false}
                className="min-h-80 flex-1 font-mono text-xs md:text-xs [field-sizing:fixed]"
                onChange={(e) => setDraft(e.target.value)}
              />
            )}
          </div>
        </div>
        {editable && (
          <SheetFooter className="flex-row justify-end border-t">
            <Button variant="outline" disabled={saving || draft === content} onClick={() => setDraft(content ?? "")}>
              Revert
            </Button>
            <Button disabled={saving || content === null || draft === content} onClick={() => void save()}>
              Save
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Pick the skills a personality reaches for, from what's in this project, or write a new one. */
function PersonalitySkillsDialog({ personalityId, project, onClose }: { personalityId: Id; project: Project; onClose: () => void }) {
  const p = useStore((s) => s.personalities.find((x) => x.id === personalityId))
  const skills = useStore((s) => s.skills[project.id])
  const projects = useStore((s) => s.projects)
  const [picked, setPicked] = useState<string[]>(p?.skills ?? [])
  const [query, setQuery] = useState("")
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<"pick" | "new">("pick")
  /** Missing skill → the project it can be copied from (null: nowhere). */
  const [elsewhere, setElsewhere] = useState<Record<string, Id | null>>({})

  const missing = picked.filter((n) => skills && !skills.some((s) => s.name === n))
  const missingKey = missing.join(",")
  useEffect(() => {
    for (const n of missingKey ? missingKey.split(",") : []) {
      if (n in elsewhere) continue
      void findSkill(n, project.id).then((from) => setElsewhere((m) => ({ ...m, [n]: from ?? null })))
    }
  }, [missingKey, project.id])

  const list = useMemo(() => {
    const t = query.trim().toLowerCase()
    const all = (skills ?? []).filter((s) => !t || s.name.includes(t) || s.description.toLowerCase().includes(t))
    // Theirs first, then what was made here, then the rest.
    const rank = (s: Skill) => (picked.includes(s.name) ? 0 : s.source === "made" ? 1 : 2)
    return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    // Not keyed on `picked`: rows keep their place while you tick them.
  }, [skills, query])

  if (!p) return null
  const toggle = (n: string) => setPicked((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]))

  const save = async () => {
    setSaving(true)
    try {
      await setPersonalitySkills(p.id, picked)
      onClose()
    } catch (e) {
      toast.error(message(e))
      setSaving(false)
    }
  }

  const copyHere = async (n: string, from: Id) => {
    try {
      await copySkill(n, from, project.id)
      toast.success(`Copied ${n} into ${project.name}`)
    } catch (e) {
      toast.error(`Couldn't copy ${n}: ${message(e)}`)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {mode === "new" ? (
          <NewSkillForm
            project={project}
            cast={[p]}
            assignTo={p.id}
            onDone={(created) => {
              if (created) setPicked((cur) => [...new Set([...cur, created])])
              setMode("pick")
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{p.name}'s skills</DialogTitle>
              <DialogDescription>
                {p.name} reaches for these when a task fits. They go with it to every project it joins.
              </DialogDescription>
            </DialogHeader>
            {missing.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-dashed p-2.5">
                <span className="text-xs text-muted-foreground">Not installed in {project.name}</span>
                {missing.map((n) => {
                  const from = elsewhere[n]
                  const fromName = projects.find((x) => x.id === from)?.name
                  return (
                    <div key={n} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{n}</span>
                      {from && (
                        <Button
                          size="xs"
                          variant="outline"
                          title="Copies its SKILL.md. Files next to it stay where they are."
                          onClick={() => void copyHere(n, from)}
                        >
                          <Copy />
                          Copy from {fromName}
                        </Button>
                      )}
                      {from === undefined && <Spinner className="size-3 text-muted-foreground" />}
                      <Button size="xs" variant="ghost" onClick={() => toggle(n)}>
                        Remove
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex items-center gap-2 rounded-lg border px-2.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                placeholder="Search skills…"
                className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div role="listbox" aria-multiselectable className="-mx-1 max-h-80 overflow-y-auto">
              {!skills && (
                <div className="flex justify-center py-6">
                  <Spinner className="text-muted-foreground" />
                </div>
              )}
              {skills && list.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">No matching skills.</p>
              )}
              {list.map((s) => {
                const on = picked.includes(s.name)
                return (
                  <button
                    key={s.name}
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(s.name)}
                    className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                        on && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", !s.enabled && "text-muted-foreground")}>
                        {s.name}
                        {!s.enabled && <span className="text-xs"> · off here</span>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{s.description}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="ghost" disabled={saving} onClick={() => setMode("new")}>
                <Plus />
                New skill
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                  Cancel
                </Button>
                <Button disabled={saving} onClick={() => void save()}>
                  Save
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Writes a new skill into the project and hands it to personalities: assignTo, or
 * whichever cast members you pick here.
 */
function NewSkillForm({
  project,
  cast,
  assignTo,
  onDone,
}: {
  project: Project
  cast: Personality[]
  assignTo?: Id
  onDone: (created?: string) => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [body, setBody] = useState("")
  const [givenTo, setGivenTo] = useState<Id[]>(assignTo ? [assignTo] : [])
  const [saving, setSaving] = useState(false)
  const slug = skillSlug(name)
  const tooLong = description.trim().length > DESCRIPTION_LIMIT
  const ready = Boolean(slug && description.trim() && body.trim() && !tooLong)

  const submit = async () => {
    setSaving(true)
    try {
      const created = await createSkill(project.id, { name, description, body })
      for (const id of givenTo) {
        const p = store.get().personalities.find((x) => x.id === id)
        if (p) await setPersonalitySkills(id, [...(p.skills ?? []), created])
      }
      toast.success(`Added ${created} to ${project.name}`)
      onDone(created)
    } catch (e) {
      toast.error(message(e))
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New skill</DialogTitle>
        <DialogDescription>
          A skill is a written procedure: how to do one thing well. It's saved in {project.name}.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !saving) void submit()
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-name">Name</Label>
          <Input id="skill-name" value={name} autoFocus placeholder="Design critique" onChange={(e) => setName(e.target.value)} />
          {slug && <p className="text-xs text-muted-foreground">Saved as <span className="font-mono">{slug}</span></p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-description">When to use it</Label>
          <Input
            id="skill-description"
            value={description}
            aria-invalid={tooLong || undefined}
            placeholder="Critique a screen before it ships."
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className={cn("text-xs text-muted-foreground", tooLong && "text-destructive")}>
            One short sentence, {description.trim().length}/{DESCRIPTION_LIMIT}. Agents pick skills by this line.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-body">Steps</Label>
          <Textarea
            id="skill-body"
            value={body}
            rows={8}
            className="max-h-[40vh] min-h-40"
            placeholder={"1. Check the screen against the project's design standards.\n2. List what to cut, most important first.\n3. Suggest at most three changes."}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        {!assignTo && cast.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>Give it to</Label>
            <div className="flex flex-wrap gap-1.5">
              {cast.map((p) => {
                const on = givenTo.includes(p.id)
                return (
                  <Button
                    key={p.id}
                    type="button"
                    size="sm"
                    variant={on ? "secondary" : "outline"}
                    aria-pressed={on}
                    onClick={() => setGivenTo((cur) => (on ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}
                  >
                    {on && <Check />}
                    {p.name}
                  </Button>
                )
              })}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onDone()}>
            {assignTo ? "Back" : "Cancel"}
          </Button>
          <Button type="submit" disabled={!ready || saving}>
            Create
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
