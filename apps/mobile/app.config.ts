import type { ExpoConfig } from "expo/config"

const config: ExpoConfig = {
  name: "Kitab",
  slug: "kitab",
  scheme: "kitab",
  version: "0.0.1",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "app.kitab.ios",
    supportsTablet: false,
    infoPlist: {
      NSPhotoLibraryUsageDescription: "Kitab attaches the photos you pick to a message.",
      NSCameraUsageDescription: "Kitab attaches the photos you take to a message.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-sqlite",
    "expo-font",
    "expo-image",
    ["expo-build-properties", { ios: { deploymentTarget: "16.4" } }],
  ],
  experiments: { typedRoutes: true },
}

export default config
