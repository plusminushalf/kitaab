import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { router } from "expo-router"
import { backend } from "@kitab/core/backend"
import { useStore } from "@/lib/store"
import { useServerSettings } from "@/lib/settings"
import { useColors } from "@/lib/theme"
import { Icon } from "./ui"

/** Shown above a list while Kitab isn't connected to Hermes. */
export function ConnectionBanner() {
  const c = useColors()
  const conn = useStore((s) => s.connection)
  const settings = useServerSettings()
  if (conn.state === "connected") return null

  const setup = !settings.host || !settings.user
  const connecting = conn.state === "connecting"
  const message = setup ? "Connect Kitab to your Hermes host to get started." : connecting ? `Connecting to ${settings.host}…` : conn.state === "error" ? conn.message : "Not connected"

  return (
    <Pressable
      onPress={() => (setup ? router.push("/settings") : connecting ? undefined : void backend.connect())}
      style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: setup ? c.secondary : c.warningSurface, borderRadius: 14, padding: 14, flexDirection: "row", gap: 10, alignItems: "center" }}
    >
      {connecting ? <ActivityIndicator /> : <Icon name={setup ? "server.rack" : "wifi.exclamationmark"} size={18} color={setup ? c.text : c.warning} />}
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 14, lineHeight: 19 }} numberOfLines={4}>
          {message}
        </Text>
        {!connecting ? (
          <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 3 }}>{setup ? "Open Settings" : "Tap to try again"}</Text>
        ) : null}
      </View>
    </Pressable>
  )
}
