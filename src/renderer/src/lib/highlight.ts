import hljs from "highlight.js/lib/core"
import typescript from "highlight.js/lib/languages/typescript"
import javascript from "highlight.js/lib/languages/javascript"
import sql from "highlight.js/lib/languages/sql"
import bash from "highlight.js/lib/languages/bash"
import json from "highlight.js/lib/languages/json"

// Only the languages we actually write here: TypeScript and SQL first, plus the few that
// show up next to them. Anything else stays plain text.
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("json", json)
hljs.registerAliases(["ts", "tsx", "mts", "cts"], { languageName: "typescript" })
hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" })
hljs.registerAliases(["sh", "shell", "zsh", "console"], { languageName: "bash" })
hljs.registerAliases(["psql", "postgres", "postgresql", "sqlite", "mysql"], { languageName: "sql" })

/** Untagged blocks are guessed among these, TypeScript and SQL first. */
const GUESSES = ["typescript", "sql", "bash", "json"]
/** How sure highlight.js's own guess has to be before we colour an untagged block. */
const MIN_RELEVANCE = 5

const SQL_START = /^\s*(select|insert|update|delete|with|create|alter|drop|truncate|explain|begin|commit|grant)\b/i
const TS_LINE = /^\s*(import|export|const|let|var|function|async|await|type|interface|class|enum|return|declare)\b/m

/** The language of an untagged block. highlight.js alone is shaky on short snippets
 *  (it calls a one-line UPDATE bash), so the obvious cases are decided first. */
function guess(code: string): string | undefined {
  if (SQL_START.test(code)) return "sql"
  if (TS_LINE.test(code)) return "typescript"
  const t = code.trim()
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t)
      return "json"
    } catch {}
  }
  const auto = hljs.highlightAuto(code, GUESSES)
  return auto.relevance >= MIN_RELEVANCE ? auto.language : undefined
}

/**
 * Highlights code as HTML (hljs-* spans), or returns null to show it as plain text.
 * `lang` is the fence's info string; without one we guess.
 */
export function highlight(code: string, lang?: string): string | null {
  try {
    const language = lang ?? guess(code)
    if (!language || !hljs.getLanguage(language)) return null
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return null
  }
}
