import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type ViewStyle } from "react-native"
import { SymbolView, type SymbolViewProps } from "expo-symbols"
import * as Haptics from "expo-haptics"
import { initials } from "@kitab/core/project-color"
import { useColors } from "@/lib/theme"
import { useProjectTint } from "@/lib/tint"

export function Icon({ name, size = 20, color, weight }: { name: SymbolViewProps["name"]; size?: number; color?: string; weight?: SymbolViewProps["weight"] }) {
  const c = useColors()
  return <SymbolView name={name} size={size} tintColor={color ?? c.text} weight={weight} />
}

/** A plain header button (SF Symbol), sized for a thumb. */
export function HeaderButton({ icon, onPress, label }: { icon: SymbolViewProps["name"]; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}>
      <Icon name={icon} size={20} />
    </Pressable>
  )
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  style,
}: {
  title: string
  onPress: () => void
  variant?: "primary" | "secondary" | "destructive"
  loading?: boolean
  disabled?: boolean
  style?: ViewStyle
}) {
  const c = useColors()
  const bg = variant === "primary" ? c.accent : variant === "destructive" ? c.errorSurface : c.secondary
  const fg = variant === "primary" ? c.accentForeground : variant === "destructive" ? c.error : c.text
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        { backgroundColor: bg, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{title}</Text>}
    </Pressable>
  )
}

/** Grouped list section, like iOS Settings. */
export function Section({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const c = useColors()
  return (
    <View style={{ marginBottom: 24 }}>
      {title ? <Text style={{ color: c.textMuted, fontSize: 13, textTransform: "uppercase", marginLeft: 16, marginBottom: 6 }}>{title}</Text> : null}
      <View style={{ backgroundColor: c.surface, borderRadius: 12, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" }}>
        {children}
      </View>
      {footer ? <Text style={{ color: c.textMuted, fontSize: 13, marginHorizontal: 16, marginTop: 6, lineHeight: 18 }}>{footer}</Text> : null}
    </View>
  )
}

export function Row({
  title,
  detail,
  onPress,
  right,
  destructive,
  last,
  chevron,
}: {
  title: string
  detail?: string
  onPress?: PressableProps["onPress"]
  right?: React.ReactNode
  destructive?: boolean
  last?: boolean
  chevron?: boolean
}) {
  const c = useColors()
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ backgroundColor: pressed && onPress ? c.secondary : "transparent" })}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, minHeight: 46 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, color: destructive ? c.error : c.text }}>{title}</Text>
          {detail ? <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 2 }}>{detail}</Text> : null}
        </View>
        {right}
        {chevron ? <Icon name="chevron.right" size={13} color={c.textMuted} weight="semibold" /> : null}
      </View>
      {last ? null : <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 16 }} />}
    </Pressable>
  )
}

export function Empty({ icon, title, body, children }: { icon: SymbolViewProps["name"]; title: string; body?: string; children?: React.ReactNode }) {
  const c = useColors()
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 32, paddingVertical: 64, gap: 10 }}>
      <Icon name={icon} size={34} color={c.textMuted} />
      <Text style={{ fontSize: 17, fontWeight: "600", color: c.text, textAlign: "center" }}>{title}</Text>
      {body ? <Text style={{ fontSize: 15, color: c.textMuted, textAlign: "center", lineHeight: 21 }}>{body}</Text> : null}
      {children}
    </View>
  )
}

/** Personality initials in a small circle (like the Mac's avatars). */
export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const c = useColors()
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.secondary, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.42, fontWeight: "600", color: c.text }}>{initials}</Text>
    </View>
  )
}

export function StatusDot({ status }: { status: "idle" | "working" | "needs-you" }) {
  const c = useColors()
  if (status === "idle") return null
  if (status === "working") return <ActivityIndicator size="small" color={c.working} />
  return <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.warning }} />
}

/** A text button for the header (Cancel, Save, Done). iOS 26 puts it in a glass pill, so it needs side padding. */
export function HeaderTextButton({ title, onPress, bold, disabled }: { title: string; onPress: () => void; bold?: boolean; disabled?: boolean }) {
  const c = useColors()
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={({ pressed }) => ({ paddingHorizontal: 8, paddingVertical: 4, opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ color: disabled ? c.textMuted : c.text, fontSize: 17, fontWeight: bold ? "600" : "400" }}>{title}</Text>
    </Pressable>
  )
}

/** A project's colored initials, tinted from its name (as on the Mac). */
export function ProjectBadge({ name, size = 20 }: { name: string; size?: number }) {
  const tint = useProjectTint(name)
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: tint.badge, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.48, fontWeight: "700", letterSpacing: -0.3, color: tint.badgeText }}>{initials(name)}</Text>
    </View>
  )
}

/** A project's name as a small tag in its color (a routine's project, say). */
export function ProjectTag({ name }: { name: string }) {
  const tint = useProjectTint(name)
  return (
    <View style={{ backgroundColor: tint.badge, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, flexShrink: 0, maxWidth: 120 }}>
      <Text style={{ color: tint.badgeText, fontSize: 12, fontWeight: "500" }} numberOfLines={1}>
        {name}
      </Text>
    </View>
  )
}

/** A project's folder icon in its color. */
export function FolderIcon({ name, size = 17 }: { name: string; size?: number }) {
  const tint = useProjectTint(name)
  return <Icon name="folder.fill" size={size} color={tint.icon} />
}
