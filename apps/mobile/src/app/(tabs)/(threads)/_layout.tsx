import { Platform } from "react-native"
import { Stack } from "expo-router"
import { useColors } from "@/lib/theme"

// iOS 26 draws its own glass edge under a transparent header; earlier versions need a blur.
const glass = Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26

export default function TabStack() {
  const c = useColors()
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: true,
        headerTransparent: true,
        headerBlurEffect: glass ? undefined : "systemChromeMaterial",
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerTitleStyle: { color: c.text },
        headerLargeTitleStyle: { color: c.text },
      }}
    />
  )
}
