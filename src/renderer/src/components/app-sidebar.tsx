import { useMemo, useRef, useState } from "react"
import { Check, ChevronRight, ChevronsUpDown, ListFilter, Repeat, Search, Settings, SquarePen, Users, X } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ProjectBadge, StatusPill } from "@/components/project-badge"
import { ProjectPicker } from "@/components/project-picker"
import { StatusMark } from "@/components/routine-views"
import { backend } from "@/lib/backend"
import { store, useStore } from "@/lib/store"
import { relativeTime } from "@/lib/format"
import type { Id, Routine, Thread } from "@/lib/model"

type Sort = "activity" | "status" | "title"
const SORT_KEY = "kitab.sidebarSort"
const STATUS_RANK: Record<Thread["status"], number> = { "needs-you": 0, working: 1, idle: 2 }

function readSort(): Sort {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return v === "status" || v === "title" ? v : "activity"
  } catch {
    return "activity"
  }
}

export function AppSidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const projects = useStore((s) => s.projects)
  const projectId = useStore((s) => s.projectId)
  const allThreads = useStore((s) => s.threads)
  const view = useStore((s) => s.view)
  const connection = useStore((s) => s.connection)
  const doneCount = useStore((s) => s.doneCount)
  const [sort, setSortState] = useState<Sort>(readSort)
  const [query, setQuery] = useState("")

  const setSort = (v: Sort) => {
    setSortState(v)
    try {
      localStorage.setItem(SORT_KEY, v)
    } catch {}
  }

  const project = projects.find((p) => p.id === projectId)
  const projectThreads = useMemo(() => allThreads.filter((t) => t.projectId === projectId), [allThreads, projectId])
  const threads = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? projectThreads.filter((t) => t.title.toLowerCase().includes(q)) : [...projectThreads]
    return list.sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "status"
          ? STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.updatedAt - a.updatedAt
          : b.updatedAt - a.updatedAt,
    )
  }, [projectThreads, query, sort])
  const activeThreadId = view.kind === "thread" ? view.threadId : null
  const inRoutines = view.kind === "routines" || view.kind === "routine" || view.kind === "run"

  return (
    <Sidebar>
      {/* Clear space for the traffic lights; the strip drags the window. */}
      <div className="app-drag h-[52px] shrink-0" />
      <SidebarHeader className="pt-0">
        <div className="flex items-center gap-0.5">
          <SearchField value={query} onChange={setQuery} />
          <DropdownMenu>
            <IconTip label="Sort threads">
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-sidebar-muted-foreground" />}>
                <ListFilter />
              </DropdownMenuTrigger>
            </IconTip>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sort threads by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>
                  <DropdownMenuRadioItem value="activity">Last activity</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="title">Title</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconTip label="New thread (⌘N)">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-sidebar-muted-foreground"
              aria-label="New thread"
              onClick={() => store.go({ kind: "thread", threadId: null })}
            >
              <SquarePen />
            </Button>
          </IconTip>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-0">
          {/* Projects are Hermes profiles: switched here, not created. A label, not a row,
              so threads keep the full width. */}
          <ProjectPicker
            render={
              <button
                className="mb-0.5 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                title="Switch project"
              />
            }
          >
            {project && <ProjectBadge name={project.name} className="size-4 rounded text-[0.5rem]" />}
            <span className="min-w-0 flex-1 truncate text-left">{project?.name ?? "No project"}</span>
            <ChevronsUpDown className="size-3 shrink-0 opacity-70" />
          </ProjectPicker>
          <SidebarGroupContent>
            <SidebarMenu>
              {threads.map((t) => (
                  <SidebarMenuItem key={t.id}>
                    <SidebarMenuButton
                      isActive={t.id === activeThreadId}
                      onClick={() => store.go({ kind: "thread", threadId: t.id })}
                      title={t.title}
                      // No space is reserved for the done tick: it floats over the status on hover.
                      className="pr-2! hover:bg-sidebar-row-hover data-active:bg-sidebar-accent data-active:font-normal"
                    >
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {t.status === "idle" ? (
                        <span className="ml-auto shrink-0 text-xs text-sidebar-muted-foreground tabular-nums">
                          {relativeTime(t.updatedAt)}
                        </span>
                      ) : (
                        <StatusPill status={t.status} className="ml-auto" />
                      )}
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      // Layered over the row's end; a fading backdrop covers the status so nothing reflows.
                      className="z-10 before:pointer-events-none before:absolute before:inset-y-0 before:right-0 before:-left-12 before:-z-10 before:rounded-r-md before:bg-linear-to-l before:from-sidebar-accent before:via-sidebar-accent/90 before:to-sidebar-accent/0"
                      title="Mark as done (⇧⌘S)"
                      aria-label={`Mark “${t.title}” as done`}
                      onClick={() => void backend.setDone(t.id, true)}
                    >
                      <Check />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              {threads.length === 0 && connection.state === "connected" && (
                <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">
                  {query.trim() ? "No matching threads." : "No threads yet."}
                </p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <LatestRuns projectId={projectId} activeRoutineId={view.kind === "run" ? view.routineId : null} />

        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={inRoutines} onClick={() => store.go({ kind: "routines" })}>
                <Repeat />
                <span>Routines</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={view.kind === "personalities"}
                onClick={() => store.go({ kind: "personalities" })}
              >
                <Users />
                <span>Personalities</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {doneCount > 0 && (
              <SidebarMenuItem>
                <SidebarMenuButton isActive={view.kind === "done"} onClick={() => store.go({ kind: "done" })}>
                  <Check />
                  <span>Done</span>
                  <span className="ml-auto text-xs text-sidebar-muted-foreground tabular-nums">{doneCount}</span>
                  <ChevronRight className="text-sidebar-muted-foreground" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onOpenSettings}>
              <span
                className={
                  "size-2 rounded-full " +
                  (connection.state === "connected"
                    ? "bg-green-500"
                    : connection.state === "error"
                      ? "bg-destructive"
                      : "bg-muted-foreground")
                }
              />
              <span className="truncate">
                {connection.state === "connected"
                  ? connection.server
                  : connection.state === "error"
                    ? "Not connected"
                    : "Connecting…"}
              </span>
              <Settings className="ml-auto" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

const LATEST_RUNS = 4

/** The project's most recent routine runs, newest first. A row opens that run's report. */
function LatestRuns({ projectId, activeRoutineId }: { projectId: Id | null; activeRoutineId: Id | null }) {
  const all = useStore((s) => s.routines)
  const recent = useMemo(
    () =>
      all
        .filter((r) => r.projectId === projectId && (r.running || r.lastRunAt))
        .sort((a, b) => Number(!!b.running) - Number(!!a.running) || (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))
        .slice(0, LATEST_RUNS),
    [all, projectId],
  )

  // Pinned to the bottom with the nav below it, so the thread list keeps the space above.
  if (recent.length === 0) return <div className="mt-auto" />

  return (
    <SidebarGroup className="mt-auto">
      <SidebarGroupLabel className="text-sidebar-muted-foreground">Latest runs</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {recent.map((r) => (
            <SidebarMenuItem key={r.id}>
              <SidebarMenuButton
                isActive={r.id === activeRoutineId}
                onClick={() => void openLatestRun(r)}
                title={r.lastError && r.lastStatus === "failed" ? `${r.name}\n${r.lastError}` : r.name}
                className="pr-2! hover:bg-sidebar-row-hover data-active:bg-sidebar-accent data-active:font-normal"
              >
                <StatusMark
                  state={r.running ? "running" : r.lastStatus === "failed" ? "failed" : "ok"}
                  className="-ml-0.5 size-4"
                />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="ml-auto shrink-0 text-xs text-sidebar-muted-foreground tabular-nums">
                  {r.running ? "Running" : relativeTime(r.lastRunAt!)}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** Opens the routine's newest run, or the routine itself if its runs can't be listed. */
async function openLatestRun(r: Routine) {
  try {
    await backend.loadRuns(r.id)
  } catch {}
  const runs = store.get().runs[r.id] ?? []
  const latest = runs.reduce<(typeof runs)[number] | undefined>((a, b) => (!a || b.startedAt > a.startedAt ? b : a), undefined)
  store.go(latest ? { kind: "run", routineId: r.id, runId: latest.id } : { kind: "routine", routineId: r.id })
}

function IconTip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Looks like a label until clicked, then filters threads by title. Esc clears. */
function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const active = editing || value !== ""

  return (
    <div
      className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sidebar-muted-foreground hover:bg-sidebar-row-hover has-focus:bg-sidebar-control"
      onClick={() => {
        setEditing(true)
        requestAnimationFrame(() => input.current?.focus())
      }}
    >
      <Search className="size-4 shrink-0" />
      {active ? (
        <input
          ref={input}
          value={value}
          placeholder="Search"
          aria-label="Search threads"
          className="min-w-0 flex-1 bg-transparent text-sm text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => value === "" && setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onChange("")
              setEditing(false)
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <span className="text-sm">Search</span>
      )}
      {value !== "" && (
        <button
          aria-label="Clear search"
          className="shrink-0 rounded-sm p-0.5 hover:text-sidebar-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onChange("")
            setEditing(false)
          }}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
