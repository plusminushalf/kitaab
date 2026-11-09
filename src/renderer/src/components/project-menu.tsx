import { useState, useSyncExternalStore } from "react"
import { Check, ChevronDown, FolderClosed, FolderPlus, Loader2 } from "lucide-react"
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
import { folderNameFor } from "@kitab/core/projects"
import { platform } from "@kitab/core/platform"
import { GENERAL, type Project } from "@kitab/core/model"
import { store, useStore } from "@/lib/store"

// Projects inside the open profile: picking where a new thread goes, and the dialogs for
// making and renaming one. The dialog lives once, in App (ProjectDialogHost); anything can open it.

type DialogState = { mode: "new" } | { mode: "rename"; project: Project } | null

let dialog: DialogState = null
const listeners = new Set<() => void>()
function setDialog(next: DialogState) {
  dialog = next
  listeners.forEach((l) => l())
}

export const openNewProject = () => setDialog({ mode: "new" })
export const openRenameProject = (project: Project) => setDialog({ mode: "rename", project })

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
        {project.folder && <DialogDescription className="font-mono text-xs break-all">{project.folder}</DialogDescription>}
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
