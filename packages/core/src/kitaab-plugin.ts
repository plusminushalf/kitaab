import type { Id } from "./model"
import { http } from "./platform"

// Kitaab's own Hermes plugin, installed into every project (profile) by syncKitabContext.
//
// It adds two tools. start_thread makes a new thread (a hand-off, a side task) the way Kitaab
// does, through session.create and prompt.submit inside the server, and sends its first message.
// request_secret: the agent names a secret it needs and where it goes (a key
// in a .env file, a private file, or Hermes's own .env), Hermes sends the app a `secret`
// request, Kitaab shows a masked field, and the plugin writes the answer straight to its
// destination. The tool result only says where the value went, and the plugin adds the value
// to Hermes's redaction list, so it never reaches the model, the transcript or a later tool
// result (backend.ts answers the request; the cards are in each app's pending-question UI).
//
// Files go to <profile home>/plugins/kitaab/ through Hermes's file upload, the plugin is added
// to the profile's plugins.enabled, and /api/dashboard/agent-plugins/activate loads it into
// the running backend, so new threads get the tool without a restart. A plugin the user
// disabled stays disabled.

export const PLUGIN = "kitaab"

const PLUGIN_YAML = String.raw`name: kitaab
version: 1.0.0
description: "Kitaab's tools: request_secret asks the user for a secret through Kitaab and saves it without the agent seeing it; start_thread starts a new Kitaab thread with a first message."
author: Kitaab
kind: standalone
provides_tools:
  - request_secret
  - start_thread
provides_hooks:
  - transform_tool_result
`

