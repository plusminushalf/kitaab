import type { HermesBridge } from "../shared/bridge"

declare global {
  interface Window {
    hermes: HermesBridge
  }
}

export {}
