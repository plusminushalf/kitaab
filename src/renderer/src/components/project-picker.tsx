import { useMemo, useState, type ReactElement, type ReactNode } from "react"
import { Check, Loader2, Plus, Search, Settings } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { aggregateStatus, ProjectBadge, StatusPill } from "@/components/project-badge"
import { backend, projectIdFor } from "@kitab/core/backend"
import { store, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

/**
 * T3-style project switcher: a search field over the project list, each with its
 * badge and what its threads are up to. Arrow keys move, Enter switches. "New project"
 * turns the search field into a name field; Escape goes back to the list.
 */
export function ProjectPicker({
  render,
  children,
  align = "start",
}: {
  render: ReactElement
  children: ReactNode
  align?: "start" | "center" | "end"
}) {
  const projects = useStore((s) => s.projects)
  const projectId = useStore((s) => s.projectId)
  const threads = useStore((s) => s.threads)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  /** The new project's name while creating one; null shows the list. */
  const [draft, setDraft] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : projects
  }, [projects, query])

  const pick = (id: string) => {
    setOpen(false)
    if (id !== projectId) void backend.selectProject(id)
  }

  /** Opens a project's settings, switching to it first. */
  const openSettings = (id: string) => {
    setOpen(false)
    if (id !== projectId) void backend.selectProject(id)
    store.go({ kind: "project" })
  }

  const onOpenChange = (next: boolean, details?: { reason: string; cancel: () => void }) => {
    // Escape while naming a new project goes back to the list rather than closing.
    if (!next && draft !== null && details?.reason === "escape-key") {
      details.cancel()
      if (!creating) setDraft(null)
      return
    }
    setOpen(next)
    if (next) {
      setQuery("")
      setDraft(null)
      setError(null)
      setActive(Math.max(0, projects.findIndex((p) => p.id === projectId)))
    }
  }

  const startCreating = () => {
    // A search with no exact match is probably the name you want.
    const q = query.trim()
    setDraft(q && !projects.some((p) => p.name.toLowerCase() === q.toLowerCase()) ? q : "")
    setError(null)
  }

  const draftId = projectIdFor(draft ?? "")
  const taken = !!draftId && projects.some((p) => p.id === draftId)

  const create = async () => {
    if (creating || !draftId || taken) return
    setCreating(true)
    setError(null)
    try {
      await backend.createProject(draft!)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const hint = error
    ? error
    : taken
      ? `A project called ${draftId} already exists`
      : draftId && draftId !== draft?.trim()
        ? `Will be called ${draftId}. Starts with Default's model, keys and skills.`
        : "Starts with Default's model, keys and skills."

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={render}>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-72 gap-0 overflow-hidden p-0" data-over-vibrancy>
        {draft !== null ? (
          <>
            <div className="flex items-center gap-2 border-b px-3">
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={draft}
                disabled={creating}
                placeholder="New project name"
                aria-label="New project name"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
                onChange={(e) => {
                  setDraft(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void create()
                  }
                }}
              />
            </div>
            <p className={cn("px-3 pt-2 text-xs", error || taken ? "text-destructive" : "text-muted-foreground")}>
              {hint}
            </p>
            <div className="flex justify-end gap-1 p-2">
              <button
                type="button"
                disabled={creating}
                onClick={() => setDraft(null)}
                className="h-7 rounded-md px-2.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creating || !draftId || taken}
                onClick={() => void create()}
                className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {creating && <Loader2 className="size-3 animate-spin" />}
                {creating ? "Creating…" : "Create project"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                placeholder="Search projects…"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
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
                  } else if (e.key === "Enter" && shown[active]) {
                    e.preventDefault()
                    pick(shown[active].id)
                  } else if (e.key === "Enter" && query.trim()) {
                    e.preventDefault()
                    startCreating()
                  }
                }}
              />
            </div>
            <div role="listbox" className="max-h-80 overflow-y-auto p-1">
              {shown.length === 0 && (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {projects.length ? "No matching projects" : "No projects"}
                </div>
              )}
              {shown.map((p, i) => {
                const own = threads.filter((t) => t.projectId === p.id)
                const status = own.length ? aggregateStatus(own) : "idle"
                return (
                  <div
                    key={p.id}
                    role="option"
                    aria-selected={p.id === projectId}
                    onMouseMove={() => setActive(i)}
                    onClick={() => pick(p.id)}
                    className={cn(
                      "flex w-full cursor-default items-center gap-2 rounded-md py-1 pr-1 pl-2 text-left text-sm outline-none",
                      i === active && "bg-accent text-accent-foreground",
                    )}
                  >
                    <ProjectBadge name={p.name} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {status !== "done" && <StatusPill status={status} />}
                    {p.id === projectId ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
                    <button
                      type="button"
                      title={`${p.name} settings`}
                      aria-label={`${p.name} settings`}
                      onClick={(e) => {
                        e.stopPropagation()
                        openSettings(p.id)
                      }}
                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Settings className="size-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="border-t p-1">
              <button
                type="button"
                onClick={startCreating}
                className="flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <Plus className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {query.trim() && shown.length === 0 ? `New project “${query.trim()}”` : "New project"}
                </span>
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
