# Agent Pipeline

**Project-neutral agent pipeline** · 1 setup agent + 5 story agents + 5 bundle agents + 2 subagents · Dual-host: Cursor + Claude Code · Kernel + project packs · Single-story + bundle + standalone modes · MCP-driven auto-enrichment

A system for running software engineering work through a chain of specialized agents (plan → explore → implement → verify → review → ship), with a gate at every step and full config-driven behavior. Works on any project — pack-specific details (YourApplication, whatever) come from `pipeline.yaml`.

---

## Quick Start

```
@orchestrator.md Work on PROJ-1234
```

That's the full pipeline in one command. After each agent, the gate tells you what to type next.

**Several related stories at once?** Bundle them into ONE branch + ONE PR:
```
@bundle-orchestrator.md Work on epic stories PROJ-1234, PROJ-2345, PROJ-3432
```
The keyword **`epic`** is required, and use full JIRA keys (`PROJ-1234`, not `1234`). See [Bundle mode](#invocation-modes) below.

**Not a JIRA ticket?** Run one agent directly:
- `@explorer.md Research: <question>` — codebase research
- `@surgeon.md Apply: <spec>` — one-off fix
- `@review.md Review changes` — spot-check your diff

Full command cheat sheet → [`HOW-TO-USE.md`](./HOW-TO-USE.md).

---

## Where to look

| I want to… | Go to |
|------------|-------|
| Know what to type | [`HOW-TO-USE.md`](./HOW-TO-USE.md) — command cheat sheet + per-role setup |
| Understand one agent | Read its prompt at `agent-pipeline/agents/<agent>.md` |
| Set up the pipeline for a team | `HOW-TO-USE.md` § Tech Lead — install, validate, customize, announce |
| Configure the pipeline | `contexts/config/pipeline.yourproj.yaml` — every key is commented |
| Understand the architecture | Section "Architecture" below |
| Troubleshoot | `HOW-TO-USE.md` § Common Issues |
| Validate my config | `node contexts/tools/validate.mjs` |
| See release history | [`CHANGELOG.md`](./CHANGELOG.md) |

---

## Install

### Prerequisites

- Node 18+ (for installer + validator)
- Cursor OR Claude Code (dual-host; same kernel works in both)
- For MCP features: Atlassian OAuth access, GitHub PAT, optional Figma token

### One-liner

```bash
# From the unzipped release folder
node contexts/tools/install.mjs --pack yourproj --target /path/to/your/project
```

This copies:
- Kernel → `.cursor/` (agents, rules, skills for Cursor) or equivalent for Claude Code
- Pack skills + rules → `.cursor/` (pack-specific standards layer on top)
- `pipeline.yaml` + `project-context.md` → `contexts/config/`
- Tooling → `contexts/tools/` (validator, installer reruns)
- `mcp.sample.json` + `mcp.sample.README.md` → reference for each dev's personal MCP config

### Validate

```bash
node contexts/tools/validate.mjs
```

Expects 10 checks to pass. Most common failure: YAML indentation in `pipeline.yaml`.

### First run

```
@project-analyzer.md Analyze project
```

Scans the codebase once (5-15 min). Produces `contexts/project-map.md` and populates `pipeline.yaml` auto-blocks (layer_map, shared_paths).

Then start work:
```
@orchestrator.md Work on PROJ-1234
```

Full setup walkthrough → `HOW-TO-USE.md` § Tech Lead.

---

## Architecture

### Kernel + pack split

```
agent-pipeline/                 ← KERNEL (project-neutral)
├── agents/                     ← agent prompts (7 single-story agents + 2 subagents)
│   ├── bundle/                 ← 5 dedicated bundle agents (self-contained, multi-story)
│   └── modes/                  ← lazy-loaded flow files (bug + standalone modes)
├── rules/                      ← always-on rules (agent-flow.mdc + bulk-agent-flow.mdc for bundle)
├── skills/                     ← kernel skills (fallback templates, strategy docs)
├── docs/agents/                ← per-agent walkthroughs
└── bin/                        ← shell helpers

packs/<pack-name>/              ← PROJECT PACK (stack-specific)
├── skills/                     ← pack-specific Tier 2 standards (angularjs, java, etc.)
└── rules/                      ← pack-specific postverify rules

contexts/                       ← RUNTIME DATA (per-project, committed to your repo)
├── config/
│   └── pipeline.<pack>.yaml    ← the contract between kernel and pack
├── project-map.md              ← Project Analyzer output (shared globally)
├── <epic>/                     ← per-epic folder (pipeline mode)
│   └── <TICKET>.md + -lld.md + -testplan.md + -exploration.md + ...
└── standalone/                 ← ad-hoc outputs (standalone mode)
```

The **kernel** is project-agnostic — no YourApplication/React/whatever hardcoded. The **pack** provides stack-specific skills + config. Swap packs to use the pipeline on a new stack.

### 3-file LLD split

Every ticket produces three companion files in `contexts/<epic>/`:
- `<TICKET>.md` — Requirement Summary + Enriched AC Registry + Companion index
- `<TICKET>-lld.md` — PART 1 (Design) + PART 2 (Tasks)
- `<TICKET>-testplan.md` — PART 3 (Test Plan) + PART 4 (Test Tasks)

Downstream agents read only the file they need. Full details in `agent-pipeline/rules/agent-flow.mdc`.

### Dual-host

| Host | Invocation pattern | Reliability |
|------|-------------------|-------------|
| Cursor | `@<agent-file>.md <trigger>` | Use `@` prefix — plain triggers are probabilistic |
| Claude Code | `@<agent-file>.md <trigger>` OR plain triggers | Both reliable |

---

## Agents at a glance

| # | Agent | Step | Purpose |
|---|-------|------|---------|
| 01 | Project Analyzer | 0 (setup) | Scan codebase → `project-map.md` + yaml auto-blocks |
| 02 | Orchestrator | 1/5 | JIRA ticket → Requirement Summary + 3-file LLD + branch |
| 03 | Explorer | 2/5 | Find existing code, reuse candidates, insertion points |
| 04 | Surgeon | 3/5 | Execute tasks in dependency order with pack standards |
| 05 | AC-E2E-Check | 3.5/5 (optional) | Browser verification of ACs + gap analysis |
| 06 | Review | 4/5 | Full build + tests + code review + blast radius + AC compliance |
| 07 | Ship | 5/5 | Commit + push + PR + JIRA transitions |
| 08 | Subagent-Amender | Subagent | Targeted LLD amendments at Orchestrator's Phase C gate |
| 09 | Subagent-Image-Analysis | Subagent | Turns design images into a compact visual spec (Orchestrator enrichment) |

**Bundle (multi-story):** 5 dedicated agents mirror the single-story chain — `bundle-orchestrator` → `bundle-explorer` → `bundle-surgeon` → `bundle-review` → `bundle-ship` (in `agent-pipeline/agents/bundle/`, each self-contained). Reached only via bundle triggers; see [Bundle mode](#invocation-modes).

---

## Invocation modes

Three ways to run — pick by the shape of the work:

| Mode | Use when | Start with |
|------|----------|-----------|
| **1 · Direct** | One JIRA story, full pipeline → PR | `@orchestrator.md Work on PROJ-1234` |
| **2 · Standalone & offline** | Ad-hoc single-agent work, or no-network / private runs | `@explorer.md Research: …` · add `--offline` to any trigger |
| **3 · Bundle** | 2–10 related stories → ONE branch + ONE PR | `@bundle-orchestrator.md Work on epic stories …` |

---

### 1 · Direct — single story (default)

The full pipeline, one command per step, a gate between each:

```
@orchestrator.md Work on PROJ-1234
  ↓ gate
@explorer.md Run the explorer
  ↓ gate
@surgeon.md Run the surgeon
  ↓ gate  (optional: @ac-e2e-check.md Demo PROJ-1234)
@review.md Run the review
  ↓ gate
@ship.md Ship it
```

Full LLD, full audit trail, PR. Bug tickets use the same triggers — the Orchestrator auto-detects `issuetype: Bug` and switches the plan shape.

---

### 2 · Standalone & offline

**Standalone (no ticket)** — run a single agent ad-hoc. Outputs land in `contexts/standalone/` as `standalone-*-{timestamp}.md`.

```
@explorer.md Research: <question>              — codebase research
@explorer.md Explore: <task spec>              — ad-hoc exploration
@surgeon.md Apply: <spec> in <files>           — direct change (caps: ≤5 files, ≤150 lines)
@surgeon.md Implement: <bullet list of ACs>    — AC-driven change (≤5 ACs)
@review.md Review changes                      — code-quality review
@review.md Review <TICKET>                      — AC coverage against ticket
@review.md Review against: <bullets of ACs>    — AC coverage with inline ACs
@ac-e2e-check.md Demo <URL>                    — ad-hoc browser walkthrough
```

*No standalone:* Orchestrator (it IS the pipeline start), Explorer-bug (needs structured Bug Context), Ship (safety rail — requires Review).

**Offline (no / partial MCP)** — add a flag to **any** pipeline trigger (direct or bundle). Skips MCP calls for privacy / air-gapped / token-saving (~15–40K per story); provide the ticket via `contexts/ticket-input.md` + attached images.

```
@orchestrator.md Work on PROJ-1234 --offline            — skip ALL MCPs (ticket from ticket-input.md)
@orchestrator.md Work on PROJ-1234 --skip atlassian     — skip JIRA/Confluence only
@orchestrator.md Work on PROJ-1234 --skip atlassian,figma
@orchestrator.md Work on PROJ-1234 --only github        — use ONLY GitHub, skip the rest
```

If an MCP flakes mid-run on a default trigger, the Orchestrator prompts a fallback gate (`retry` / `inline` / `file` / `skip` / `cancel`) — no re-trigger needed.

---

### 3 · Bundle — multiple related stories

Consolidate **2–10 related stories** into ONE LLD, ONE branch, ONE PR. Use it when stories share code (overlapping ACs, shared components). Bundle mode has its own **dedicated agents** (`agents/bundle/bundle-*.md`, each self-contained) and its own always-on rule (`bulk-agent-flow.mdc`) — direct single-story triggers are never affected.

```
@bundle-orchestrator.md Work on epic stories PROJ-1234, PROJ-2345, PROJ-3432
  ↓ gate
@bundle-explorer.md Run the bundle explorer
  ↓ gate
@bundle-surgeon.md Run the bundle surgeon
  ↓ gate
@bundle-review.md Run the bundle review
  ↓ gate
@bundle-ship.md Ship the bundle       — ONE PR closing all tickets + per-ticket JIRA transitions
```

**Start-trigger forms** (the router fires only when the text has the keyword `epic` **and** either 2+ comma-separated IDs, or a `status=`/`group=` filter — use full JIRA keys, not bare numbers):

| Trigger | What it does |
|---|---|
| `Work on epic stories PROJ-1234, PROJ-2345, PROJ-3432` | Explicit ticket list |
| `Work on epic PROJ-EPIC-42 with status="Ready for Dev"` | Discover the epic's children by status |
| `Work on epic PROJ-EPIC-42 group=ready_for_dev` | Discover by status-group shorthand |

**Flags** (append to the start trigger): `--linear` (consolidated execution instead of per-story gates) · `--deep` (upfront overlap analysis) · `--max=<N>` (raise the ticket cap) · `--fresh` (ignore prior state, re-synthesize) · `--offline` / `--skip <mcp>` (same offline family as direct mode).

**Resume after a stop:** `Resume bundle-<agent> for <BUNDLE_ID> from T<N>`, or just re-issue the original `Work on epic stories …` trigger — `bundle-orchestrator` detects the existing `_bundle-state.yaml` and offers resume options. Surgeon + Review checkpoint every N tasks, each emitting a fresh-chat resume deeplink.

**When NOT to bundle:** a single ticket (use direct mode) · unrelated code areas · Bug tickets (bundle accepts Story / Task / Spike only) · when you need per-ticket rollback granularity.

---

### Enrichment (reference + images + MCP)

Layer onto any mode. Caps: 1 reference ticket + 3 images per run.

**Explicit:**
```
@surgeon.md Implement:
  - AC1: ...
  — reference: PROJ-100
[attach design.png]
```

**Automatic via MCP** (when connected):
```
@orchestrator.md Work on PROJ-1234
# Atlassian MCP: auto-discovers linked "is similar to" ticket + JIRA image attachments
# Figma MCP:     auto-fetches frame data from Figma URLs in description
# GitHub MCP:    inspects reference ticket's PR for ship-ready verification
```

No MCPs connected → standard pipeline runs unchanged. Explicit trigger wins over MCP discovery.

Full enrichment details → [`HOW-TO-USE.md`](./HOW-TO-USE.md) § Enrichment.

---

## What Project Analyzer produces

`project-map.md` is the shared knowledge all other agents consume:

```
§ 1  Tech stack              frameworks, versions, build tool
§ 2  Folder map              major directories, owning framework, purpose
§ 3  Shared UI components    from shared_paths.frontend.ui_elements
§ 3b Promotion candidates    feature-local components used 3+ places
§ 4  Shared backend services from shared_paths.backend.services
§ 5  REST endpoints          resource classes + paths + methods
§ 6  Config files            init.xml, properties, etc.
§ 6-enh  Enhanced endpoints  endpoint → consuming page cross-ref
§ 7  Database                ORM, models, DAOs
§ 8  Build system            targets, test commands
§ 9  Test frameworks         JUnit, Jasmine, Jest, pytest, etc.
§ 10  Intents                button-action classifications (destructive-confirm, submit, etc.)
§ 10c  Button intent map     page → button → intent → required ACs
§ 11  i18n                   messages file, key format, allowed/forbidden content
§ 12  Rescan log             history of rescans + scope
```

Every downstream agent reads from this. Running `@project-analyzer.md Rescan <stack>` refreshes a subset.

---

## Configuring `pipeline.yaml`

Every config key is commented inline. The minimum to set for a new project:

```yaml
meta:
  schema_version: 4
  pack: <pack-name>             # e.g. "yourproj"

runtime:
  contexts_layout:
    nested_by_epic: true         # recommended — one folder per epic
  branching:
    base_branch: develop         # or main / master
    prefix_story: feature/
    prefix_bug: fix/

jira:
  project_key: "PROJ"
  label: "agentic-team"
  reference_link_types:
    - "is similar to"            # for MCP auto-enrichment

mcp_servers:
  atlassian: { required: true, used_by: [orchestrator, review, ship] }
  github:    { required: true, used_by: [orchestrator, explorer, review, ship] }
  figma:     { required: false, used_by: [orchestrator] }

skills:
  layer_map: { ... }             # your layers → skill files
  orchestrator:
    ticket_schema_story: <pack>-ticket-schema-story.md
    lld_generator: <pack>-lld-generator.md
    ac_templates_intent_aware: <pack>-ac-templates-intent-aware.md

shared_paths:                    # where your shared components live
  frontend: { ... }
  backend:  { ... }

builds:
  commands: { <layer>: { cmd: "...", desc: "..." } }
  forbidden: [ "deploy*", "drop table*", "git push --force*" ]
  review_gate: "<full build command>"

scan_exclusions: { ... }         # node_modules, build output, etc.
```

Run `node contexts/tools/validate.mjs` after every edit. Use `--update-catalog` when you change `skills.layer_map` or `subagents:`.

---

## Flows at a glance

### Feature story

```
Work on PROJ-1234
  → Orchestrator: ticket schema + LLD gen + branch (Phase C gate)
  → Explorer:     reuse discovery + task annotation (gate)
  → Surgeon:      per-task implementation with Tier 2 skills (gate)
  → Review:       full build + AC compliance + epic context update (gate)
  → Ship:         commit + PR + JIRA transition
```

### Bug fix

Same pipeline, just `issuetype: Bug` on the JIRA ticket changes:
- Orchestrator loads bug schema → Bug Context (not Requirement Summary)
- Explorer enters bug localization flow (F1-F4 frontend or B1-B6 backend strategies)
- Surgeon applies fix tasks, Review adds regression test validation

### Amending mid-flight

At Orchestrator's Phase C gate:
```
Amend: add AC4 — show toast on save success
```
Amender subagent makes section-level edits to the 3-file LLD without regenerating untouched sections.

**Cannot amend after:** Explorer has run (produces `$EXPLORATION_FILE`). Fix pre-Explorer, or restart the pipeline.

### Upcoming stories in the same epic (sequential)

For the **next** story in an epic you already worked, just run the normal trigger:
```
@orchestrator.md Work on PROJ-1235
```
Orchestrator automatically reads `contexts/<epic>/epic-context.md` (decisions + reuse catalog from prior stories) to inform the new story's LLD — no MCP round-trip needed for the architecture. Review appends a compact story entry to `epic-context.md` after every shipped ticket, so **each upcoming story starts warmer than the last**. The first story in an epic creates the file from HLD + spike findings.

### Bundle — multiple related stories in one PR

When several upcoming stories are related and share code, do them **together** instead of one-by-one:
```
@bundle-orchestrator.md Work on epic stories PROJ-1234, PROJ-2345, PROJ-3432
  → ONE consolidated LLD (cross-ticket AC registry, layer + dependency task order)
  → shared code built once (de-duplicated at design time)
  → ONE branch, ONE PR closing all tickets, per-ticket JIRA transitions
```
See [Bundle mode](#invocation-modes) for triggers, flags, and resume. Wall-clock ~30–40% faster than shipping them separately.

---

## Output layout

```
contexts/
├── config/pipeline.<pack>.yaml    ← configuration
├── project-map.md                 ← Project Analyzer output
├── archive/                       ← optional: shipped tickets moved here
├── <epic-lower>/                  ← pipeline artifacts per ticket (nested by default)
│   ├── codebase-map.md            ← Explorer maintains per-epic
│   ├── epic-context.md            ← decisions log, Review appends
│   ├── PROJ-1234.md               ← Requirement Summary + ACs + Companion index
│   ├── PROJ-1234-lld.md           ← PART 1 Design + PART 2 Tasks
│   ├── PROJ-1234-testplan.md      ← PART 3 Test Plan + PART 4 Test Tasks
│   ├── PROJ-1234-exploration.md   ← Explorer's task annotation summary
│   ├── PROJ-1234-manifest.md      ← Surgeon's per-task change rows
│   ├── PROJ-1234-review.md        ← Review's full report
│   │
│   │   # ── bundle run (multi-story) — same epic folder, keyed by BUNDLE_ID ──
│   ├── <BUNDLE_ID>.md             ← main bundle doc (mode: bundle) · BUNDLE_ID = <epic>-bundle-<hash4>
│   ├── <BUNDLE_ID>-lld.md         ← consolidated PART 1 + PART 2 (all tickets)
│   ├── <BUNDLE_ID>-testplan.md    ← consolidated PART 3 + PART 4
│   ├── <BUNDLE_ID>-exploration.md ← consolidated exploration (tagged by source ticket)
│   ├── <BUNDLE_ID>-manifest.md    ← Surgeon manifest (each row tagged Sources: <tickets>)
│   ├── <BUNDLE_ID>-review.md      ← review grouped by ticket + per-ticket sub-verdicts
│   ├── <BUNDLE_ID>-summary.md     ← post-ship: per-ticket AC coverage + PR/commit links
│   ├── <id>.md, <id>-lld.md       ← per-ticket cards (mode: bundle-card) — a view per bundled ticket
│   └── _bundle-state.yaml         ← resume oracle (stage cursors, atomic writes)
└── standalone/                    ← ad-hoc outputs (no ticket)
    ├── standalone-exploration-{ts}.md
    ├── standalone-manifest-{ts}.md
    ├── standalone-ac-manifest-{ts}.md
    ├── standalone-review-{ts}.md
    ├── standalone-ticket-review-{ts}.md
    ├── standalone-ac-review-{ts}.md
    └── standalone-demo-{ts}.md
```

---

## Context maintenance

Three files work together to maintain institutional knowledge:

| File | Scope | Who writes it | Who reads it |
|------|-------|--------------|--------------|
| `contexts/project-map.md` | Project-wide | Project Analyzer (at setup + on rescan) | Everyone |
| `contexts/<epic>/epic-context.md` | Per-epic | Orchestrator (creates), Review (appends per story) | Orchestrator (next story) |
| `contexts/<epic>/codebase-map.md` | Per-epic | Explorer (Mode A creates, Mode B syncs) | Explorer, Surgeon, Review |

**Plus per-ticket:** the 3-file LLD split (`<TICKET>.md` + `-lld.md` + `-testplan.md`), exploration file, manifest, review report.

Nothing is thrown away between stories; epic context grows as the epic evolves. Between epics, the project-map carries forward everything project-wide.

---

## Pipeline / Kernel constraints

- **Kernel is project-neutral.** The kernel agent prompts use placeholders (`{TICKET_ID}`, `{frontend_path}`, `{pack}-...`) — no YourApplication/React/specific-pack references. Pack-specific content lives in `packs/<pack>/` and `pipeline.<pack>.yaml`.
- **Only Ship commits.** Every other agent is read-only on git or only modifies the working tree. No silent commits.
- **Every agent has prerequisite checks.** If you run an agent out of order, it halts with a specific message telling you exactly which agent to run first.
- **Reference + images are enrichment, not requirements.** Missing reference → warn, proceed. Missing Figma MCP → list URLs, proceed.
- **Standalone mode has caps** (Surgeon: ≤5 files / ≤150 lines; Surgeon AC-driven: ≤5 ACs). Over cap → halts with "use pipeline instead".
- **MCP auto-discovery is graceful.** No MCPs = standard pipeline. Explicit trigger wins over MCP discovery. Pack mismatch on reference = warn + proceed.

---

## Common Scenarios

| Situation | Command |
|-----------|---------|
| New project, first setup | `node contexts/tools/install.mjs --pack <pack> --target <path>` → `@project-analyzer.md Analyze project` |
| Start work on a JIRA ticket | `@orchestrator.md Work on PROJ-1234` |
| Next story in an epic you already worked | `@orchestrator.md Work on PROJ-1235` (reads `epic-context.md` automatically) |
| Several related stories at once (1 PR) | `@bundle-orchestrator.md Work on epic stories PROJ-1234, PROJ-2345, PROJ-3432` |
| Bundle an epic's children by status | `@bundle-orchestrator.md Work on epic PROJ-EPIC-42 with status="Ready for Dev"` |
| Continue a bundle after a gate | `@bundle-explorer.md Run the bundle explorer` → `…surgeon` → `…review` → `@bundle-ship.md Ship the bundle` |
| Resume a stopped bundle | `Resume bundle-surgeon for <BUNDLE_ID> from T<N>` (or re-issue the original trigger) |
| Ticket is similar to a prior one | `@orchestrator.md Work on PROJ-1234 — reference: PROJ-100` |
| Attach design to the trigger | Paste image into the trigger message |
| LLD is wrong at Phase C gate | `Amend: <what to change>` |
| Just research a question | `@explorer.md Research: <q>` |
| Small one-off fix | `@surgeon.md Apply: <spec> in <files>` |
| Implement from ACs, no ticket | `@surgeon.md Implement:` + bullets |
| Review your current diff | `@review.md Review changes` |
| AC-coverage review | `@review.md Review <TICKET>` or `Review against:` + bullets |
| Ad-hoc browser demo | `@ac-e2e-check.md Demo <URL>` |
| Rescan after major refactor | `@project-analyzer.md Rescan <stack>` |
| Something broke | Read the agent's halt message — it tells you the exact next command |

---

## Deeper Reading

- [`HOW-TO-USE.md`](./HOW-TO-USE.md) — command cheat sheet, setup walkthrough, developer flow, troubleshooting
- [`agent-pipeline/agents/`](./agent-pipeline/agents/) — agent prompts (one file per agent, source of truth)
- [`agent-pipeline/rules/agent-flow.mdc`](./agent-pipeline/rules/agent-flow.mdc) — single-story routing, path resolution, companion file contracts, invocation mode detection, shared infrastructure (also used by bundle agents)
- [`agent-pipeline/rules/bulk-agent-flow.mdc`](./agent-pipeline/rules/bulk-agent-flow.mdc) — bundle / bulk multi-story triggers, dispatch, disambiguation, JIRA bulk labels, resume
- [`agent-pipeline/skills/SKILL.md`](./agent-pipeline/skills/SKILL.md) — kernel skill index
- `packs/<pack>/` — pack-specific skills + rules; open one to see what a pack looks like
- [`CHANGELOG.md`](./CHANGELOG.md) — release history
- [`VALIDATION-CHECKLIST.md`](./VALIDATION-CHECKLIST.md) — manual validation checklist for real projects

---

## Updating

When agent prompts change materially, refresh `HOW-TO-USE.md` and this README if user-facing commands change.
