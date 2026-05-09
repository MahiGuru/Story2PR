---
name: agent-pipeline-flow
description: Generic 5-agent pipeline (orchestrator → explorer → surgeon → review → ship) with the Amender subagent kernel-wired at `orchestrator_amend_request`. Additional subagents can be pack-supplied via three more extension points. Auto-detects Story / Sub-Bug / Bug mode from JIRA issuetype + parent link. Triggers on "Work on {TICKET}" and related phrases. Project-specific standards, LLD/bug-localization skills, and subagents are provided by an installed project pack.
---

# Agent Pipeline Flow (5 agents + Amender subagent + extension points for pack-supplied subagents)

```
orchestrator → explorer → surgeon → review → ship
  (Plan/LLD     (Explore     (Implement)   (Verify)   (PR+Commit)
   or Bug       or Localize)
   Context)
```

Subagents are pack-supplied delegated workers that fire at kernel extension
points. The kernel ships an **amender** subagent at Orchestrator's Phase C
gate for targeted LLD amendments without full regeneration. Other packs may
ship different subagents at any of the four extension points:
`orchestrator_amend_request`, `surgeon_pre_task`, `surgeon_post_task`, `review_post_check`.

Git commits owned by Ship only. Orchestrator, Explorer, Review are read-only.
Surgeon writes code. Ship writes git.

---

## Kernel vs. project packs

This is the **kernel index**. The kernel ships:

- 5 agent prompts in `agents/` (orchestrator, explorer, surgeon, review, ship)
- 1 generic rule in `rules/` (`agent-flow.mdc` — always-on pipeline rules)
- This index file

The kernel is **project-agnostic**. It contains zero references to any
specific codebase, language, framework, or JIRA project. It cannot actually
run a ticket by itself — Orchestrator needs an LLD generator skill,
Explorer (Bug Mode) needs bug localization skills, Surgeon needs layer
coding standards skills.

**Project packs** provide these project-specific pieces. A pack is a folder
with the same shape as the kernel (`rules/`, `skills/`, an example
`pipeline.<pack>.example.yaml` and `project-context.<pack>.example.md`)
that gets installed alongside the kernel into the same `.cursor/` folders.

The kernel supports any pack at `packs/{name}/`. Each pack supplies a project-specific
skill set, rule set, and `pipeline.{name}.yaml` config — the kernel reads these at runtime
and knows nothing about any specific stack.

See the root `README.md` install section for how to install the kernel with or without a pack.

---

## What each agent reads and writes

| Step | Agent | Reads | Writes |
|------|-------|-------|--------|
| 1 | Orchestrator | JIRA ticket, `contexts/config/pipeline.yaml`, `contexts/project-context.md`, pre-flight inputs, LLD generator skill (from pack) | `contexts/{TICKET_ID}.md` with PART 1-4 |
| 2 | Explorer | `contexts/{TICKET_ID}.md`, epic codebase map (if exists), bug localization skills (from pack, Bug Mode only) | Hypotheses + insertion points into the same file, or `{EPIC_ID}-codebase-map.md` on first story |
| 3 | Surgeon | `contexts/{TICKET_ID}.md` PART 2, layer coding standards skills (from pack, per-task by `Layer` field) | Code files + `contexts/{TICKET_ID}-manifest.md` |
| 4 | Review | `contexts/{TICKET_ID}.md`, changed code | `contexts/{TICKET_ID}-review.md` |
| 5 | Ship | Everything above | Git commits, remote PR, updated codebase map metadata |
| — | Amender _(kernel subagent)_ | `contexts/{TICKET_ID}.md` | Targeted section-level edits to the same file. Fires at `orchestrator_amend_request` extension point. |

---

## Primary trigger (auto-detects mode)

```
Work on {TICKET_ID}
```

Orchestrator fetches the JIRA ticket, reads `issuetype` and parent link,
routes to the right mode (Story / Standalone Bug / Sub-Bug), captures
context, generates the LLD or bug context, suggests a branch, and stops
at the Phase C gate.

### With inline context

```
Work on {TICKET_ID}

Context:
- Prior attempts: TICKET-111 and TICKET-222 both reverted
- Look at: path/to/relevant/file.ext
- Avoid: other/team/owned/module (other team owns it)
- Deadline pressure, keep scope tight
```

