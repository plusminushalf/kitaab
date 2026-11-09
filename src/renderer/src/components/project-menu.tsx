import { useMemo, useState, useSyncExternalStore } from "react"
import { Check, ChevronDown, CornerDownLeft, Folder, FolderClosed, FolderPlus, Loader2, Search } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { backend } from "@kitab/core/backend"
import { homePath } from "@kitab/core/format"
import { folderNameFor } from "@kitab/core/projects"
import { platform } from "@kitab/core/platform"
import { GENERAL, type Project } from "@kitab/core/model"
import { hue } from "@/components/project-badge"
import { store, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

// Projects inside the open profile: picking where a new thread goes, and the dialogs for
// making and renaming one. The dialog lives once, in App (ProjectDialogHost); anything can open it.

type DialogState = { mode: "new" } | { mode: "rename"; project: Project } | { mode: "new-thread" } | null

let dialog: DialogState = null
const listeners = new Set<() => void>()
function setDialog(next: DialogState) {
  dialog = next
  listeners.forEach((l) => l())
}

export const openNewProject = () => setDialog({ mode: "new" })
export const openRenameProject = (project: Project) => setDialog({ mode: "rename", project })

/**
 * ⌘N and the new-thread button: asks which project the thread goes in (T3-style picker).
 * A profile with only General has nothing to ask, so it goes straight to the new thread.
 */
export function startNewThread() {
  const s = store.get()
  const projects = s.profileId ? (s.projects[s.profileId] ?? []) : []
  if (projects.length === 0) return store.go({ kind: "thread", threadId: null })
  setDialog({ mode: "new-thread" })
}

/** Takes a project off the list, after asking. Its threads move to General. */
export async function confirmRemoveProject(project: Project) {
  if (!(await platform().confirm(`Remove “${project.name}”? Its threads move to General. Its folder and threads stay on the server.`)))
    return
  try {
    await backend.removeProject(project.id)
    toast(`Removed ${project.name}`)
  } catch (e) {
    toast.error(`Couldn't remove it: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** The open profile's projects, General first. */
export function useProfileProjects(): Project[] {
  const profileId = useStore((s) => s.profileId)
  const projects = useStore((s) => (s.profileId ? s.projects[s.profileId] : undefined))
  const general: Project = { id: GENERAL, profileId: profileId ?? "", name: "General", folders: [] }
  return [general, ...(projects ?? [])]
}

/** "in General ▾" in a new thread's title bar: where the thread will go, and a menu to change it. */
export function NewThreadPlace() {
  const projects = useProfileProjects()
  const projectId = useStore((s) => s.projectId)
  const current = projects.find((p) => p.id === projectId) ?? projects[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" />
        }
      >
        <span>in {current.name}</span>
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Start it in</DropdownMenuLabel>
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => backend.selectProject(p.id)}>
              <FolderClosed />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === current.id && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={openNewProject}>
          <FolderPlus />
          New project…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Mounted once in App: the new-project and rename dialogs. */
export function ProjectDialogHost() {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => dialog,
  )
  if (!state) return null
  if (state.mode === "new-thread") return <NewThreadPicker onDone={() => setDialog(null)} />
  return (
    <Dialog open onOpenChange={(open) => !open && setDialog(null)}>
      <DialogContent className="sm:max-w-md">
        {state.mode === "new" ? (
          <NewProjectForm onDone={() => setDialog(null)} />
        ) : (
          <RenameProjectForm project={state.project} onDone={() => setDialog(null)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NewProjectForm({ onDone }: { onDone: () => void }) {
  const profileId = useStore((s) => s.profileId)
  const profileName = useStore((s) => s.profiles.find((p) => p.id === s.profileId)?.name)
  const [name, setName] = useState("")
  const [folder, setFolder] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suggested = `~/kitaab/${profileId ?? "default"}/${folderNameFor(name || "project")}`

  const create = async () => {
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await backend.createProject(name, folder.trim() || undefined)
      // A new thread in it is the next thing you'd do.
      store.go({ kind: "thread", threadId: null })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
    >
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          A project in {profileName ?? "this profile"}, with its own folder on the server. Its threads work in that folder
          and share the profile's memory, skills and personalities.
        </DialogDescription>
      </DialogHeader>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium">Name</span>
        <Input autoFocus value={name} disabled={busy} placeholder="Launch site" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium">Folder on the server</span>
        <Input
          value={folder}
          disabled={busy}
          placeholder={suggested}
          spellCheck={false}
          className="font-mono text-xs"
          onChange={(e) => setFolder(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          Leave it empty to make {suggested}. Pick an existing folder (a repo, say) to work there.
        </span>
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          {busy ? "Creating…" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function RenameProjectForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const [name, setName] = useState(project.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (busy || !name.trim()) return
    if (name.trim() === project.name) return onDone()
    setBusy(true)
    try {
      await backend.renameProject(project.id, name)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename project</DialogTitle>
        {project.folder && <DialogDescription className="font-mono text-xs break-all">{homePath(project.folder)}</DialogDescription>}
      </DialogHeader>
      <Input autoFocus value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Where a new thread goes: a search field over the open profile's projects, the current
 * one highlighted so ⌘N then Enter starts where you already are. Arrow keys move, Enter
 * starts the thread there.
 */
function NewThreadPicker({ onDone }: { onDone: () => void }) {
  const projects = useProfileProjects()
  const projectId = useStore((s) => s.projectId)
  const profileName = useStore((s) => s.profiles.find((p) => p.id === s.profileId)?.name)
  const [query, setQuery] = useState("")
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects
  }, [projects, query])
  const [active, setActive] = useState(() => Math.max(0, projects.findIndex((p) => p.id === projectId)))

  const pick = (p: Project) => {
    backend.selectProject(p.id)
    store.go({ kind: "thread", threadId: null })
    onDone()
    // Straight to typing, even when the new-thread view was already open.
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-composer-input]")?.focus())
  }
  const newProject = () => {
    onDone()
    openNewProject()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent
        showCloseButton={false}
        finalFocus={false}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-md"
        data-over-vibrancy
      >
        <DialogTitle className="sr-only">New thread in…</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            placeholder={profileName ? `New thread in… (${profileName})` : "New thread in…"}
            aria-label="Project for the new thread"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((i) => Math.min(shown.length - 1, i + 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((i) => Math.max(0, i - 1))
              } else if (e.key === "Enter") {
                e.preventDefault()
                if (shown[active]) pick(shown[active])
                else if (query.trim()) newProject()
              }
            }}
          />
        </div>
        <div role="listbox" className="max-h-80 overflow-y-auto p-1">
          {shown.length === 0 && <div className="px-2 py-6 text-center text-xs text-muted-foreground">No matching projects</div>}
          {shown.map((p, i) => (
            <div
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(p)}
              style={{ "--h": hue(p.name) } as React.CSSProperties}
              className={cn(
                "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-sm",
                i === active && "bg-accent text-accent-foreground",
              )}
            >
              <Folder className="size-4 shrink-0 fill-[oklch(0.62_0.17_var(--h)/0.28)] text-[oklch(0.55_0.17_var(--h))] dark:text-[oklch(0.76_0.14_var(--h))]" />
              <span className="min-w-0 truncate">{p.name}</span>
              {p.folder && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{homePath(p.folder)}</span>}
              {p.id === projectId && <span className="ml-auto shrink-0 text-xs text-muted-foreground">Current</span>}
              {i === active && <CornerDownLeft className={cn("size-3.5 shrink-0 text-muted-foreground", p.id !== projectId && "ml-auto")} />}
            </div>
          ))}
        </div>
        <div className="border-t p-1">
          <button
            type="button"
            onClick={newProject}
            className="flex h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FolderPlus className="size-4 shrink-0" />
            New project…
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