// Python: keep it ASCII, with no backticks and no dollar-brace (this is a template literal).
const INIT_PY = String.raw`"""Kitaab's Hermes plugin. Kitaab installs and updates this file; edits here are overwritten.

request_secret asks the user for a secret (API key, token, password) through Kitaab's masked
secret card and writes it where it belongs: a key in a .env file, a private file, or Hermes's
own .env. The value never enters the conversation. The tool returns only where it went, and
Hermes scrubs the exact value from everything the model sees afterwards.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import secrets
import stat
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# How long the card waits for the user before the tool gives up.
ASK_SECONDS = 900
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# Values made only of these characters go into a .env file unquoted.
_BARE = re.compile(r"^[A-Za-z0-9_\-.,/:@%+=~]*$")

DESCRIPTION = (
    "Ask the user for a secret (API key, token, password) through Kitaab's secure secret card, and "
    "put it where it's needed without you ever seeing it. Use this instead of asking the user to paste "
    "a secret into the chat, and instead of telling them to edit files themselves. The result never "
    "contains the value, only where it was saved. Destinations: "
    "'env_file' writes NAME=value into the dotenv file at path (created with mode 600 if it's missing; "
    "an existing NAME is replaced and every other line is kept). "
    "'file' writes the value alone to path (mode 600); with no path it goes to a new private file and "
    "the result gives you its path, to use inside a command, for example "
    "'gh auth login --with-token < PATH' or 'API_KEY=\"$(cat PATH)\" some-command'; delete that file "
    "with rm when you're done. "
    "'hermes' saves NAME in Hermes's own .env for this project, where Hermes's tools, skills and MCP "
    "servers read their keys. "
    "Ask for one secret per call. After saving, never print, cat, echo or log the secret; refer to it "
    "by its name or path."
)

SCHEMA = {
    "name": "request_secret",
    "description": DESCRIPTION,
    "parameters": {
        "type": "object",
        "properties": {
            "label": {
                "type": "string",
                "description": "What the secret is, as the user would name it, e.g. 'OpenAI API key'.",
            },
            "reason": {
                "type": "string",
                "description": "One short sentence for the user on what it's for, e.g. 'So the blog's "
                               "build can call OpenAI.' Mention where they can get it if that helps.",
            },
            "destination": {
                "type": "string",
                "enum": ["env_file", "file", "hermes"],
                "description": "Where the value goes. See the tool description.",
            },
            "path": {
                "type": "string",
                "description": "Absolute path (or ~/...). Required for env_file; optional for file.",
            },
            "name": {
                "type": "string",
                "description": "Variable name, e.g. OPENAI_API_KEY. Required for env_file and hermes.",
            },
        },
        "required": ["label", "reason", "destination"],
        "additionalProperties": False,
    },
}

# ---- helpers -----------------------------------------------------------------------------------


def _result(**fields) -> str:
    return json.dumps({k: v for k, v in fields.items() if v is not None})


def _fail(message: str) -> str:
    return _result(saved=False, error=message)


def _shown(path: Path) -> str:
    """The path as the user reads it: under the home folder as ~/..."""
    home = str(Path.home())
    s = str(path)
    return "~" + s[len(home):] if s == home or s.startswith(home + os.sep) else s


def _absolute(raw: str) -> Path | None:
    p = Path(os.path.expanduser(raw.strip()))
    return Path(os.path.realpath(p)) if p.is_absolute() else None


def _check_target(target: Path) -> str | None:
    """Why the value couldn't be written to target, checked before the user types anything."""
    if target.is_dir():
        return f"{_shown(target)} is a folder, not a file"
    if not target.parent.is_dir():
        return f"the folder {_shown(target.parent)} doesn't exist; create it first"
    if target.exists() and not os.access(target, os.W_OK):
        return f"{_shown(target)} isn't writable"
    if not target.exists() and not os.access(target.parent, os.W_OK):
        return f"the folder {_shown(target.parent)} isn't writable"
    return None


def _assignment(name: str) -> re.Pattern:
    return re.compile(r"^\s*(?:export\s+)?" + re.escape(name) + r"\s*=")


def _env_line(name: str, value: str) -> str:
    if _BARE.match(value):
        return f"{name}={value}"
    if "'" not in value:
        return f"{name}='{value}'"
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace("\x60", "\\\x60")
    return f'{name}="{escaped}"'


def _write_private(target: Path, data: str) -> None:
    """Atomic write that keeps an existing file's mode, else 600. The value never sits in a
    world-readable file, not even for a moment: the temp file is created 600."""
    mode = stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o600
    fd, tmp = tempfile.mkstemp(prefix=f".{target.name}.", dir=str(target.parent))
    try:
        with os.fdopen(fd, "w") as f:
            f.write(data)
        os.chmod(tmp, mode)
        os.replace(tmp, target)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def _has_assignment(target: Path, name: str) -> bool:
    if not target.exists():
        return False
    pattern = _assignment(name)
    return any(pattern.match(line) for line in target.read_text(errors="replace").splitlines())


def _upsert_env(target: Path, name: str, value: str) -> None:
    lines = target.read_text(errors="replace").splitlines() if target.exists() else []
    pattern = _assignment(name)
    out: list[str] = []
    done = False
    for line in lines:
        if pattern.match(line):
            if not done:
                out.append(_env_line(name, value))
                done = True
            continue  # a repeated NAME= line would override the new value
        out.append(line)
    if not done:
        out.append(_env_line(name, value))
    _write_private(target, "\n".join(out) + "\n")


def _private_dir() -> Path:
    from hermes_constants import get_hermes_home

    d = Path(get_hermes_home()) / "kitaab-secrets"
    d.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(d, 0o700)
    return d


def _ask(params: dict) -> str | None:
    """The user's answer: '' when they skipped or didn't answer in time, None when no Kitaab app
    can answer for this chat (a routine run, or no app connected)."""
    try:
        from gateway.session_context import get_session_env
        from tui_gateway import server_requests
        from tui_gateway.server import _sessions
    except Exception:
        logger.debug("request_secret: not running under Hermes's app gateway", exc_info=True)
        return None
    sid = get_session_env("HERMES_UI_SESSION_ID")
    if not sid or _sessions.get(sid) is None:
        return None
    with contextlib.suppress(Exception):
        if not server_requests._answerable(sid):
            return None
    result = server_requests.send("secret", sid, params, timeout=ASK_SECONDS)
    value = (result or {}).get("value", "")
    return value if isinstance(value, str) else ""


# ---- the tool ----------------------------------------------------------------------------------


def request_secret(args: dict, **_kw) -> str:
    label = str(args.get("label") or "").strip()
    reason = str(args.get("reason") or "").strip()
    destination = str(args.get("destination") or "").strip()
    name = str(args.get("name") or "").strip()
    raw_path = str(args.get("path") or "").strip()

    if not label:
        return _fail("label is required")
    if destination not in ("env_file", "file", "hermes"):
        return _fail("destination must be env_file, file or hermes")
    if destination in ("env_file", "hermes") and not _NAME.match(name):
        return _fail("name must be an environment variable name, like OPENAI_API_KEY")

    target: Path | None = None
    replaces = False
    if destination == "env_file" or (destination == "file" and raw_path):
        target = _absolute(raw_path) if raw_path else None
        if target is None:
            return _fail("path must be absolute or start with ~/")
        problem = _check_target(target)
        if problem:
            return _fail(problem)
        replaces = _has_assignment(target, name) if destination == "env_file" else target.exists()
    elif destination == "hermes":
        from hermes_constants import get_hermes_home

        target = Path(get_hermes_home()) / ".env"
        with contextlib.suppress(Exception):
            replaces = _has_assignment(target, name)

    metadata = {
        "kitaab": 1,
        "label": label,
        "reason": reason,
        "destination": destination,
        "path": _shown(target) if target else "",
        "name": name,
        "replaces": replaces,
    }
    value = _ask({"env_var": name or label, "prompt": label, "metadata": metadata})
    if value is None:
        return _fail(
            "No Kitaab app is connected to answer for this chat (or this is a routine run). Don't ask "
            "for the secret in chat. Tell the user what's needed and where it goes, and ask them to open "
            "this thread in Kitaab so you can try again."
        )
    value = value.strip()
    if not value:
        return _result(
            saved=False,
            skipped=True,
            message="The user skipped it. Don't ask for it in chat; carry on without it or ask how they'd like to proceed.",
        )
    if "\n" in value or "\r" in value:
        return _fail("the value has line breaks; only single-line secrets are supported")

    # Before it's written anywhere a later tool could read it back.
    with contextlib.suppress(Exception):
        from agent.redact import register_vault_redaction_value

        register_vault_redaction_value(value)

    note = "The value is in place. Never print, cat, echo or log it; refer to it by name or path."
    try:
        if destination == "env_file":
            _upsert_env(target, name, value)
        elif destination == "hermes":
            from hermes_cli.config import save_env_value_secure

            save_env_value_secure(name, value)
        elif target is not None:
            _write_private(target, value)
        else:
            stem = re.sub(r"[^a-z0-9]+", "-", (name or label).lower()).strip("-")[:40] or "secret"
            target = _private_dir() / f"{stem}-{secrets.token_hex(4)}"
            _write_private(target, value)
            note = (
                "This private file holds the secret. Use its path only inside a command (for example "
                "'gh auth login --with-token < PATH' or 'API_KEY=\"$(cat PATH)\" some-command'), then "
                "delete it with rm. Never print or cat it on its own."
            )
    except OSError as e:
        return _fail(f"couldn't save it: {e.strerror or e}. Ask the user to try again.")
    finally:
        del value

    return _result(
        saved=True,
        destination=destination,
        path=str(target) if target else None,
        name=name or None,
        replaced=replaces,
        note=note,
    )


def _scrub(result=None, **_kw):
    """Every tool result: drop any secret this process has been given (exact match)."""
    if not isinstance(result, str) or not result:
        return None
    try:
        from agent.redact import redact_registered_vault_values
    except Exception:
        return None
    cleaned = redact_registered_vault_values(result)
    return cleaned if cleaned != result else None


# ---- start_thread ------------------------------------------------------------------------------

START_DESCRIPTION = (
    "Start a new Kitaab thread and send its first message, so the work carries on in a thread of its "
    "own: a hand-off, a side task split out of this one, or a fresh start. The new thread shows up in "
    "Kitaab's thread list and its agent answers the message right away, as if the user had sent it. "
    "It can't see this chat, so write the message as a full brief: the goal, what is already known or "
    "decided, the files and links it needs, the user's preferences that matter, and what its first reply "
    "should do (for example: ask the user one question, and don't draft anything yet). Returns the new "
    "thread's id and a kitaab:// link; give the user that link. This is the only way to make a thread: "
    "never start one with the hermes CLI or by editing state.db."
)

START_SCHEMA = {
    "name": "start_thread",
    "description": START_DESCRIPTION,
    "parameters": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The thread's title in Kitaab's list, a few words, e.g. 'Launch post story'.",
            },
            "message": {
                "type": "string",
                "description": "The first message: the full brief the new thread starts from (markdown).",
            },
            "profile": {
                "type": "string",
                "description": "The Kitaab profile (Hermes profile id) to start it in. Leave out for this profile.",
            },
            "cwd": {
                "type": "string",
                "description": "The folder it works in, which puts it in the project owning that folder. "
                               "Leave out to start it in this thread's project (the same folder as this thread).",
            },
        },
        "required": ["title", "message"],
        "additionalProperties": False,
    },
}

_RID = "kitaab-start-thread"


def _error_text(reply: dict) -> str:
    err = reply.get("error") or {}
    return str(err.get("message") or err) if err else "unknown error"


def start_thread(args: dict, **_kw) -> str:
    title = " ".join(str(args.get("title") or "").split())[:120]
    message = str(args.get("message") or "").strip()
    # "project" is what this was called before profiles held projects.
    profile = str(args.get("profile") or args.get("project") or "").strip()
    cwd = str(args.get("cwd") or "").strip()
    if not title:
        return _fail("title is required")
    if not message:
        return _fail("message is required")
    try:
        from hermes_constants import get_hermes_home, profile_name_for_home
        from tui_gateway import server as gateway
        from tui_gateway.transport import bind_transport, reset_transport
    except Exception:
        logger.debug("start_thread: not running under Hermes's app gateway", exc_info=True)
        return _fail("Threads can only be started from inside Kitaab's Hermes server.")
    create = gateway._methods.get("session.create")
    submit = gateway._methods.get("prompt.submit")
    if create is None or submit is None:
        return _fail("This Hermes server can't start threads (no session.create).")
    here = profile_name_for_home(get_hermes_home()) or "default"
    profile = profile or here
    if not cwd and profile == here:
        # Same project as this thread: it works in this thread's folder.
        try:
            from agent.runtime_cwd import scoped_session_cwd
            cwd = scoped_session_cwd() or ""
        except Exception:
            cwd = ""

    # No app is watching the new thread yet. The detached sink keeps it resumable: events are
    # dropped, and when the user opens it Kitaab resumes it and gets the rest live.
    token = bind_transport(gateway._detached_ws_transport)
    try:
        params = {"profile": profile, "source": "desktop", "title": title}
        if cwd:
            params.update(cwd=os.path.expanduser(cwd), cwd_explicit=True)
        created = create(_RID, params)
        if "error" in created:
            return _fail(f"couldn't make the thread: {_error_text(created)}")
        made = created["result"]
        sent = submit(_RID, {"session_id": made["session_id"], "text": message})
    finally:
        reset_transport(token)
    thread = made["stored_session_id"]
    link = f"kitaab://thread/{thread}?profile={profile}"
    if "error" in sent:
        return _fail(f"the thread was made but its first message didn't go: {_error_text(sent)}")
    return _result(
        started=True,
        thread_id=thread,
        profile=profile,
        cwd=cwd or None,
        title=title,
        link=link,
        note="The new thread is answering its first message now. Tell the user with a markdown link to "
             "it, e.g. [" + title + "](" + link + ").",
    )


def register(ctx) -> None:
    ctx.register_tool(
        name="request_secret",
        toolset="kitaab",
        schema=SCHEMA,
        handler=request_secret,
        description="Ask the user for a secret and save it without seeing it",
        emoji="\U0001F511",
    )
    ctx.register_tool(
        name="start_thread",
        toolset="kitaab",
        schema=START_SCHEMA,
        handler=start_thread,
        description="Start a new Kitaab thread with a first message",
        emoji="\U0001F9F5",
    )
    ctx.register_hook("transform_tool_result", _scrub)
`

