import { useState } from "react"
import { Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/page-header"
import type { Personality } from "@/lib/model"
import { deletePersonality, savePersonality, setInProject } from "@/lib/personalities"
import { useStore } from "@/lib/store"

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Your library of personalities, and which ones the current project uses. */
export function PersonalitiesView() {
  const personalities = useStore((s) => s.personalities)
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const connected = useStore((s) => s.connection.state === "connected")
  // null: closed · "new": creating · otherwise the personality being edited
  const [editing, setEditing] = useState<Personality | "new" | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = async (p: Personality, on: boolean) => {
    if (!project) return
    setBusy(p.id)
    try {
      await setInProject(project.id, p.id, on)
    } catch (e) {
      toast.error(`Couldn't ${on ? "add" : "remove"} ${p.name}: ${message(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Personalities" subtitle={project?.name}>
        {personalities.length > 0 && (
          <Button size="sm" variant="ghost" className="app-no-drag" disabled={!connected} onClick={() => setEditing("new")}>
            <Plus />
            New personality
          </Button>
        )}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {personalities.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyTitle>No personalities yet</EmptyTitle>
              <EmptyDescription>
                A personality is a character you can bring into a thread with @, like a Designer or a Coach. It brings
                the craft; the project keeps the facts.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button disabled={!connected} onClick={() => setEditing("new")}>
                <Plus />
                Create a personality
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3 p-6">
            <p className="text-sm text-muted-foreground">
              Turn one on to use it in {project?.name ?? "this project"}. In a thread, type @ and its name.
            </p>
            <ItemGroup className="gap-2">
              {personalities.map((p) => {
                const inProject = Boolean(project?.personalityIds?.includes(p.id))
                return (
                  <Item key={p.id} variant="outline">
                    <ItemContent>
                      <ItemTitle>
                        {p.name}
                        <span className="font-mono text-xs font-normal text-muted-foreground">@{p.id}</span>
                      </ItemTitle>
                      {p.description && <ItemDescription className="line-clamp-2">{p.description}</ItemDescription>}
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        aria-label={`Edit ${p.name}`}
                        title="Edit"
                        onClick={() => setEditing(p)}
                      >
                        <Pencil />
                      </Button>
                      <Switch
                        checked={inProject}
                        disabled={!project || !connected || busy === p.id}
                        onCheckedChange={(on) => void toggle(p, on)}
                        aria-label={`Use ${p.name} in ${project?.name ?? "this project"}`}
                        title={inProject ? `In ${project?.name}` : `Add to ${project?.name}`}
                      />
                    </ItemActions>
                  </Item>
                )
              })}
            </ItemGroup>
          </div>
        )}
      </div>
      {editing !== null && (
        <PersonalityDialog
          personality={editing === "new" ? null : editing}
          projectName={project?.name}
          projectId={project?.id}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function PersonalityDialog({
  personality,
  projectId,
  projectName,
  onClose,
}: {
  personality: Personality | null
  projectId?: string
  projectName?: string
  onClose: () => void
}) {
  const [name, setName] = useState(personality?.name ?? "")
  const [description, setDescription] = useState(personality?.description ?? "")
  const [instructions, setInstructions] = useState(personality?.instructions ?? "")
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isNew = personality === null

  const save = async () => {
    setSaving(true)
    try {
      const p = await savePersonality({ name, description, instructions }, personality?.id)
      // A new personality joins the project you made it in.
      if (isNew && projectId) {
        await setInProject(projectId, p.id, true).catch((e) => toast.error(`Saved, but couldn't add it to ${projectName}: ${message(e)}`))
      }
      toast.success(isNew ? `Created ${p.name}. Tag it with @${p.id}` : `Saved ${p.name}`)
      onClose()
    } catch (e) {
      toast.error(message(e))
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!personality) return
    setSaving(true)
    try {
      await deletePersonality(personality.id)
      toast(`Deleted ${personality.name}`)
      onClose()
    } catch (e) {
      toast.error(`Couldn't delete ${personality.name}: ${message(e)}`)
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "New personality" : `Edit ${personality.name}`}</DialogTitle>
          <DialogDescription>
            Describe who it is and how it works. Keep project facts out; the project keeps those.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && !saving) void save()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="personality-name">Name</Label>
            <Input
              id="personality-name"
              value={name}
              autoFocus
              placeholder="Designer"
              onChange={(e) => setName(e.target.value)}
            />
            {!isNew && <p className="text-xs text-muted-foreground">Still tagged as @{personality.id}.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="personality-description">What it's for</Label>
            <Input
              id="personality-description"
              value={description}
              placeholder="Product and visual design, with strong opinions"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="personality-instructions">Instructions</Label>
            <Textarea
              id="personality-instructions"
              value={instructions}
              rows={8}
              className="max-h-[40vh] min-h-40"
              placeholder={
                "You are a senior product designer.\n- Push for the simplest layout that works.\n- Say what you'd cut.\n- Show options as short lists, not essays."
              }
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
          <DialogFooter className="sm:justify-between">
            {isNew ? (
              <span />
            ) : confirmDelete ? (
              <Button type="button" variant="destructive" disabled={saving} onClick={() => void remove()}>
                Delete from every project
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="text-destructive" disabled={saving} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || saving}>
                {isNew ? "Create" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
