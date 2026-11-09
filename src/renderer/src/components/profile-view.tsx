import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Check, ChevronDown, FolderClosed, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/page-header"
import { NewSkillForm } from "@/components/skill-picker"
import { GENERAL, type Id, type Personality, type Profile, type Skill } from "@kitab/core/model"
import { homePath } from "@kitab/core/format"
import { confirmRemoveProject, openNewProject, openRenameProject, useProfileProjects } from "@/components/project-menu"
import { setPersonalitySkills } from "@kitab/core/personalities"
import { loadSkills, readSkill, saveSkill, setSkillEnabled } from "@kitab/core/skills"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const GROUPS: { source: Skill["source"]; title: string }[] = [
  { source: "made", title: "Made in this profile" },
  { source: "installed", title: "Installed" },
  { source: "shared", title: "Shared folders" },
  { source: "builtin", title: "Built into Hermes" },
]

/** The current profile's settings: its projects and the skills installed in it. */
export function ProfileView() {
  const profile = useStore((s) => s.profiles.find((p) => p.id === s.profileId))
  const connected = useStore((s) => s.connection.state === "connected")
  const skills = useStore((s) => (profile ? s.skills[profile.id] : undefined))
  const library = useStore((s) => s.personalities)
  const cast = useMemo(() => library.filter((p) => profile?.personalityIds?.includes(p.id)), [library, profile])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [showBuiltin, setShowBuiltin] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!profile || !connected) return
    setLoading(true)
    loadSkills(profile.id)
      .catch((e) => toast.error(`Couldn't load skills: ${message(e)}`))
      .finally(() => setLoading(false))
  }, [profile?.id, connected])

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

  if (!profile)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Profile settings" />
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Profile settings" subtitle={profile.name}>
        <Button size="sm" variant="ghost" className="app-no-drag" disabled={!connected} onClick={() => setCreating(true)}>
          <Plus />
          New skill
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col p-6">
          <ProjectsSection />

          <h2 className="mb-2 px-1 text-xs font-medium text-muted-foreground">Skills</h2>
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
              {query.trim() ? "No matching skills." : "No skills in this profile yet."}
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
                      profileId={profile.id}
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
          profile={profile}
          cast={cast}
          onClose={() => setViewing(null)}
        />
      )}
      {creating && (
        <Dialog open onOpenChange={(open) => !open && setCreating(false)}>
          <DialogContent className="sm:max-w-lg">
            <NewSkillForm profile={profile} giveTo={cast} onDone={() => setCreating(false)} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

/** The profile's projects, each with its folder. */
function ProjectsSection() {
  const projects = useProfileProjects()
  const connected = useStore((s) => s.connection.state === "connected")
  return (
    <Section
      title="Projects"
      count={projects.length}
      hint="Each project has its own folder on the server, where its threads work. They all share this profile's memory, skills and personalities."
      action={
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={!connected} onClick={openNewProject}>
          <Plus className="size-3" />
          New project
        </button>
      }
    >
      {projects.map((p) => (
        <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
          <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{p.name}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">
              {p.id === GENERAL ? "Threads with no project folder" : p.folder && homePath(p.folder)}
            </div>
          </div>
          {p.id !== GENERAL && (
            <div className="flex shrink-0 gap-1">
              <Button size="xs" variant="ghost" disabled={!connected} onClick={() => openRenameProject(p)}>
                Rename
              </Button>
              <Button size="xs" variant="ghost" disabled={!connected} onClick={() => void confirmRemoveProject(p)}>
                Remove
              </Button>
            </div>
          )}
        </div>
      ))}
    </Section>
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

function SkillRow({
  skill: s,
  profileId,
  usedBy,
  disabled,
  onOpen,
}: {
  skill: Skill
  profileId: Id
  usedBy?: Personality[]
  disabled: boolean
  onOpen: () => void
}) {
  const [busy, setBusy] = useState(false)
  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      await setSkillEnabled(profileId, s.name, on)
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
        title={s.enabled ? "On in this profile" : "Off in this profile"}
      />
    </div>
  )
}

/** One skill: what it says (editable when it was made here) and who reaches for it. */
function SkillSheet({ name, profile, cast, onClose }: { name: string; profile: Profile; cast: Personality[]; onClose: () => void }) {
  const skill = useStore((s) => s.skills[profile.id]?.find((x) => x.name === name))
  const [content, setContent] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const editable = skill?.source === "made"

  useEffect(() => {
    let live = true
    readSkill(profile.id, name)
      .then((c) => {
        if (!live) return
        setContent(c)
        setDraft(c)
      })
      .catch((e) => toast.error(`Couldn't open ${name}: ${message(e)}`))
    return () => {
      live = false
    }
  }, [profile.id, name])

  const save = async () => {
    setSaving(true)
    try {
      await saveSkill(profile.id, name, draft)
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
