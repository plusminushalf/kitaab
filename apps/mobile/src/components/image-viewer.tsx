import { useEffect, useState } from "react"
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native"
import { Image } from "expo-image"
import { StatusBar } from "expo-status-bar"
import {
  GestureDetector,
  GestureHandlerRootView,
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler"
import Animated, { Extrapolation, FadeIn, FadeOut, interpolate, useAnimatedStyle, useSharedValue, withDecay, withSpring, withTiming } from "react-native-reanimated"
import { scheduleOnRN } from "react-native-worklets"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { closeImage, useViewedImage, type ViewedImage } from "@/lib/image-viewer"
import { Icon } from "./ui"

// An image full screen, as in Photos: pinch to zoom in on where your fingers are, drag to
// look around once zoomed, double-tap to zoom in or back out, tap to hide the buttons, and
// swipe down (when not zoomed) to close.

const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2.5
const SPRING = { damping: 26, stiffness: 260, mass: 0.9 }

/** Mounted once, in the root layout. Shows whatever openImage() was last given. */
export function ImageViewer() {
  const image = useViewedImage()
  // Keep drawing the last image while the modal fades out.
  const [shown, setShown] = useState<ViewedImage | null>(image)
  useEffect(() => {
    if (image) setShown(image)
  }, [image])

  return (
    <Modal visible={!!image} transparent animationType="fade" statusBarTranslucent onRequestClose={closeImage} onDismiss={() => setShown(null)}>
      {/* A modal is its own native root; gestures inside it need their own root view. */}
      <GestureHandlerRootView style={{ flex: 1 }}>{shown ? <Viewer key={shown.uri} image={shown} /> : null}</GestureHandlerRootView>
    </Modal>
  )
}

function Viewer({ image }: { image: ViewedImage }) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [chrome, setChrome] = useState(true)

  // The size the image is drawn at when it just fits the screen (zoom 1).
  const fit = natural ? Math.min(width / natural.w, height / natural.h) : 1
  const baseW = natural ? natural.w * fit : width
  const baseH = natural ? natural.h * fit : height

  const box = useSharedValue({ w: width, h: height, iw: baseW, ih: baseH })
  useEffect(() => {
    box.value = { w: width, h: height, iw: baseW, ih: baseH }
  }, [box, width, height, baseW, baseH])

  const scale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  // Where the pinch started from, to keep the point under the fingers fixed.
  const start = useSharedValue({ scale: 1, x: 0, y: 0, fx: 0, fy: 0 })
  const pinching = useSharedValue(false)
  // Swipe-to-close offset, used only while not zoomed in.
  const dismissY = useSharedValue(0)

  const toggleChrome = () => setChrome((on) => !on)

  /** How far the image can move each way at a zoom before its edge leaves the screen's edge. */
  function bounds(s: number) {
    "worklet"
    const b = box.value
    return { x: Math.max(0, (b.iw * s - b.w) / 2), y: Math.max(0, (b.ih * s - b.h) / 2) }
  }

  function clamp(v: number, max: number) {
    "worklet"
    return Math.min(max, Math.max(-max, v))
  }

  /** Back into range after a gesture: zoom between 1 and the max, no empty space past an edge. */
  function settle() {
    "worklet"
    const s = Math.min(MAX_SCALE, Math.max(1, scale.value))
    const k = s / scale.value
    const { x, y } = bounds(s)
    scale.value = withSpring(s, SPRING)
    tx.value = withSpring(clamp(tx.value * k, x), SPRING)
    ty.value = withSpring(clamp(ty.value * k, y), SPRING)
  }

  const pinch = usePinchGesture({
    onActivate: (e) => {
      "worklet"
      pinching.value = true
      start.value = { scale: scale.value, x: tx.value, y: ty.value, fx: e.focalX - box.value.w / 2, fy: e.focalY - box.value.h / 2 }
      dismissY.value = withSpring(0, SPRING)
    },
    onUpdate: (e) => {
      "worklet"
      const st = start.value
      // A little give past the limits, settled back on release.
      const s = Math.min(MAX_SCALE * 1.4, Math.max(0.6, st.scale * e.scale))
      const k = s / st.scale
      // The point that was under the fingers stays under them, even as they move.
      tx.value = e.focalX - box.value.w / 2 - (st.fx - st.x) * k
      ty.value = e.focalY - box.value.h / 2 - (st.fy - st.y) * k
      scale.value = s
    },
    onDeactivate: () => {
      "worklet"
      pinching.value = false
      settle()
    },
  })

  const pan = usePanGesture({
    onUpdate: (e) => {
      "worklet"
      if (pinching.value) return
      if (scale.value > 1.01) {
        // Past an edge the image drags slower, so it feels held back.
        const { x, y } = bounds(scale.value)
        tx.value += Math.abs(tx.value) > x ? e.changeX / 3 : e.changeX
        ty.value += Math.abs(ty.value) > y ? e.changeY / 3 : e.changeY
      } else {
        dismissY.value += e.changeY
      }
    },
    onDeactivate: (e) => {
      "worklet"
      if (pinching.value) return
      if (scale.value > 1.01) {
        const { x, y } = bounds(scale.value)
        tx.value = withDecay({ velocity: e.velocityX, clamp: [-x, x], rubberBandEffect: true })
        ty.value = withDecay({ velocity: e.velocityY, clamp: [-y, y], rubberBandEffect: true })
      } else if (Math.abs(dismissY.value) > 120 || Math.abs(e.velocityY) > 900) {
        const dir = Math.sign(dismissY.value || e.velocityY)
        dismissY.value = withTiming(dir * box.value.h, { duration: 180 }, () => scheduleOnRN(closeImage))
      } else {
        dismissY.value = withSpring(0, SPRING)
      }
    },
  })

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (e) => {
      "worklet"
      if (scale.value > 1.01) {
        scale.value = withSpring(1, SPRING)
        tx.value = withSpring(0, SPRING)
        ty.value = withSpring(0, SPRING)
        return
      }
      // Zoom in on the spot that was tapped.
      const s = DOUBLE_TAP_SCALE
      const { x, y } = bounds(s)
      scale.value = withSpring(s, SPRING)
      tx.value = withSpring(clamp(-(e.x - box.value.w / 2) * (s - 1), x), SPRING)
      ty.value = withSpring(clamp(-(e.y - box.value.h / 2) * (s - 1), y), SPRING)
    },
  })

  const singleTap = useTapGesture({
    onActivate: () => {
      "worklet"
      scheduleOnRN(toggleChrome)
    },
  })

  const taps = useExclusiveGestures(doubleTap, singleTap)
  const gesture = useSimultaneousGestures(pinch, pan, taps)

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value + dismissY.value }, { scale: scale.value }],
  }))
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(dismissY.value), [0, box.value.h / 2], [1, 0], Extrapolation.CLAMP),
  }))
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(dismissY.value), [0, 80], [1, 0], Extrapolation.CLAMP),
  }))

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" hidden={!chrome} animated />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }, backdropStyle]} />
      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} accessibilityLabel={image.alt || "Image"} accessibilityRole="image">
          <Animated.View style={[{ width: baseW, height: baseH }, imageStyle]}>
            <Image
              source={{ uri: image.uri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="contain"
              // Keep full resolution: it's drawn up to MAX_SCALE times its fitted size.
              allowDownscaling={false}
              onLoad={(e) => {
                setLoading(false)
                if (e.source.width && e.source.height) setNatural({ w: e.source.width, h: e.source.height })
              }}
              onError={() => {
                setLoading(false)
                setFailed(true)
              }}
            />
          </Animated.View>
        </View>
      </GestureDetector>

      {loading ? <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} pointerEvents="none" /> : null}
      {failed ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", padding: 32 }]} pointerEvents="none">
          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 15, textAlign: "center" }}>Couldn't load this image.</Text>
        </View>
      ) : null}

      {chrome ? (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={[StyleSheet.absoluteFill, chromeStyle]} pointerEvents="box-none">
          <Pressable
            onPress={closeImage}
            hitSlop={12}
            accessibilityLabel="Close"
            style={({ pressed }) => ({
              position: "absolute",
              top: insets.top + 8,
              right: 16,
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(60,60,60,0.7)",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="xmark" size={14} color="#fff" weight="bold" />
          </Pressable>
          {image.alt ? (
            <View pointerEvents="none" style={{ position: "absolute", left: 20, right: 20, bottom: insets.bottom + 16, alignItems: "center" }}>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, textAlign: "center" }} numberOfLines={3}>
                {image.alt}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  )
}
