# Agent Trigger Map

A single reference for **which agent runs, when, and from which trigger** — plus where subagents fire, when skills load, and what the gates and flags are.

> **How to read this:** In **Cursor**, prefix with `@<agent-file>.md <trigger>` for reliable invocation. In **Claude Code**, the plain trigger works too (`Work on JIRSTORY-1234`). Both forms are equivalent — the plain form routes via the auto-start rule in `agent-flow.mdc`; the `@` form forces the agent file to load explicitly.

---

## 1. How a trigger becomes an agent run

- `agent-flow.mdc` is a **Tier-1 rule** (`alwaysApply: true`) — the host injects it into **every** conversation automatically. You never load it.
- Its `description:` field lists the trigger phrases; your input matching one makes the rule fire.
- On a match, the rule requires: **(1) load the matching agent `.md` fully → (2) execute it with real tool calls → (3) never just describe it.**
- **Auto-start:** `Work on {TICKET}` / `Work on story {TICKET}` / a browse URL → **orchestrator** (Step 1). The orchestrator's `load_context (A0)` step 2b extracts `{TICKET_ID}`.
- **Pack resolution** runs once at pre-flight (glob `contexts/config/pipeline.*.yaml` → read `meta.pack`) so every `pipeline.{PACK}.*` path resolves.
- After any run, a **post-execution verification** layer checks the expected outputs exist; if missing it emits `⚠ Agent execution verification FAILED`.

```
You type:  Work on story JIRSTORY-1234
  → agent-flow.mdc already loaded (alwaysApply) → "Work on story" trigger fires
  → Auto-start → load orchestrator.md fully + EXECUTE
  → Pack resolution → load_context A0 (reads config, loads per-run skills, extracts TICKET_ID)
  → runs to the Phase C gate → routes you to the next agent
```

---

## 2. Pipeline — single story (the main flow)

Order: **Orchestrator → Explorer → Surgeon → (AC-E2E-Check, optional) → Review → Ship.** One command per step, a gate between each.

| # | Agent | Trigger | When you run it | Gate it stops at |
|---|-------|---------|-----------------|------------------|
| 1 | **orchestrator** | `@orchestrator.md Work on JIRSTORY-1234` | Start of every story | Phase C — `Go` / `Amend:` / `Cancel` |
| 2 | **explorer** | `@explorer.md Run the explorer` | After Phase C `Go` | Review annotations → run surgeon |
| 3 | **surgeon** | `@surgeon.md Run the surgeon` | After exploration | After final build |
| 3.5 | **ac-e2e-check** *(optional)* | `@ac-e2e-check.md Demo JIRSTORY-1234` | Between Surgeon and Review | Coverage matrix / browser results |
| 4 | **review** | `@review.md Run the review` | After Surgeon (or AC-E2E) | Ship-ready YES/NO |
| 5 | **ship** | `@ship.md Ship it` | After Review says YES | Commit strategy, then `Confirmed` |

**Variants**
- Pattern reference: `@orchestrator.md Work on JIRSTORY-1234 — reference: JIRSTORY-100`
- Faster review (trust Surgeon): `@review.md Run the review --slim`
- Ship aliases: `Ship it` · `Run the ship` · `raise PR` · `push it`

---

## 3. Setup & maintenance (project-analyzer, Step 0)

Run once at onboarding, then on-demand. Not part of the per-story flow.

| Agent | Trigger | When |
|-------|---------|------|
| **project-analyzer** | `@project-analyzer.md Analyze project` | First-time setup — writes `project-map.md` + auto-fills config |
| **project-analyzer** | `@project-analyzer.md Rescan <stack>[/section]` | After significant code churn (e.g. `Rescan Java`) |

CLI (not agent triggers): `npm run install-pipeline` · `node contexts/tools/validate.mjs`

---

## 4. Bundle mode — multi-story (2–10 related stories → 1 PR)

Routes to the dedicated `bundle-*` agents. **Disambiguation:** the bundle router fires only when the text has the keyword `epic` **and** either 2+ comma-separated IDs after `epic stories`, or `status=` / `group=`. Anything else stays single-story.

| # | Agent | Trigger |
|---|-------|---------|
| 1 | **bundle-orchestrator** | `@bundle-orchestrator.md Work on epic stories JIRSTORY-1234, JIRSTORY-1235, JIRSTORY-1236` |
|   |  | or `@bundle-orchestrator.md Work on epic JIRSTORY-EPIC-42 with status="Ready for Dev"` |
| 2 | **bundle-explorer** | `@bundle-explorer.md Run the bundle explorer` |
| 3 | **bundle-surgeon** | `@bundle-surgeon.md Run the bundle surgeon` |
| 4 | **bundle-review** | `@bundle-review.md Run the bundle review` |
| 5 | **bundle-ship** | `@bundle-ship.md Ship the bundle` |

Bundle flags: `--linear` (consolidated execution) · `--deep` (upfront overlap grep) · `--max=<N>` · `--fresh`

