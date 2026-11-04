import { useEffect, useState } from "react"

export function useFullscreen() {
  const [value, setValue] = useState(false)
  useEffect(() => {
    void window.hermes.window.isFullscreen().then(setValue)
    return window.hermes.window.onFullscreen(setValue)
  }, [])
  return value
}
