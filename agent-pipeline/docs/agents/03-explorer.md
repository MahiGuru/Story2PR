# 03 — Explorer

## Quick Reference

### Invocation modes

| Mode | Trigger | Outcome |
|------|---------|---------|
| **Pipeline — story** | `Explore <TICKET>` (from Orchestrator gate or explicit) | Task Annotation Summary + codebase map sync |
| **Pipeline — bug** | Same trigger, `mode: bug` in `$CONTEXTS_FILE` | Localization → fix tasks, hypotheses, regression tests |
| **Pipeline — sub-bug** | Same trigger, `Parent Story Context` in `$CONTEXTS_FILE` | Parent cross-ref + localization |
| **Standalone — research** | `@explorer.md Research: <free-form question>` | Research notes at `contexts/standalone/standalone-exploration-{ts}.md` |
| **Standalone — explore** | `@explorer.md Explore: <task spec>` | Ad-hoc exploration similar to pipeline but single-task scope |

### Example commands

```
# Pipeline
Explore PROJ-1234

# Standalone — just research a codebase question
@explorer.md Research: where does the auth middleware enforce permissions?
@explorer.md Research: what shared dropdown components exist?

# Standalone — ad-hoc exploration (feeds standalone Surgeon later)
@explorer.md Explore: add MFA to the login flow
```

### What it reads

| From `pipeline.yaml` | Why |
|---------------------|-----|
| `explorer_paths` | Scanning scope (primary paths to grep in) |
| `skills.explorer.bug_router` / `bug_frontend` / `bug_backend` | Bug-mode localization sub-skills |
| `skills.layer_map` | Resolve file → layer → Tier 2 skill for surgery planning |
| `shared_paths.*` | Reuse discovery (E.0) — grep these paths for existing components |
| `operation_patterns` | Data-operation templates (fetch/create/update/delete) |
| `scan_exclusions` | Keep greps out of node_modules etc. |
| `runtime.contexts_layout` | Path resolution (Procedure B) |

### What it reads from contexts/

- `$CONTEXTS_FILE` — Requirement Summary + ACs + Pattern Reference + Visual Specification
- `$LLD_FILE` — PART 2 task list (for story mode) or PART 2 placeholder (for bug mode)
- `$TESTPLAN_FILE` — PART 4 test tasks
- `$CODEBASE_MAP` — epic-level file catalog (create if missing, sync if stale)
- `$EPIC_CONTEXT` — prior stories' decisions + reuse catalog
- `contexts/project-map.md` — shared project knowledge
- **Reference ticket's `-lld.md`** (if Pattern Reference present) — for task-shape comparison

### What it writes

| Output | Content |
|--------|---------|
| `$EXPLORATION_FILE` (pipeline) | Reuse Report + Scan Plan + per-task exploration + Task Annotation Summary |
| `$CODEBASE_MAP` | Create/sync — file entries, methods, line numbers, patterns |
| `contexts/standalone/standalone-exploration-{ts}.md` (standalone) | Research findings or ad-hoc task exploration |

### Phase overview

```
0    detect_invocation_mode — pipeline / standalone branch
0    load_config            — read pipeline.yaml + $EXCLUDES
0    check_prerequisites    — (pipeline only) $CONTEXTS/$LLD/$TESTPLAN exist
0b   resolve_paths          — Procedure B glob for $CONTEXT_DIR
0c   check_file_freshness   — silent stale-map invalidation per file
1    detect_mode            — story | bug | sub-bug (within pipeline mode)
2    check_codebase_map     — Mode A (Full build) | Mode B (Incremental)
E.0  reuse_discovery        — MANDATORY — challenge every CREATE
E.1  build_scan_plan        — prioritize files by PART 2 task refs
E.2  explore_each_task      — insertion points + wiring templates
E.2d wiring template        — complete wire-up for ♻️ REUSE tasks
E.3  framework_aware_refs   — REF entries for canonical patterns
```

### Enrichment support

- **Reference ticket** — reads `$CONTEXTS_FILE`'s Pattern Reference section (set by Orchestrator) and the reference ticket's `-lld.md`. Cross-references task decisions ("ref did REUSE here, current story is CREATE — deviation").
- **Visual extraction** — reads Structured visual extraction from `$CONTEXTS_FILE` (set by Orchestrator from images/Figma). Uses matched components as authoritative reuse decisions.
- **MCP** — does not call MCPs directly in most cases; uses GitHub MCP only if `runtime.multi_repo: true` for cross-repo search.

