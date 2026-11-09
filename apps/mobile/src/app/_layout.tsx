// Hooks the shared core up to this phone before anything uses it.
import "@/lib/platform"
import { useEffect } from "react"
import { AppState, useColorScheme } from "react-native"
import { Stack } from "expo-router"
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { StatusBar } from "expo-status-bar"
import { backend } from "@kitab/core/backend"
import { store } from "@/lib/store"
import { serverSettings } from "@/lib/settings"
import { useColors } from "@/lib/theme"
import { Toasts } from "@/components/toasts"

// Links straight to a thread or settings still get the tabs underneath, so Back works.
export const unstable_settings = { initialRouteName: "(tabs)" }

function connectIfNeeded() {
  if (!serverSettings.configured()) return
  const state = store.get().connection.state
  if (state === "idle" || state === "error") void backend.connect()
}

export default function Root() {
  const scheme = useColorScheme()
  const c = useColors()
  const base = scheme === "dark" ? DarkTheme : DefaultTheme

  useEffect(() => {
    connectIfNeeded()
    // iOS drops sockets while the app is in the background; reconnect as soon as it's back.
    const sub = AppState.addEventListener("change", (s) => s === "active" && connectIfNeeded())
    return () => sub.remove()
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider
          value={{ ...base, colors: { ...base.colors, background: c.canvas, card: c.canvas, text: c.text, border: c.border, primary: c.text } }}
        >
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerBackButtonDisplayMode: "minimal",
              headerShadowVisible: false,
              // A solid bar: long replies never sit behind the title.
              headerTransparent: false,
              headerStyle: { backgroundColor: c.canvas },
              headerTitleStyle: { color: c.text },
              contentStyle: { backgroundColor: c.canvas },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="thread/[id]" options={{ title: "" }} />
            <Stack.Screen name="done" options={{ title: "Done" }} />
            <Stack.Screen name="routine/[id]" options={{ title: "" }} />
            <Stack.Screen name="run/[routineId]/[runId]" options={{ title: "" }} />
            <Stack.Screen name="profile" options={{ title: "Profile", headerStyle: { backgroundColor: c.surfaceRaised }, contentStyle: { backgroundColor: c.surfaceRaised } }} />
            <Stack.Screen
              name="new-thread"
              options={{ presentation: "formSheet", sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true, headerShown: false, contentStyle: { backgroundColor: c.surfaceRaised } }}
            />
            <Stack.Screen name="project/[id]" options={{ presentation: "modal", headerStyle: { backgroundColor: c.surfaceRaised }, contentStyle: { backgroundColor: c.surfaceRaised }, title: "" }} />
            <Stack.Screen name="personality/[id]" options={{ presentation: "modal", headerStyle: { backgroundColor: c.surfaceRaised }, contentStyle: { backgroundColor: c.surfaceRaised }, title: "" }} />
            <Stack.Screen name="settings" options={{ presentation: "modal", headerStyle: { backgroundColor: c.surfaceRaised }, contentStyle: { backgroundColor: c.surfaceRaised }, title: "Settings" }} />
          </Stack>
          <Toasts />
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
