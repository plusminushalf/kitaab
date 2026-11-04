import { useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { Asterisk, Bot, Check, Cpu, Gem, Search, Sparkles, Star, Zap } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { backend } from "@kitab/core/backend"
import type { Id } from "@kitab/core/model"
import { EFFORT_LABELS, modelName, shortModelName } from "@kitab/core/model-names"
import { useStore, type ModelChoice, type ModelProvider } from "@/lib/store"

// Model picker in the composer, laid out like T3 Code's: providers on the left
// (★ = favourites), searchable models in the middle, reasoning on the right,
// Standard / Fast at the bottom.

const EFFORTS = ["low", "medium", "high", "xhigh", "max"]
const FAVORITES = "favoriteModels"

function providerIcon(slug: string): ComponentType<{ className?: string }> {
  if (slug.includes("anthropic") || slug.includes("claude")) return Asterisk
  if (slug.includes("gemini") || slug.includes("google")) return Gem
  if (slug.includes("openai")) return Sparkles
  if (slug.includes("copilot")) return Bot
  return Cpu
}

/** Brand-ish tint for the composer chip's provider icon. */
function providerTint(slug: string): string {
  if (slug.includes("anthropic") || slug.includes("claude")) return "text-[#d97757]"
  if (slug.includes("gemini") || slug.includes("google")) return "text-sky-500"
  return "text-primary"
}

const key = (provider: string, model: string) => `${provider}/${model}`

function readFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES) ?? "[]")
  } catch {
    return []
  }
}