### Typical scenarios

| Situation | Command |
|-----------|---------|
| Part of a real ticket | `Explore PROJ-1234` (or triggered from Orchestrator gate) |
| Just want to understand a codebase pattern | `@explorer.md Research: <question>` |
| Bug ticket with structured Bug Context | `Explore PROJ-1234` — Explorer auto-routes to bug localization |
| Want to feed standalone Surgeon | `@explorer.md Explore: <task>` → then `@surgeon.md Apply: <same task> using exploration at <output path>` |

---

## Purpose

Takes the LLD from Orchestrator and produces file-level implementation guidance. For each task, locates the target files, identifies insertion points, extracts wiring templates from real consumers. The output (`{TICKET_ID}-exploration.md`) is Surgeon's primary input.

Also maintains epic-level knowledge in `{EPIC_ID}-codebase-map.md` — an incremental file catalog built first story, synced subsequent stories.

## When it runs

- **Per ticket, Step 2 of 5** — after Orchestrator hands off
- **Mode depends on whether an epic codebase-map exists:**
  - `full_build (Mode A)` — first story in epic, builds map from scratch
  - `incremental (Mode B)` — subsequent stories, reuses + syncs map
- **Bug flow** — loads `modes/explorer-bug.md` extension, uses pack's bug-localization skill

## Trigger commands

- Explicit: `run explorer`, `Explorer`
- Auto: after Orchestrator's `gate_for_approval (C) → Go` (if configured)
- Bug mode: triggered by `mode: bug` in LLD

## Phase overview

```
load_config (0)
    ↓
resolve_paths (0b)
    ↓
check_file_freshness (0c, v19)     [silent invalidation markers]
    ↓
detect_mode (1)       Story flow / Bug flow / Sub-Bug flow
    ↓
check_codebase_map (2)
    ↓ (exists?)
    ├── No  → full_build (Mode A)
    │         build_codebase_map + story_exploration
    └── Yes → incremental (Mode B)
              read_epic_knowledge + sync_map + check_for_gaps + story_exploration

In either mode, story exploration runs:
    reuse_discovery (E.0)
        ↓
    build_scan_plan (E.1)
        ↓
    explore_each_task (E.2)    [the critical loop]
        ↓
    framework_aware_refs (E.3)
```

## Phase-by-phase

### load_config (0)

Reads pipeline.yaml for paths, skills, bug-localization skill ref, runtime settings. Sets `$CONTEXTS_FILE`, `$CONTEXT_DIR`, `$EXPLORATION_FILE`, `$CODEBASE_MAP`.

### resolve_paths (0b)

Runs `agent-flow.mdc § Procedure B`:
```
matches = glob "contexts/**/{TICKET_ID}.md" excluding contexts/archive/**
→ exactly 1 match → set paths from match
→ 0 matches → HALT: "No context file for {TICKET}. Has Orchestrator run?"
→ 2+ matches → HALT: "Ambiguous, resolve manually"
```

### check_file_freshness (0c, v19)

Per-file silent staleness check. For each file named in LLD's PART 2 tasks:
- Look up in project-map (§ 3/4/6/10c per type)
- If entry exists AND git diff shows mods since `last_scanned`:
- Mark entry `STALE_FOR_STORY` in `exploration.md`
- Surgeon re-reads file before trusting insertion points

Unlike Orchestrator's `freshness_check (A.0.5)`, no user gate — just invalidation flags. Complements the Phase A.0.5 broader scope check.

### detect_mode (1)

Reads `$CONTEXTS_FILE` metadata:
- `mode: story` + tasks populated → **Story flow**
- `mode: bug` + PART 2 placeholder → **Bug flow** → load `modes/explorer-bug.md`
- `mode: bug` + parent story context → **Sub-Bug flow** → load `modes/explorer-bug.md` with inheritance

### check_codebase_map (2) — Story flow only

```bash
ls $CODEBASE_MAP 2>/dev/null
```
- Not found → `full_build (Mode A)` — first story in this epic
- Found → `incremental (Mode B)` — reuse + sync

## Mode: full_build (Mode A) — first story in epic

Two sub-phases:

### build_codebase_map (Mode A Phase 1)

Walks the codebase once, building a file-level catalog into `{EPIC_ID}-codebase-map.md`:
- Every feature file with purpose + key functions/methods
- Dependencies (imports/uses)
- Consumer relationships (called by X)
- Framework layer

