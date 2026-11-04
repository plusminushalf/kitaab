import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type Font = { family: string; monospace: boolean }
let cache: Promise<Font[]> | null = null
const loadFonts = () => (cache ??= window.hermes.fonts().catch(() => []))

/** Searchable list of the fonts installed on this Mac, each shown in itself. */
export function FontPicker({
  value,
  onChange,
  placeholder,
  monospaceOnly,
}: {
  value: string
  onChange: (family: string) => void
  placeholder: string
  monospaceOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [fonts, setFonts] = useState<Font[] | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (open && !fonts) void loadFonts().then(setFonts)
  }, [open, fonts])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (fonts ?? []).filter((f) => (!monospaceOnly || f.monospace) && (!q || f.family.toLowerCase().includes(q)))
  }, [fonts, query, monospaceOnly])

  const pick = (family: string) => {
    onChange(family)
    setOpen(false)
    setQuery("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="w-56 justify-between font-normal" />}>
        <span className="truncate" style={{ fontFamily: value ? `"${value}"` : undefined }}>
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </span>
        <ChevronDown className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-1 p-1">
        <Input
          autoFocus
          placeholder="Search fonts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) pick(list[0]?.family ?? query.trim())
          }}
          className="mb-1"
        />
        <div className="max-h-72 overflow-y-auto">
          <FontRow label={placeholder} selected={!value} onClick={() => pick("")} />
          {fonts === null && <p className="px-2 py-3 text-xs text-muted-foreground">Loading fonts…</p>}
          {list.map((f) => (
            <FontRow key={f.family} label={f.family} family={f.family} selected={value === f.family} onClick={() => pick(f.family)} />
          ))}
          {fonts !== null && list.length === 0 && (
            <button
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
              onClick={() => query.trim() && pick(query.trim())}
            >
              {query.trim() ? `Use “${query.trim()}”` : "No fonts found."}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function FontRow({ label, family, selected, onClick }: { label: string; family?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", selected && "font-medium")}
      style={{ fontFamily: family ? `"${family}"` : undefined }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check className="size-4 shrink-0" />}
    </button>
  )
}