---

## 5. Standalone — no ticket, ad-hoc single-agent runs

Output lands in `contexts/standalone/`. Size caps apply. **No standalone for:** orchestrator (it starts the pipeline), explorer-bug, ship (safety rail — needs a Review).

| Agent | Trigger | Output |
|-------|---------|--------|
| explorer | `@explorer.md Research: <question>` · `Explore: <spec>` | exploration file |
| surgeon | `@surgeon.md Apply: <spec> in <files>` | code (≤5 files, ≤150 lines) |
| surgeon | `@surgeon.md Implement:` + bullet ACs | code (≤5 ACs) |
| review | `@review.md Review changes` | diff quality report |
| review | `@review.md Review JIRSTORY-1234` | AC coverage + quality |
| ac-e2e-check | `@ac-e2e-check.md Demo <URL>` · `Verify: <scenario>` | browser walk |

---

## 6. Subagents — auto-fired, NOT user-typed

Subagents are **called by a parent agent** at a specific step; you never trigger them directly. The kernel ships **two** (committed).

| Subagent | Fired by · step | Fires when |
|----------|-----------------|------------|
| **image-analysis** | Orchestrator · `resolve_enrichments (A0.6)` | ≥2 images available (design attached / Figma / JIRA) |
| **amender** | Orchestrator · `gate_for_approval (C)` | You type `Amend: <change>` at the Phase C gate |

> Everything else (epic + reference enrichment, per-task exploration, code review, blast radius) runs **inline** in the agent that needs it. A pack can add its own subagents at extension points (`surgeon_pre_task`, `surgeon_post_task`, `review_post_check`) via `subagents:` in `pipeline.<pack>.yaml`.

---

## 7. Skills — when they load (not user-triggered)

`agent-flow.mdc` routes to agents; **skills load inside the agent prompts**, driven by `pipeline.{PACK}.skills.yaml`. Rules are always-on (Tier 1); skills are on-demand (Tier 2).

| Skill | Loads in · step | When |
|-------|-----------------|------|
| `ticket_schema_story` · `lld_generator` · `ac_templates` | Orchestrator · `load_context (A0)` | **Once per run**, unconditionally |
| `layer_map[<layer>].skills` | Surgeon · `load_coding_standards (0b)` | **Per task** — when the task's files/layer match (Strategy A `path_glob` ∪ Strategy B layer-string) |
| `extra_triggers` | Surgeon · per task | Additively, when a natural-language condition matches (e.g. a11y, tests) |
| per-layer standards | Review · code review | Default mode only (skipped in `--slim`) |

---

## 8. Gate replies — inputs you type at a stop (not agent triggers)

Gates pause for your word. These are replies **inside** the current chat, so they get no `@` prefix and no deeplink.

| Gate (agent · step) | Reply options |
|---------------------|---------------|
| Phase C approval (Orchestrator) | `Go` · `Go, branch <name>` · `Amend: <change>` · `Cancel` |
| MCP fallback (Orchestrator A0.6.2) | `retry` · `inline` + `Context:` · `file` · `upload` · `skip` · `cancel` |
| Build-failure (Surgeon, after 5 retries) | `retry` · `skip` · `cancel` |
| Review verdict | `Fix all P1` (then re-run) · proceed to `Ship it` |
| Ship — commit (step 2) | `Single commit` · `Per-task commits` · `Custom: <grouping>` |
| Ship — push (step 4, double-gated) | `Confirmed` · `Undo commits` · `Show diff` |
| Context pressure ORANGE/RED | `Resume in fresh chat` · `Continue anyway` · `Pause` · (RED) `Override pressure halt — I accept the risk` |
| Resume after a stop | `Resume <agent> for JIRSTORY-1234 from task T<N>` |

---

## 9. Per-run flags (combine with any pipeline trigger)

| Flag | Effect |
|------|--------|
| `--offline` | Skip all 3 MCPs; provide ticket via `contexts/ticket-input.md` + images |
| `--skip atlassian,figma` | Skip specific MCPs (comma-separated) |
| `--only github` | Use only the named MCP, skip the rest |
| `--fresh` | Ignore prior artifacts for this ticket (never deletes files) |
| `--slim` | Review: build + tests + presence only (~40% cheaper, never ship-ready) |
| `--linear` / `--deep` / `--max=<N>` | Bundle-mode controls |

---

## 10. Diagnostics

| Trigger | Does |
|---------|------|
| `Verify last agent run` (or `Did it work?` / `What's missing?`) | Runs post-execution verification on the last agent trigger |

---

**Source of truth:** trigger phrases live in `agent-pipeline/rules/agent-flow.mdc` (`description:` line + "CRITICAL — how to invoke agents" + Auto-start). Per-agent behavior lives in `agent-pipeline/agents/*.md`. Skill wiring lives in `contexts/config/pipeline.<pack>.skills.yaml`.