Leverages project-map for shared code; catalogs feature code itself.

### story_exploration (Mode A Phase 2)

Proceeds to Story Exploration steps (E.0-E.3, see below).

## Mode: incremental (Mode B) — subsequent stories

Four sub-phases:

### read_epic_knowledge (Mode B Phase 1)

Loads `{EPIC_ID}-codebase-map.md` + `{EPIC_ID}-context.md` into working memory. Prior epic decisions inform current story without rediscovery.

### sync_map (Mode B Phase 1.5) — MANDATORY every run

```
1. Read codebase-map.md metadata → last_synced_at date
2. git log --after={last_synced_at} --name-only → files changed since sync
3. For each changed file:
   - Already in map → mark STALE → re-read + update entry
   - Not in map → NEW → append entry
4. Update last_synced_at
```

This keeps the epic map fresh as stories accumulate. Without it, Story 5 would use Story 1's snapshot of feature code that Surgeon has since modified 4 times.

### check_for_gaps (Mode B Phase 2)

Reviews sync output: any files mentioned in current LLD's tasks that AREN'T in the map after sync? Flag them for story_exploration phase — they need dedicated exploration.

### story_exploration (Mode B Phase 3)

Same as Mode A Phase 2 — proceeds to E.0-E.3.

## Story Exploration Steps (both modes)

### reuse_discovery (E.0) — MANDATORY

Runs BEFORE task classification. Priority order:
1. **project-map exact match** — lookup, 0 file reads
2. **project-map near-match** + pipeline.yaml.shared_paths — lookup, 0 file reads
3. **epic codebase-map** — prior story decisions
4. **Grep shared_paths from config** — actual file reads, only if 1-3 fail
5. **CREATE new** — last resort

If LLD task is ♻️ USE, E.0 verifies the referenced component actually exists. Mismatch → HALT and surface to user.

### build_scan_plan (E.1)

For each task, constructs a targeted scan:
- Files to READ (already-known targets)
- Files to LOCATE (need grep first)
- Shared components to verify
- Consumers to sample (for wiring templates)

Plan scoped to exactly what the task needs. No broad directory scans.

### explore_each_task (E.2) — THE CRITICAL LOOP

For each task in LLD PART 2:

- **E.2a — Read target files** (already identified via map or E.1 plan)
- **E.2b — Extract insertion points** — line-level precision. "Insert the new directive between line 42 (filter row) and line 58 (action buttons)"
- **E.2c — Sample consumers** — for ♻️ USE tasks, pick 2-3 existing consumers of the shared component, extract their wiring code as template
- **E.2d — Extract wiring template** — the critical output for MEDIUM/LOW/NONE contract confidence tasks. Derives the idiomatic pattern from real code, not from schema heuristics
- **E.2e — Surface gotchas** — inconsistencies, existing bugs near insertion point, non-obvious dependencies
- **E.2f — Post-verify intent/contract** — re-check LLD markers against reality. Any drift → append note to exploration.md

Produces per-task exploration entry with files, lines, templates, gotchas.

### framework_aware_refs (E.3)

Uses framework-specific reference-discovery skills:
- AngularJS: trace `$inject` arrays, directive bindings, `templateUrl`
- Angular 18: trace `@Input`/`@Output`, providers, router configs
- Java Spring: trace `@Autowired`, `@Path` annotations
- Flask: trace blueprint registrations, `@app.route` decorators

Framework-specific skills live in `skills.explorer.framework_refs.*` per pack.

## Bug Flow (branch off detect_mode)

When `mode: bug`:
1. Load `modes/explorer-bug.md`
2. Load pack's bug-localization skill (e.g. `{pack}-bug-localization.md`)
3. Use Orchestrator's Localization Hints (PART 2 of bug LLD) as starting point
4. Trace from error signals → code paths → suspected root cause
5. Produce exploration.md with "suspect locations" instead of tasks

Bug flow output feeds Surgeon's bug-mode implementation differently — instead of implementing declared tasks, Surgeon narrows to root cause + writes fix.

## Inputs