export const PLUGIN_FILES: Record<string, string> = { "plugin.yaml": PLUGIN_YAML, "__init__.py": INIT_PY }

const q = encodeURIComponent

function base64(s: string): string {
  let bin = ""
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** Writes the plugin into a project's home, enables it and loads it into the running backend. */
export async function installPlugin(project: Id, home: string): Promise<void> {
  const config = await http().get<{ plugins?: { enabled?: unknown; disabled?: unknown } }>(`/api/config?profile=${q(project)}`)
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
  const enabled = list(config.plugins?.enabled)
  // The user turned it off in Hermes; leave it that way.
  if (list(config.plugins?.disabled).includes(PLUGIN)) return
  for (const [name, content] of Object.entries(PLUGIN_FILES)) {
    await http().post("/api/files/upload", {
      path: `${home.replace(/\/+$/, "")}/plugins/${PLUGIN}/${name}`,
      data_url: `data:application/octet-stream;base64,${base64(content)}`,
      overwrite: true,
    })
  }
  if (!enabled.includes(PLUGIN)) {
    // plugins.enabled is a list, and a config save replaces lists, so send the whole list.
    await http().put(`/api/config?profile=${q(project)}`, {
      profile: project,
      config: { plugins: { enabled: [...enabled, PLUGIN] } },
    })
  }
  await http().post("/api/dashboard/agent-plugins/activate", { name: PLUGIN, home })
}
