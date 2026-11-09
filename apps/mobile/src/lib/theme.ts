import { useColorScheme } from "react-native"

// Kitaab's default theme on the Mac (stock shadcn neutral), as hex for React Native.
// Same token names as the desktop's appearance/tokens.ts, trimmed to what the phone uses.

export type Colors = {
  canvas: string
  surface: string
  surfaceRaised: string
  text: string
  textMuted: string
  border: string
  accent: string
  accentForeground: string
  secondary: string
  messageSurface: string
  codeBackground: string
  error: string
  errorSurface: string
  warning: string
  warningSurface: string
  /** Warning as text ("Awaiting you"), dark enough to read. */
  warningText: string
  working: string
  /** "New reply": the dot, and its label. */
  unread: string
  unreadText: string
  done: string
}

const light: Colors = {
  canvas: "#ffffff",
  surface: "#ffffff",
  surfaceRaised: "#fafafa",
  text: "#0a0a0a",
  textMuted: "#737373",
  border: "#e5e5e5",
  accent: "#171717",
  accentForeground: "#fafafa",
  secondary: "#f5f5f5",
  messageSurface: "#f5f5f5",
  codeBackground: "#f5f5f5",
  error: "#e7000b",
  errorSurface: "#fef2f2",
  warning: "#f59e0b",
  warningSurface: "#fffbeb",
  warningText: "#b45309",
  working: "#3b82f6",
  unread: "#3b82f6",
  unreadText: "#2563eb",
  done: "#16a34a",
}

const dark: Colors = {
  canvas: "#0a0a0a",
  surface: "#171717",
  surfaceRaised: "#141414",
  text: "#fafafa",
  textMuted: "#a1a1a1",
  border: "rgba(255,255,255,0.1)",
  accent: "#e5e5e5",
  accentForeground: "#171717",
  secondary: "#262626",
  messageSurface: "#262626",
  codeBackground: "#171717",
  error: "#ff6467",
  errorSurface: "#3b0a0a",
  warning: "#f59e0b",
  warningSurface: "#3a2306",
  warningText: "#fbbf24",
  working: "#60a5fa",
  unread: "#3b82f6",
  unreadText: "#60a5fa",
  done: "#4ade80",
}

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light
}

export const mono = "Menlo"