| Source | What's read | Phase |
|---|---|---|
| `contexts/{TICKET}.md` | LLD from Orchestrator | resolve_paths + detect_mode |
| `contexts/config/pipeline.yaml` | paths, skills, bug-localization ref | load_config |
| `contexts/project-map.md` | shared components, services, endpoints, consumer graph | reuse_discovery + explore_each_task |
| `contexts/{EPIC}-codebase-map.md` | epic-level file catalog (Mode B only) | read_epic_knowledge |
| `contexts/{EPIC}-context.md` | epic-level prose context (Mode B only) | read_epic_knowledge |
| Source code | target files, consumers, patterns | explore_each_task |
| Pack bug-localization skill | bug flow discovery rules | detect_mode (bug branch) |
| Pack framework-refs skills | framework-specific tracing | framework_aware_refs |
| Git log | file change dates for sync | check_file_freshness + sync_map |

## Outputs

Primary: `contexts/{TICKET_ID}-exploration.md` — per-task implementation map with:
- Files to touch
- Line-level insertion points
- Wiring templates from real consumers
- Gotchas / risks
- STALE_FOR_STORY markers (v19)

Secondary: `contexts/{EPIC_ID}-codebase-map.md` — built (Mode A) or synced (Mode B).

## Hand-off contract

After exploration complete:
1. `exploration.md` written and valid
2. `codebase-map.md` updated with any new/modified file entries
3. Hand off to Surgeon — "Ready for Surgeon"

Surgeon's Step 0c (pre_implementation_check) reads exploration.md as primary input. Surgeon trusts E.2b insertion points for non-STALE files; re-reads STALE files fully.

## Dependencies

- **Orchestrator must have run** — LLD required
- **Project Analyzer must have run** — project-map.md required for reuse_discovery
- **pipeline.yaml must declare** explorer skills (bug-localization, framework-refs, paths)
- **Git required** for sync_map and check_file_freshness

## Token economics

Typical medium-complexity story:

| Phase | Mode A (first story) | Mode B (subsequent) |
|---|---|---|
| load_config + resolve_paths + check_file_freshness | ~1k | ~1k |
| detect_mode + check_codebase_map | ~1k | ~1k |
| build_codebase_map (Mode A only) | ~15-30k | — |
| read_epic_knowledge + sync_map (Mode B only) | — | ~5-10k |
| reuse_discovery | ~2k | ~2k |
| build_scan_plan | ~1k | ~1k |
| explore_each_task | ~5-10k | ~5-10k |
| framework_aware_refs | ~2k | ~2k |

Mode A total: ~25-45k. Mode B total: ~15-25k. Incremental mode amortizes the first story's cost across the epic.

## Common failure modes

- **Missing LLD** — HALT at resolve_paths. User re-runs Orchestrator.
- **Ambiguous ticket file location** — 2+ matches in glob. User resolves manually (usually archives old file).
- **Reuse mismatch** — LLD says ♻️ USE `spReviewerSelector` but component not at claimed path. Surface: map is stale, map is wrong, or component was renamed/deleted. User: rescan or amend LLD.
- **Consumer samples yield conflicting patterns** — E.2d finds 3 different wiring styles. Explorer picks the most recent/most-used; notes others in gotchas.
- **Bug localization produces no suspects** — bug skill's inference fails. Explorer asks user to fill Localization Hints more specifically.
- **Codebase-map sync finds huge drift** — 50+ files changed. Explorer warns at `sync_map`; may need `Rescan project` before continuing.

## Configuration knobs

```yaml
skills:
  explorer:
    paths: "{pack}-explorer-paths.md"
    bug_router: "{pack}-bug-localization.md"
    framework_refs:
      angularjs: "{pack}-angularjs-refs.md"
      angular18: "{pack}-angular18-refs.md"
      java_spring: "{pack}-java-spring-refs.md"

runtime:
  contexts_layout:
    nested_by_epic: true                  # contexts/EPIC/TICKET.md vs contexts/TICKET.md
    codebase_map_filename: "codebase-map.md"
    exploration_filename_template: "{TICKET_ID}-exploration.md"
```

## Cross-agent awareness

- **Reads Orchestrator's LLD** — primary input
- **Feeds Surgeon** — exploration.md is Surgeon's primary input
- **Respects Analyzer's project-map** — reuse_discovery priority 1-2 are map lookups
- **Sets STALE_FOR_STORY markers** (v19) — consumed by Surgeon's new rule
- **Uses Analyzer's rescan_log** — check_file_freshness diffs against it

## Version history

- Pre-v14 — 2-mode architecture (full vs incremental) established
- v14.0 — codebase-map.md sync mechanics formalized (Phase 1.5)
- v15.0 — E.2d wiring template extraction standardized for MEDIUM/LOW contract tasks
- v19.0 — `check_file_freshness (0c)` silent invalidation added
- v21.0 — semantic phase names
