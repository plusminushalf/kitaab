import { Platform } from "react-native"
import { Stack } from "expo-router"
import { useColors } from "@/lib/theme"

// iOS 26 draws its own edge under a transparent header; earlier versions need a blur. The
// edge is "hard" (a solid cut-off): the soft one lets rows read through the title.
const glass = Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26

export default function TabStack() {
  const c = useColors()
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: true,
        headerTransparent: true,
        headerBlurEffect: glass ? undefined : "systemChromeMaterial",
        scrollEdgeEffects: { top: "hard" },
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerTitleStyle: { color: c.text },
        headerLargeTitleStyle: { color: c.text },
      }}
    />
  )
}
