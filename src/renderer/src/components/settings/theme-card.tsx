import type { CSSProperties } from "react"
import { Check, Copy, Moon, PenLine, Sun, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { mix, shade } from "@/lib/appearance/color"
import { appearance, variantFor } from "@/lib/appearance/store"
import type { Appearance, ThemeColors, ThemeFamily, ThemeVariant } from "@/lib/appearance/tokens"
import { cn } from "@/lib/utils"

/** A soft sphere painted from a variant's palette: a highlight, the accent, then the canvas. */
export function orbStyle(colors: ThemeColors, appearance: Appearance): CSSProperties {
  const sidebar = colors.sidebar === "transparent" ? colors.canvas : colors.sidebar
  const highlight = appearance === "dark" ? shade(colors.canvas, 0.12) : mix(colors.canvas, "#ffffff", 0.85)
  return {
    background: [
      `radial-gradient(circle at 30% 28%, ${highlight} 0%, transparent 42%)`,
      `radial-gradient(circle at 72% 38%, ${colors.accent} 0%, transparent 58%)`,
      `radial-gradient(circle at 40% 85%, ${colors.messageSurface} 0%, transparent 55%)`,
      `linear-gradient(160deg, ${colors.canvas}, ${sidebar})`,
    ].join(", "),
    boxShadow: `inset -6px -8px 16px ${appearance === "dark" ? "rgb(0 0 0 / 35%)" : "rgb(0 0 0 / 12%)"}, 0 6px 18px rgb(0 0 0 / 18%)`,
  }
}

export function ThemeCard({
  family,
  active,
  onEdit,
  onDuplicate,
  onExport,
  onDelete,
}: {
  family: ThemeFamily
  active: boolean
  onEdit: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void
}) {
  const light = family.variants.filter((v) => v.appearance === "light")
  const dark = family.variants.filter((v) => v.appearance === "dark")
  // Families with more than one variant per mode (Catppuccin: Latte, Frappé, Macchiato,
  // Mocha) label their orbs and offer the other flavours from a menu.
  const labelled = light.length > 1 || dark.length > 1 || family.variants.length > 2
  const modes = (["light", "dark"] as const).filter((m) => family.variants.some((v) => v.appearance === m))

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => appearance.useTheme(family.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && appearance.useTheme(family.id)}
      className={cn(
        "group relative flex flex-col gap-4 rounded-2xl border bg-card p-4 pt-6 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "border-primary/60 ring-1 ring-primary/40",
      )}
    >
      {active && (
        <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      )}
      <div className="flex items-start justify-center gap-10">
        {modes.map((mode) => (
          <Orb
            key={mode}
            family={family}
            mode={mode}
            options={mode === "light" ? light : dark}
            labelled={labelled}
          />
        ))}
      </div>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={family.name}>
          {family.name}
        </span>
        <CardAction label="Duplicate theme" onClick={onDuplicate}>
          <Copy />
        </CardAction>
        {!family.builtIn && (
          <>
            <CardAction label="Edit theme" onClick={onEdit}>
              <PenLine />
            </CardAction>
            <CardAction label="Export theme file" onClick={onExport}>
              <Upload />
            </CardAction>
            <CardAction label="Remove theme" onClick={onDelete}>
              <Trash2 />
            </CardAction>
          </>
        )}
      </div>
    </div>
  )
}

function CardAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onClick()
            }}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Orb({
  family,
  mode,
  options,
  labelled,
}: {
  family: ThemeFamily
  mode: Appearance
  options: ThemeVariant[]
  labelled: boolean
}) {
  const current = variantFor(family, mode)
  const extra = options.length - 1
  const sphere = (
    <span className="relative block size-16 rounded-full" style={orbStyle(current.colors, current.appearance)}>
      {labelled && (
        <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border bg-popover text-muted-foreground">
          {mode === "light" ? <Sun className="size-3" /> : <Moon className="size-3" />}
        </span>
      )}
    </span>
  )
  const label = labelled && (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      {current.name}
      {extra > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">+{extra}</span>}
    </span>
  )

  if (options.length <= 1) {
    return (
      <button
        className="flex flex-col items-center gap-1.5 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Use ${family.name} ${current.name} for ${mode} mode`}
        onClick={(e) => {
          e.stopPropagation()
          appearance.useTheme(family.id, current)
        }}
      >
        {sphere}
        {label}
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col items-center gap-1.5 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Choose the ${mode} variant of ${family.name}`}
      >
        {sphere}
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-44" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{mode === "light" ? "Light mode" : "Dark mode"}</DropdownMenuLabel>
          {options.map((v) => (
            <DropdownMenuItem key={v.id} onClick={() => appearance.useTheme(family.id, v)}>
              <span className="size-4 shrink-0 rounded-full" style={orbStyle(v.colors, v.appearance)} />
              {v.name}
              {v.id === current.id && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A tiny drawing of the app in a palette, for the color scheme cards. */
export function SchemePreview({ colors }: { colors: ThemeColors }) {
  const sidebar = colors.sidebar === "transparent" ? colors.surfaceRaised : colors.sidebar
  const line = (w: string, c = colors.border) => <span className="block h-1.5 rounded-full" style={{ width: w, background: c }} />
  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: colors.canvas }}>
      <div className="flex w-[22%] flex-col gap-1.5 border-r p-2" style={{ background: sidebar, borderColor: colors.sidebarBorder }}>
        <span className="mb-1 block h-2.5 rounded-full border" style={{ borderColor: colors.border }} />
        {line("100%", colors.sidebarRowSelected)}
        {line("100%", colors.sidebarRowHover)}
        {line("100%", colors.sidebarRowHover)}
      </div>
      <div className="relative flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="mt-6 flex flex-1 flex-col gap-1.5">
            {line("60%")}
            {line("45%")}
          </div>
          <span className="block h-2.5 w-[28%] rounded-full" style={{ background: colors.messageSurface }} />
        </div>
        <div className="absolute top-3 right-3 mt-5 flex w-[26%] flex-col gap-1.5 rounded-md border p-1.5" style={{ background: colors.surfaceOverlay, borderColor: colors.border }}>
          {[colors.accent, colors.update, colors.warning].map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="size-1 rounded-full" style={{ background: c }} />
              {line("70%")}
            </span>
          ))}
        </div>
        <div
          className="mt-auto flex items-center justify-between rounded-md border px-2 py-1.5"
          style={{ background: colors.surfaceRaised, borderColor: colors.input }}
        >
          {line("35%")}
          <span className="size-2.5 rounded-full" style={{ background: colors.messageAction }} />
        </div>
      </div>
    </div>
  )
}