Inline context has the highest priority of the four context sources
(project context < JIRA < pre-flight file < inline).

### With a pre-flight file

1. Copy `contexts/config/ticket-input.template.md` to `contexts/{TICKET_ID}-input.md`
2. Fill in the sections you have info for
3. Run `Work on {TICKET_ID}`
4. Orchestrator auto-loads the file during Phase A0 and merges it into the LLD

---

## The 4-part working document shape

Every ticket (Story or Bug) produces a 4-part document at `contexts/{TICKET_ID}.md`:

```
# PART 1 — LLD (Design) / Bug Context
# PART 2 — LLD Tasks / Fix Tasks
# PART 3 — Test Plan / Root Cause Hypotheses
# PART 4 — Test Plan Tasks / Regression Test Tasks
```

Surgeon, Review, and Ship read the same structure regardless of mode.
This is the architectural payoff of the 4-part contract: downstream
agents are mode-agnostic.

---

## Gates

Every agent stops at a gate with:

```
## [Step N/5] {agent} — {phase} DONE

**Summary:** <key metrics>

> **👉 Next action:** Pick one of the following:
> - `{primary}` — {description}
> - `{alternative}` — {description}
```

You are always in control. No agent proceeds without your OK. No code is
committed without two confirmations (Surgeon's gate + Ship's double gate).

---

## How skills are loaded

**Tier 1 — Rules** (`.cursor/rules/*.mdc` with `alwaysApply: true`):
Always injected into every agent run. Kernel ships `agent-flow.mdc`.
Packs add project-specific rules (e.g., `{pack}-project-scope.mdc`,
`{pack}-file-placement.mdc`).

**Tier 2 — Skills** (`.cursor/skills/*.md`):
Loaded on-demand by agents. Kernel ships only this index. Packs ship the
actual content skills:
- LLD generator (Orchestrator, Story Mode) — filename declared in
  `skills.orchestrator.lld_generator`
- Bug localization (Explorer, Bug Mode) — filenames declared in
  `skills.explorer.{bug_router,bug_frontend,bug_backend}`
- Layer coding standards (Surgeon, per-task by `Layer` field) — filenames
  declared in `skills.layer_map[].skills`

Surgeon's layer-to-skill map is **read from `contexts/config/pipeline.yaml`**
at pre-flight (the `skills.layer_map` block). Packs declare the
mapping there, not by editing the Surgeon agent. See
`contexts/config/pipeline.{PACK}.yaml` for a worked example
of the schema — the installer copies it to `contexts/config/pipeline.yaml`
at install time. Customize that copy.

**Subagents** (`{.cursor,.claude}/agents/subagent-*.md`):
Pack-supplied delegated workers that fire at kernel extension points.
Unlike skills (loaded as reference material), subagents are *invoked* —
the parent agent hands control to the subagent, waits for a return verb,
and acts on it. Declared in `subagents` under the appropriate
extension point key. The kernel defines four extension points:

- `orchestrator_amend_request` — fires when the user requests an amendment to Orchestrator's plan (kernel ships the Amender here)
- `surgeon_pre_task` — Surgeon, after layer resolution, before code change
- `surgeon_post_task` — Surgeon, after per-task build passes
- `review_post_check` — Review, after AC compliance check

Packs ship subagent files in `packs/<name>/agents/` and install them
to `.cursor/agents/` alongside the kernel agents. A pack with no
subagents simply omits the `subagents` section — all
extension points are skipped at zero cost.

---

## Running without a pack

The kernel can run with no pack installed, but usefulness is limited:

- **Surgeon** degrades to Tier 1 rules only. At pre-flight, if
  `contexts/config/pipeline.yaml` is missing or malformed, Surgeon
  warns and proceeds without per-task skill loading or per-task build
  verification. Tier 1 rules (host-tool-injected, `alwaysApply: true`)
  still apply.
- **Story Mode:** no `skills.orchestrator.lld_generator` → Phase B
  falls back to producing a minimal 4-part document with empty design
  sections. Usable for very simple tickets, not for real features.
- **Bug Mode:** no `skills.explorer.bug_*` skills → Explorer
  relies on generic file-path guessing. Viable for tiny bugs, weak for
  anything complex.

For serious use, install a pack.
