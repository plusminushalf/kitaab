// Direct URLs for files on the Hermes server (images and video in the transcript).
// Hermes accepts the session token as ?token= on /api/files/download only, and
// serves <img>/<video> requests there inline.

let access: { base: string; token: string } | null = null

export function setFileAccess(value: { base: string; token: string } | undefined) {
  access = value ?? null
}

export function fileUrl(path: string): string | undefined {
  if (!access) return undefined
  return `${access.base}/api/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(access.token)}`
}
