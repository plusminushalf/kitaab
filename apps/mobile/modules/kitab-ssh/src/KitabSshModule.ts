import { NativeModule, requireNativeModule } from "expo"

declare class KitabSshModule extends NativeModule<{}> {
  /** "ssh-ed25519 AAAA… kitab-iphone"; the key is made in the Keychain on first use. */
  publicKey(): Promise<string>
  resetKey(): Promise<void>
  /** Connects, or keeps a live connection to the same target. Fails with HOST_KEY_CHANGED if the pin doesn't match. */
  connect(host: string, port: number, user: string, pinnedHostKey: string | null): Promise<{ hostKey: string; fingerprint: string }>
  /** Runs `sh -s` on the host with `script` on stdin. */
  exec(script: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }>
  /** A port on 127.0.0.1 that forwards to 127.0.0.1:remotePort on the host. */
  forward(remotePort: number): Promise<number>
  isConnected(): Promise<boolean>
  disconnect(): Promise<void>
}

export default requireNativeModule<KitabSshModule>("KitabSsh")
