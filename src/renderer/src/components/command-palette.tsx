import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import { Check, CornerDownLeft, FolderPlus, Keyboard, MessageSquare, Repeat, Search, Settings, SquarePen, UserCog, Users } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { openNewProject, startNewThread } from "@/components/project-menu"
import { store, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { useShortcutBindings } from "@/lib/shortcuts"
import { acceleratorLabel } from "../../../shared/shortcuts"

// ⌘K: one search field over what you can do, T3-style. Typing also finds threads in the
// open profile by title.

let open = false
const listeners = new Set<() => void>()
function setOpen(next: boolean) {
  open = next
  listeners.forEach((l) => l())
}

export const openCommandPalette = () => setOpen(!open)

type Item = { id: string; label: string; icon: ReactNode; hint?: string; run: () => void }

/** Mounted once in App. */
export function CommandPaletteHost() {
  const isOpen = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => open,
  )
  if (!isOpen) return null
  return <CommandPalette onDone={() => setOpen(false)} />
}

function CommandPalette({ onDone }: { onDone: () => void }) {
  const connected = useStore((s) => s.connection.state === "connected")
  const profileId = useStore((s) => s.profileId)
  const threads = useStore((s) => s.threads)
  const doneCount = useStore((s) => s.doneCount)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const bindings = useShortcutBindings()

  const commands = useMemo<Item[]>(() => {
    const go = (view: Parameters<typeof store.go>[0]) => () => store.go(view)
    const list: (Item | false)[] = [
      connected && !!profileId && { id: "new-project", label: "New project…", icon: <FolderPlus />, run: openNewProject },
      connected && { id: "new-thread", label: "New thread…", icon: <SquarePen />, hint: acceleratorLabel(bindings["new-thread"]), run: startNewThread },
      { id: "routines", label: "Routines", icon: <Repeat />, hint: acceleratorLabel(bindings["go-routines"]), run: go({ kind: "routines" }) },
      { id: "personalities", label: "Personalities", icon: <Users />, hint: acceleratorLabel(bindings["go-personalities"]), run: go({ kind: "personalities" }) },
      doneCount > 0 && { id: "done", label: "Done", icon: <Check />, run: go({ kind: "done" }) },
      { id: "profile", label: "Profile settings", icon: <UserCog />, hint: acceleratorLabel(bindings["go-profile"]), run: go({ kind: "profile" }) },
      { id: "settings", label: "Settings", icon: <Settings />, hint: acceleratorLabel(bindings.settings), run: () => store.set({ settings: "general" }) },
      { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard />, run: () => store.set({ settings: "shortcuts" }) },
    ]
    return list.filter((i): i is Item => !!i)
  }, [connected, profileId, doneCount, bindings])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    const matching = commands.filter((c) => c.label.toLowerCase().includes(q))
    const found = threads
      .filter((t) => t.profileId === profileId && t.title.toLowerCase().includes(q))
      .slice(0, 8)
      .map<Item>((t) => ({
        id: `thread:${t.id}`,
        label: t.title,
        icon: <MessageSquare />,
        run: () => store.go({ kind: "thread", threadId: t.id }),
      }))
    return [...matching, ...found]
  }, [commands, threads, profileId, query])

  const pick = (item: Item) => {
    onDone()
    item.run()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onDone()}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-md"
        data-over-vibrancy
      >
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            placeholder="Type a command or search threads…"
            aria-label="Command"
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
              } else if (e.key === "Enter" && shown[active]) {
                e.preventDefault()
                pick(shown[active])
              }
            }}
          />
        </div>
        <div role="listbox" className="max-h-80 overflow-y-auto p-1">
          {shown.length === 0 && <div className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing matches</div>}
          {shown.map((item, i) => (
            <div
              key={item.id}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(item)}
              className={cn(
                "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
                i === active && "bg-accent text-accent-foreground",
              )}
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <kbd className="shrink-0 font-sans text-xs text-muted-foreground">{item.hint}</kbd>}
              {i === active && !item.hint && <CornerDownLeft className="size-3.5! text-muted-foreground" />}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