export function ModelPicker({ threadId }: { threadId: Id | null }) {
  const providers = useStore((s) => s.models)
  const fallback = useStore((s) => s.defaultModel)
  const defaultEffort = useStore((s) => s.defaultEffort)
  const draft = useStore((s) => s.draftModel)
  const threadModel = useStore((s) => (threadId ? s.threadModels[threadId] : undefined))
  const current: ModelChoice | null = (threadId ? threadModel : draft) ?? fallback

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<string>("") // provider slug, or "★"
  const [favorites, setFavorites] = useState<string[]>(readFavorites)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setTab(current?.provider ?? providers[0]?.slug ?? "")
    setTimeout(() => search.current?.focus(), 0)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = providers.flatMap((p) => p.models.map((m) => ({ provider: p, model: m })))
    if (q) return all.filter((r) => `${modelName(r.model)} ${r.model} ${r.provider.name}`.toLowerCase().includes(q))
    if (tab === "★") return all.filter((r) => favorites.includes(key(r.provider.slug, r.model)))
    return all.filter((r) => r.provider.slug === tab)
  }, [providers, query, tab, favorites])

  if (!providers.length || !current) return null

  const caps = providers.find((p) => p.slug === current.provider)?.caps[current.model]
  const effort = current.effort ?? defaultEffort
  const pick = (choice: ModelChoice) => void backend.setModel(threadId, choice)
  const toggleFavorite = (k: string) => {
    const next = favorites.includes(k) ? favorites.filter((f) => f !== k) : [...favorites, k]
    setFavorites(next)
    try {
      localStorage.setItem(FAVORITES, JSON.stringify(next))
    } catch {}
  }
  const Icon = providerIcon(current.provider)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-sm text-muted-foreground hover:text-foreground" />}
        title="Model and reasoning"
      >
        <Icon className={"size-4 " + providerTint(current.provider)} />
        <span>
          {shortModelName(current.model)} {EFFORT_LABELS[effort] ?? effort}
        </span>
        {current.fast && <Zap className="opacity-70" />}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[min(640px,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex h-80 min-h-0">
          {/* Providers */}
          <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2">
            <RailButton active={tab === "★" && !query} title="Favourites" onClick={() => setTab("★")}>
              <Star />
            </RailButton>
            <div className="my-1 h-px w-6 bg-border" />
            {providers.map((p) => {
              const PIcon = providerIcon(p.slug)
              return (
                <RailButton key={p.slug} active={tab === p.slug && !query} title={p.name} onClick={() => setTab(p.slug)}>
                  <PIcon />
                </RailButton>
              )
            })}
          </div>

          {/* Models */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {rows.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {tab === "★" && !query ? "Star models to keep them here." : "No models match."}
                </p>
              )}
              {rows.map(({ provider, model }) => (
                <ModelRow
                  key={key(provider.slug, model)}
                  provider={provider}
                  model={model}
                  selected={current.model === model && current.provider === provider.slug}
                  favorite={favorites.includes(key(provider.slug, model))}
                  showProvider={Boolean(query) || tab === "★"}
                  onPick={() => {
                    const fastOk = provider.caps[model]?.fast
                    pick({ model, provider: provider.slug, effort: current.effort, fast: fastOk ? current.fast : false })
                  }}
                  onFavorite={() => toggleFavorite(key(provider.slug, model))}
                />
              ))}
            </div>
          </div>

          {/* Reasoning */}
          <div className="flex w-48 shrink-0 flex-col border-l">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm">
              <span>Reasoning</span>
              <span className="truncate text-xs text-muted-foreground">{shortModelName(current.model)}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {caps?.reasoning === false ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">This model doesn't reason.</p>
              ) : (
                EFFORTS.map((e) => (
                  <button
                    key={e}
                    onClick={() => pick({ ...current, effort: e })}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span>{EFFORT_LABELS[e]}</span>
                    {e === defaultEffort && <span className="text-xs text-muted-foreground">Default</span>}
                    {effort === e && <Check className="ml-auto size-4" />}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Speed */}
        <div className="flex items-center gap-2 border-t p-2">
          <div className="flex rounded-md bg-muted p-0.5 text-sm">
            <SpeedButton active={!current.fast} onClick={() => pick({ ...current, fast: false })}>
              Standard
            </SpeedButton>
            <SpeedButton
              active={Boolean(current.fast)}
              disabled={!caps?.fast}
              title={caps?.fast ? "Faster output, at a higher price" : "This model has no fast mode"}
              onClick={() => pick({ ...current, fast: true })}
            >
              <Zap className="size-3.5" />
              Fast
            </SpeedButton>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RailButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={
        "relative flex size-8 items-center justify-center rounded-md hover:bg-muted [&_svg]:size-4 " +
        (active ? "bg-muted text-foreground" : "text-muted-foreground")
      }
    >
      {children}
      {active && <span className="absolute -right-2 h-4 w-0.5 rounded-full bg-primary" />}
    </button>
  )
}

function ModelRow({
  provider,
  model,
  selected,
  favorite,
  showProvider,
  onPick,
  onFavorite,
}: {
  provider: ModelProvider
  model: string
  selected: boolean
  favorite: boolean
  showProvider: boolean
  onPick: () => void
  onFavorite: () => void
}) {
  const PIcon = providerIcon(provider.slug)
  return (
    <div className="group flex items-center rounded-md hover:bg-muted">
      <button onClick={onPick} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm" title={model}>
        <PIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{modelName(model)}</span>
        {showProvider && <span className="shrink-0 text-xs text-muted-foreground">{provider.name}</span>}
        {provider.caps[model]?.fast && <Zap className="size-3 shrink-0 text-muted-foreground" />}
        {selected && <Check className="size-4 shrink-0" />}
      </button>
      <button
        onClick={onFavorite}
        title={favorite ? "Remove from favourites" : "Add to favourites"}
        className={"mr-1 rounded p-1 hover:text-foreground " + (favorite ? "text-foreground" : "invisible text-muted-foreground group-hover:visible")}
      >
        <Star className={"size-3.5 " + (favorite ? "fill-current" : "")} />
      </button>
    </div>
  )
}

function SpeedButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        "flex items-center gap-1 rounded px-2.5 py-1 disabled:opacity-40 " +
        (active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  )
}
