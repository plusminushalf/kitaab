// Shared by the main process (Open VSX installs) and the renderer (theme imports).

/** JSON with comments and trailing commas (VS Code theme files use both). */
export function parseJsonc(text: string): unknown {
  let out = ""
  let i = 0
  let inString = false
  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === "\\") {
        out += text[i + 1] ?? ""
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
    } else {
      out += ch
      i++
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}
