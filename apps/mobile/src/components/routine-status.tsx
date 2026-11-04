import { ActivityIndicator, View } from "react-native"
import type { Routine, Run } from "@kitab/core/model"
import { useColors } from "@/lib/theme"
import { Icon } from "./ui"

export type RoutineState = "running" | "failed" | "paused" | "ok" | "new"

export function stateOf(r: Routine): RoutineState {
  if (r.running) return "running"
  if (!r.enabled) return "paused"
  if (r.lastStatus === "failed") return "failed"
  return r.lastRunAt ? "ok" : "new"
}

/** How a routine or run is doing, in the same slot at the start of a row (as on the Mac). */
export function StatusMark({ state }: { state: RoutineState | Run["status"] }) {
  const c = useColors()
  return (
    <View style={{ width: 20, alignItems: "center", justifyContent: "center" }}>
      {state === "running" ? (
        <ActivityIndicator size="small" color={c.working} />
      ) : state === "failed" ? (
        <Icon name="exclamationmark.circle.fill" size={16} color={c.error} />
      ) : state === "paused" ? (
        <Icon name="pause.circle" size={16} color={c.textMuted} />
      ) : (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: state === "new" ? c.border : c.done }} />
      )}
    </View>
  )
}
