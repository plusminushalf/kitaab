import { useEffect, useMemo, useState } from "react"
import { Check, Copy, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { Id, Personality, Profile, Skill } from "@kitab/core/model"
import { setPersonalitySkills } from "@kitab/core/personalities"
import { copySkill, createSkill, DESCRIPTION_LIMIT, findSkill, loadSkills, skillSlug } from "@kitab/core/skills"
import { store, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A personality's skills, each marked by how it stands in the profile. */
export function SkillBadges({ names, skills }: { names: string[]; skills?: Skill[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n) => {
        const s = skills?.find((x) => x.name === n)
        const state = !skills ? "loading" : !s ? "missing" : s.enabled ? "ok" : "off"
        return (
          <Badge
            key={n}
            variant={state === "ok" || state === "loading" ? "secondary" : "outline"}
            className={cn("font-normal", (state === "missing" || state === "off") && "text-muted-foreground")}
            title={
              state === "missing" ? "Not installed in this profile" : state === "off" ? "Turned off in this profile" : s?.description
            }
          >
            {n}
            {state === "missing" && <span className="text-warning-foreground">· not here</span>}
            {state === "off" && <span>· off</span>}
          </Badge>
        )
      })}
    </div>
  )
}

/**
 * Pick skills from what's in the profile, copy in ones it's missing, or write a new one.
 * Renders inside a DialogContent; hands the picked names back on Done.
 */
export function SkillPicker({
  title,
  profile,
  initial,
  onDone,
  onCancel,
}: {
  title: string
  profile: Profile
  initial: string[]
  onDone: (picked: string[]) => void
  onCancel: () => void
}) {
  const skills = useStore((s) => s.skills[profile.id])
  const profiles = useStore((s) => s.profiles)
  const [picked, setPicked] = useState<string[]>(initial)
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<"pick" | "new">("pick")
  /** Missing skill → the profile it can be copied from (null: nowhere). */
  const [elsewhere, setElsewhere] = useState<Record<string, Id | null>>({})

  useEffect(() => {
    if (skills) return
    loadSkills(profile.id).catch((e) => toast.error(`Couldn't load skills: ${message(e)}`))
  }, [profile.id, Boolean(skills)])

  const missing = picked.filter((n) => skills && !skills.some((s) => s.name === n))
  const missingKey = missing.join(",")
  useEffect(() => {
    for (const n of missingKey ? missingKey.split(",") : []) {
      if (n in elsewhere) continue
      void findSkill(n, profile.id).then((from) => setElsewhere((m) => ({ ...m, [n]: from ?? null })))
    }
  }, [missingKey, profile.id])

  const list = useMemo(() => {
    const t = query.trim().toLowerCase()
    const all = (skills ?? []).filter((s) => !t || s.name.includes(t) || s.description.toLowerCase().includes(t))
    // Theirs first, then what was made here, then the rest.
    const rank = (s: Skill) => (picked.includes(s.name) ? 0 : s.source === "made" ? 1 : 2)
    return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    // Not keyed on `picked`: rows keep their place while you tick them.
  }, [skills, query])

  const toggle = (n: string) => setPicked((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]))

  const copyHere = async (n: string, from: Id) => {
    try {
      await copySkill(n, from, profile.id)
      toast.success(`Copied ${n} into ${profile.name}`)
    } catch (e) {
      toast.error(`Couldn't copy ${n}: ${message(e)}`)
    }
  }

  if (mode === "new")
    return (
      <NewSkillForm
        profile={profile}
        cancelLabel="Back"
        onDone={(created) => {
          if (created) setPicked((cur) => [...new Set([...cur, created])])
          setMode("pick")
        }}
      />
    )

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>It reaches for these when a task fits. They go with it to every profile it joins.</DialogDescription>
      </DialogHeader>
      {missing.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-dashed p-2.5">
          <span className="text-xs text-muted-foreground">Not installed in {profile.name}</span>
          {missing.map((n) => {
            const from = elsewhere[n]
            const fromName = profiles.find((x) => x.id === from)?.name
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
          placeholder={`Search skills in ${profile.name}…`}
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
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {query.trim() ? "No matching skills." : `No skills in ${profile.name} yet.`}
          </p>
        )}
        {list.map((s) => {
          const on = picked.includes(s.name)
          return (
            <button
              key={s.name}
              type="button"
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
        <Button type="button" variant="ghost" onClick={() => setMode("new")}>
          <Plus />
          New skill
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onDone(picked)}>
            Done
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

/**
 * Writes a new skill into the profile. Offers to hand it to `giveTo` personalities;
 * leave that out when the caller takes the new name from onDone.
 */
export function NewSkillForm({
  profile,
  giveTo = [],
  cancelLabel = "Cancel",
  onDone,
}: {
  profile: Profile
  giveTo?: Personality[]
  cancelLabel?: string
  onDone: (created?: string) => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [body, setBody] = useState("")
  const [givenTo, setGivenTo] = useState<Id[]>([])
  const [saving, setSaving] = useState(false)
  const slug = skillSlug(name)
  const tooLong = description.trim().length > DESCRIPTION_LIMIT
  const ready = Boolean(slug && description.trim() && body.trim() && !tooLong)

  const submit = async () => {
    setSaving(true)
    try {
      const created = await createSkill(profile.id, { name, description, body })
      for (const id of givenTo) {
        const p = store.get().personalities.find((x) => x.id === id)
        if (p) await setPersonalitySkills(id, [...(p.skills ?? []), created])
      }
      await loadSkills(profile.id).catch(() => {})
      toast.success(`Added ${created} to ${profile.name}`)
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
          A skill is a written procedure: how to do one thing well. It's saved in {profile.name}.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (ready && !saving) void submit()
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-name">Name</Label>
          <Input id="skill-name" value={name} autoFocus placeholder="Design critique" onChange={(e) => setName(e.target.value)} />
          {slug && (
            <p className="text-xs text-muted-foreground">
              Saved as <span className="font-mono">{slug}</span>
            </p>
          )}
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
            placeholder={"1. Check the screen against the profile's design standards.\n2. List what to cut, most important first.\n3. Suggest at most three changes."}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        {giveTo.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>Give it to</Label>
            <div className="flex flex-wrap gap-1.5">
              {giveTo.map((p) => {
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
            {cancelLabel}
          </Button>
          <Button type="submit" disabled={!ready || saving}>
            Create
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
