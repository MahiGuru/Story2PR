#!/usr/bin/env bash
# handoff-hook.sh — Claude Code Stop hook for pipeline agent handoffs.
#
# Fires when the assistant finishes a turn. Extracts the final assistant
# message, regex-matches a pipeline agent handoff trigger (e.g.
# `@explorer.md Run the explorer`), and if found:
#   1. Copies the trigger to the OS clipboard
#   2. Emits a desktop notification
#   3. Writes it to `.claude/next-handoff.txt` as a persistent marker
#
# Rationale: Claude Code has no URL scheme to auto-open a new chat with
# a prefilled prompt (verified: Stop hooks are observability tools, not
# UI drivers). The best we can do is prepare the next command so the
# user's manual new-chat step is paste + Enter instead of retype + Enter.
#
# Cursor users get one-click deeplinks from agent output directly
# (see agent-pipeline/rules/agent-flow.mdc § Cursor deeplink reference).
# This hook is specifically for Claude Code users.
#
# Install: the pipeline installer adds an entry to .claude/settings.json
# pointing `hooks.Stop[*].command` at this script. Run with `--with-handoff-hook`
# when installing the pipeline.
#
# Exits 0 always — the hook must NEVER block the Stop event.

set -u

# Read stdin JSON (standard Claude Code Stop hook input).
INPUT=$(cat)

# Extract transcript_path (definitely exists in Stop hook payload).
# Older Claude Code versions may also ship `final_message`; prefer it
# when present, fall back to reading the transcript.
if ! command -v jq >/dev/null 2>&1; then
  # No jq — we can't parse JSON safely. Bail silently; hook must not fail noisily.
  exit 0
fi

TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
FINAL=$(printf '%s' "$INPUT" | jq -r '.final_message // empty' 2>/dev/null)

# Fallback: parse the transcript JSONL if `final_message` isn't present.
# Each transcript line is a JSON object; assistant messages appear with
# role="assistant" and content either as a string or an array of content
# blocks (text/tool_use/etc). We extract the last assistant text.
if [ -z "$FINAL" ] && [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  FINAL=$(jq -rs '
    map(select(
      (.role // .message.role // .type // "") == "assistant"
    ))
    | last
    | (.content // .message.content // "")
    | if type == "array"
      then (map(select(.type == "text")) | map(.text) | join("\n"))
      else tostring
      end
  ' < "$TRANSCRIPT" 2>/dev/null)
fi

# Nothing to work with — exit quietly.
if [ -z "$FINAL" ]; then
  exit 0
fi

# Match pipeline handoff triggers. Patterns:
#   @<agent>.md <instruction>            — standard invocation
#   Resume <agent> for <TICKET> from task T<N>  — resume pattern
# Prefer the LAST match in the assistant's text (most-recent suggested action).
# Regex stops at backticks (closing code span in markdown) or newlines
# (implicit under grep -o line-oriented scanning). Kept simple to avoid
# BSD-vs-GNU grep differences in char-class interpretation.
TRIGGER=$(printf '%s' "$FINAL" \
  | grep -oE '@[a-z0-9-]+\.md[[:space:]][^`]{3,160}' \
  | tail -1 \
  | sed -E 's/[[:space:]]+$//')

# Try resume pattern if no @-trigger found.
if [ -z "$TRIGGER" ]; then
  TRIGGER=$(printf '%s' "$FINAL" \
    | grep -oE 'Resume[[:space:]]+[a-z0-9-]+[[:space:]]+for[[:space:]]+[A-Z]+-[0-9]+[[:space:]]+from[[:space:]]+task[[:space:]]+T[0-9]+' \
    | tail -1)
fi

# No handoff trigger in the response — nothing to hand off.
if [ -z "$TRIGGER" ]; then
  exit 0
fi

# 1. Clipboard (platform-specific, silent on failure — no clipboard tool available is OK).
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$TRIGGER" | pbcopy 2>/dev/null || true
elif command -v wl-copy >/dev/null 2>&1; then
  printf '%s' "$TRIGGER" | wl-copy 2>/dev/null || true
elif command -v xclip >/dev/null 2>&1; then
  printf '%s' "$TRIGGER" | xclip -selection clipboard 2>/dev/null || true
elif command -v xsel >/dev/null 2>&1; then
  printf '%s' "$TRIGGER" | xsel --clipboard --input 2>/dev/null || true
elif command -v clip.exe >/dev/null 2>&1; then
  # Windows (WSL) — clip.exe reads UTF-16LE on recent builds; plain pipe works on most.
  printf '%s' "$TRIGGER" | clip.exe 2>/dev/null || true
fi

# 2. Desktop notification (background so the hook returns instantly).
NOTIF_TITLE="Pipeline handoff ready"
NOTIF_BODY="Clipboard loaded — open new chat, paste, press Enter."
NOTIF_SUB=$(printf '%s' "$TRIGGER" | head -c 80)

if command -v osascript >/dev/null 2>&1; then
  # macOS
  (osascript -e "display notification \"${NOTIF_BODY}\" with title \"${NOTIF_TITLE}\" subtitle \"${NOTIF_SUB}\"" >/dev/null 2>&1 &) >/dev/null 2>&1
elif command -v notify-send >/dev/null 2>&1; then
  # Linux (freedesktop)
  (notify-send "${NOTIF_TITLE}" "${NOTIF_SUB}" >/dev/null 2>&1 &) >/dev/null 2>&1
elif command -v powershell.exe >/dev/null 2>&1; then
  # Windows (WSL) via BurntToast-less fallback — basic MessageBox is synchronous
  # which would stall the hook; skip on Windows for now. Clipboard still works.
  :
fi

# 3. Persist last handoff to .claude/next-handoff.txt for a future /handoff
#    slash command or manual recovery. `.claude` lives at $CWD (the project root).
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
if [ -n "$CWD" ] && [ -d "$CWD/.claude" ]; then
  printf '%s\n' "$TRIGGER" > "$CWD/.claude/next-handoff.txt" 2>/dev/null || true
fi

exit 0
