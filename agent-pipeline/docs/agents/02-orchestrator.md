# 02 — Orchestrator

## Quick Reference

### Invocation modes

| Mode | Trigger | Outcome |
|------|---------|---------|
| **Pipeline** | `Work on <TICKET_ID>` | Full flow: fetch ticket → synthesize 3-file LLD → gate → branch |
| **Pipeline with reference** | `Work on <TICKET> — reference: <REF_TICKET>` | Above + reference pattern biasing |
| **Pipeline with images** | `Work on <TICKET>` + image attachments | Above + structured visual extraction |
| **Pipeline with MCP auto** | `Work on <TICKET>` (MCPs connected) | Auto-discovers reference + images from JIRA/Figma |
| **Standalone** | — not supported | (Orchestrator IS the pipeline entry point) |

### Example commands

```
Work on PROJ-1234
Work on PROJ-1234 — reference: PROJ-100
Work on PROJ-1234
[attach design.png error-state.png]
```

### What it reads

| From `pipeline.yaml` | Why |
|---------------------|-----|
| `skills.orchestrator.ticket_schema_story` / `ticket_schema_bug` | Parse JIRA ticket structure (14 story or 12 bug sections) |
| `skills.orchestrator.lld_generator` | LLD document template (4 parts, 40+ sections) |
| `skills.orchestrator.ac_templates_intent_aware` | Intent → required AC types (destructive-confirm, submit, etc.) |
| `skills.layer_map` | Build canonical layer table for branch/task decomposition |
| `runtime.contexts_layout` | Path resolution for 3-file split + epic folder layout |
| `runtime.branching` | base_branch, stacking mode, feature/fix branch prefixes |
| `jira.*` (auth, label, transitions, reference_link_types) | Ticket fetch via Atlassian MCP; linked-issue scanning for reference |
| `intent_classification.verb_synonyms` | Map button/action text to 7 intents |
| `mcp_servers.atlassian/figma/github` | MCP availability for auto-enrichment |
| `rescan_hints.freshness_check` | Whether to run per-ticket freshness check |

### What it reads from contexts/

- `contexts/project-map.md` — shared project knowledge (components, endpoints, intents)
- `contexts/<epic>/epic-context.md` — prior stories' decisions + reuse catalog (if first story in epic, creates this)
- `contexts/<epic>/codebase-map.md` — epic-level file catalog (if first story, leaves creation to Explorer)
- **Reference ticket's 3-file split** (if `reference_ticket` set or auto-discovered) — pattern extraction source

### What it writes

| Output | Content |
|--------|---------|
| `$CONTEXTS_FILE` (`<epic>/<TICKET>.md`) | Requirement Summary + Enriched AC Registry + Pattern Reference + Visual Specification + Companion Files index |
| `$LLD_FILE` (`<epic>/<TICKET>-lld.md`) | PART 1 (Design) + PART 2 (Tasks) |
| `$TESTPLAN_FILE` (`<epic>/<TICKET>-testplan.md`) | PART 3 (Test Plan) + PART 4 (Test Tasks) |
| `$EPIC_CONTEXT` (first story only) | Epic-context seed from HLD + spike findings |

### Phase overview

```
A0  load_context         — read config, skills, JIRA ticket
A0.6 resolve_enrichments — auto-discover reference ticket + images via MCP
A.0.5 freshness_check    — offer rescan if ticket scope's map is stale
A   understand_ticket    — schema-driven parse → Requirement Summary + Enriched ACs
B   synthesize_lld       — B.2 PART 1 Design, B.3 PART 2 Tasks, B.4 PART 3 Test Plan, B.5 PART 4
C   gate_for_approval    — render enrichment + LLD summary, accept/amend/cancel
                            Amender subagent fires on 'Amend: <text>'
                            On 'Go': create feature branch, label JIRA
```

### Enrichment support

- **Reference ticket** — from trigger (`— reference:`) OR JIRA linked issues (via Atlassian MCP) OR comments (surfaced as suggestion). Caps at 1.
- **Images** — from trigger attachments OR JIRA attachments OR Figma frames (via Figma MCP). Caps at 3 combined.
- **Pattern biasing** — soft guardrails in B.3: target ±1 task count, ±10% reuse ratio, matching layer split.

### Typical scenarios

| Situation | Command |
|-----------|---------|
| Normal story work | `Work on PROJ-1234` |
| Similar to a previous story | `Work on PROJ-1234 — reference: PROJ-100` (or let JIRA auto-discover via "is similar to" link) |
| Have a Figma design | Paste Figma URL in JIRA description — Orchestrator fetches + analyzes (if Figma MCP connected) |
| Paste a mockup directly | Attach image to the trigger message |
| User wants to change the LLD before Explorer | At Phase C gate: `Amend: <change>` |

---

## Purpose

Takes a JIRA ticket, converts it into a precise, implementation-ready Low-Level Design (LLD) document. Produces `contexts/{TICKET_ID}.md` — the contract every downstream agent reads.

## When it runs

- **Per ticket, Step 1 of 5** — first agent invoked when user says `Work on <TICKET>`
- **On amendment** — returns to `gate_for_approval (C)` after Amender finishes
- **NOT re-run across retries** — if a story fails at later stages, Explorer/Surgeon/Review/Ship are re-run; Orchestrator output stays as the contract

## Trigger commands

- `Work on <TICKET_ID>` (e.g. `Work on PROJ-1234`)
- Bare ticket ID with implementation intent (router rule detects)
- `run orchestrator`

## Phase overview

```
load_context (A0)
    ↓
freshness_check (A.0.5, v19)   [skip if map globally fresh or no scope signals]
    ↓
understand_ticket (A)           or   (bug mode path →)
    ↓
synthesize_lld (B)                   synthesize_bug_context (B-Bug)
    ↓                                      ↓
gate_for_approval (C)   ←→   subagent-amender (on Amend)
    ↓
branch created, hand off to Explorer
```

## Phase-by-phase

### load_context (A0)

Assembles everything needed before touching the ticket. Six steps:

1. **project-context.md** — hand-written prose from tech lead (team boundaries, active migrations, coding norms, reference implementations)
2. **pipeline.yaml** — machine config (skills paths, layer_map, branching, intent config, jira, subagents)
3. **JIRA ticket** — fetched via API; read `issuetype` FIRST before full parse
4. **Ticket Schema skill** — loaded AFTER knowing type (story schema vs bug schema — different section counts + parsing rules)
4b. **AC Template skill** (v16 eager-loading) — pack-specific intent→AC mapping, stored as `{ac_template_table}` for later phases
5. **Pre-flight file** (`$INPUT_FILE`) — optional inline context dump
6. **Inline context** — keywords in user trigger message

**Conflict handling:** if sources disagree, flag at `gate_for_approval (C)` instead of silently resolving.

### freshness_check (A.0.5, v19)

Verifies project-map is current for THIS ticket's scope. Only runs when needed, skips in common cases. Nine sub-steps:

- `check_enabled` — toggle per `rescan_hints.freshness_check.enabled`
- `global_freshness_gate` — skip if full rescan within last 7 days
- `extract_scope` — **conservative** extraction: only explicit file/class/endpoint/component references from JIRA. Does NOT fuzzy-match feature names.
- `rank_candidates` — HIGH/MEDIUM/LOW confidence per signal
- `check_staleness` — per candidate, check `rescan_log` days + git drift
- `render_gate` — only if at least one candidate STALE
- Default action at gate: `Rescan` (press Enter). User can Proceed/Flag/Expand/Skip.

**Why this matters:** without it, stale §4 entry causes LLD against old service API → Surgeon writes against methods that moved/changed → Review catches at build failure. 30-120s rescan prevents a full wasted story cycle.

### understand_ticket (A)

Parses JIRA ticket into structured Requirement Summary. Five steps:

- `mode_detection (A.1)` — routes Story/Task/Spike to Phase A+B; Bug to Phase B-Bug
- `full_ticket_parse (A.2)` — schema-driven parse (story: 14 sections; bug: 12 sections)
- `derive_implicit_acs (A.3)` — adds ACs implied by ticket context (e.g. "delete button" implies confirmation + audit + permission check)
- `parent_and_sibling_context (A.4)` — reads parent epic + sibling stories from codebase-map for cross-story continuity
- `build_requirement_summary (A.5)` — **THE CRITICAL STEP.** Produces the Requirement Summary + Enriched AC Registry that `synthesize_lld (B)` consumes

AC enrichment at A.5 uses the `{ac_template_table}` loaded in A0 step 4b. Each AC gets its intent classified; required supplementary ACs auto-added.

At end of Phase A: checkpoint gate. User sees Requirement Summary, can `Go` or `Amend: <what>` before LLD generation. Changing the summary here is cheap; changing the LLD post-B is expensive.

### synthesize_lld (B) — Story Mode

Renders Requirement Summary into 4-part LLD document.

- **B.2** — PART 1: metadata + Requirement Summary + Cross-Reference Findings
- **B.3** — PART 2: Task List (action type + contract confidence + intent markers)
- **B.4** — PART 4: Test Plan (AC-driven scenarios + intent-required coverage)
- **B.5** — metadata + write `contexts/{TICKET_ID}.md`

**Action-type decisions (Step 4a):** consult project-map § 3 for existing components. ♻️ USE if exists, HALT if duplication (2+ wrappers), 🆕 CREATE if none.

**Contract-confidence decisions (Step 4b, v15.0):**
- HIGH → full schema in task, Surgeon trusts it
- MEDIUM → "Explorer extracts wiring template from consumers"
- LOW → heuristic schema, Surgeon reads a consumer before wiring
- NONE + no consumers → HALT for user input

Every task carries v15 machine-readable markers (`contract_confidence:`, `button_intent:`, `intent_source:`, `§ 3b`/`§ 6`/`§ 10c` cross-refs) that Ship validates pre-commit.

### synthesize_bug_context (B-Bug) — Bug Mode

Different contract. Bugs don't have "tasks to implement" — they have symptoms + localization hints. 4 PARTs:

- Bug Context (steps to reproduce, expected, actual, error signals, frequency)
- Localization Hints (suspected files, layer, environment, gitblame) — input to Explorer's bug-localization skill
- Bug-specific ACs (fix resolves symptom, no regression, test covers reproducer)
- Test Plan (reproducer + regression suite)

### gate_for_approval (C)

Presents LLD, handles amendments, creates branch. Five steps:

- `derive_branch_name (C.1)` — from `runtime.branching.branch_template`
- `detect_base_branch (C.2)` — stacking off/linear/explicit per config
- `show_gate (C.3)` — render LLD summary + branch proposal + menu
- `create_branch (C.4)` — only on `Go` — `git checkout -b {branch} {base}`
- `handle_response (C.5)` — Go → hand off, Amend → invoke subagent-amender, Cancel → archive

## Inputs

| Source | What's read | Phase |
|---|---|---|
| `contexts/project-context.md` | team/migration/norms prose | load_context |
| `contexts/config/pipeline.yaml` | skills paths, layer_map, branching, intent config | load_context |
| JIRA ticket | raw requirements | load_context, understand_ticket |
| Ticket schema skill (pack) | story/bug parsing rules | load_context |
| AC template skill (pack, v15.1) | intent→AC mapping | load_context, understand_ticket |
| LLD generator skill | task/test-plan templates per layer | synthesize_lld |
| `project-map.md § 1` | tech stack | synthesize_lld |
| `project-map.md § 2` | folder structure | synthesize_lld |
| `project-map.md § 3 + 3b` | shared components + promotions | synthesize_lld (reuse lookup) |
| `project-map.md § 4` | shared services | synthesize_lld |
| `project-map.md § 6` | REST endpoints + contract confidence | synthesize_lld (Step 4b) |
| `project-map.md § 10c` | button intents | understand_ticket + synthesize_lld |
| `project-map.md rescan_log` | freshness metadata | freshness_check |
| `contexts/{EPIC}-codebase-map.md` | prior epic decisions | parent_and_sibling_context |
| `contexts/{EPIC}-context.md` | epic-level constraints | parent_and_sibling_context |

## Outputs

Single file: `contexts/{TICKET_ID}.md` (or nested per `runtime.contexts_layout`). Four PARTs:

1. Metadata + Requirement Summary + Cross-Reference Findings
2. LLD Task List (with v15 markers)
3. (reserved for Bug Context in bug mode)
4. Test Plan

Plus Amendment Log (grows as amendments accumulate).

Git side-effect: feature branch created on `Go`.

## Hand-off contract

After `gate_for_approval (C) → Go`:
1. Branch created
2. `contexts/{TICKET_ID}.md` written and valid
3. User told "Ready for Explorer" or Explorer auto-invoked per settings

Explorer's `load_config (0)` and `resolve_paths (0b)` locate the LLD via glob. LLD is authoritative — Explorer never goes back to JIRA.

## Dependencies

- **Project Analyzer must have run** — project-map.md required for `synthesize_lld (B)` reuse lookup
- **pipeline.yaml must declare** `skills.orchestrator.ticket_schema_story`, `skills.orchestrator.lld_generator`, `skills.orchestrator.ac_templates_intent_aware` (v15.1+)
- **JIRA API access** configured in pipeline.yaml (or `--ticket` manual override)
- **Git required** for branch creation at `create_branch (C.4)`

## Token economics

Typical medium-complexity story:

| Phase | Input tokens |
|---|---|
| load_context | ~4k (config + project-context + ticket + schemas) |
| freshness_check | ~1k (rescan_log, often skipped) |
| understand_ticket | ~4k (JIRA + parent epic + siblings + AC enrichment) |
| synthesize_lld | ~3k (project-map targeted reads + operation_patterns) |
| gate_for_approval | ~1k (rendering + interaction) |

Total input: ~10-15k. Output: ~4-6k (LLD). Without project-map lookups, `synthesize_lld` alone would need 30-50k for discovery.

## Common failure modes

- **JIRA ticket missing required sections** — schema skill flags gaps, surfaces at Phase A gate. User amends ticket in JIRA or fills at gate.
- **No matching components in project-map § 3** — Step 4a generates 🆕 CREATE tasks. If user expected REUSE, this signals map staleness → use `freshness_check` rescan or run `Rescan components` manually.
- **Contract confidence NONE for all endpoints** — indicates analyzer couldn't extract schemas. May need `Rescan contracts` or pack-specific extraction skill.
- **Amendment ping-pong** — user keeps amending without converging. Orchestrator doesn't prevent this; Amender's `amendment_log` tracks count, team norm is usually "3 amendments → regenerate from scratch."
- **Branch creation fails** — usually dirty git state. Orchestrator surfaces git error; user resolves, re-runs `create_branch (C.4)`.

## Configuration knobs

```yaml
skills:
  orchestrator:
    ticket_schema_story: "{pack}-ticket-schema-story.md"
    ticket_schema_bug: "{pack}-ticket-schema-bug.md"
    lld_generator: "{pack}-lld-generator.md"
    ac_templates_intent_aware: "{pack}-ac-templates-intent-aware.md"

runtime:
  branching:
    base_branch: "develop"
    stacking: "off"                    # or "linear", "explicit"
    branch_template: "feature/{TICKET}-{short-summary}"
    bug_branch_template: "fix/{TICKET}-{short-summary}"

rescan_hints:
  freshness_check:                     # v19
    enabled: true
    min_files_to_check: 3
    global_recent_rescan_days: 7
    stale_threshold_days: 30
    stale_threshold_file_count: 10
    top_n_candidates: 3
    default_action: "rescan"

subagents:
  amender: "subagent-amender.md"

jira:
  base_url: "..."
  project_key: "PROJ"
```

## Cross-agent awareness

- **Feeds Explorer** — LLD is primary input for Explorer
- **Consumed by Surgeon** — tasks + contract markers
- **Validated by Ship** — v15 marker integrity check pre-commit
- **Updated by Amender** — Phase C gate invokes Amender; result re-displayed at same gate
- **Reads Analyzer output** — project-map.md + pipeline.yaml throughout

## Version history

- Pre-v14 — 4-part LLD structure established
- v14.0 — freshness of project-map becomes relevant (drift surfaces externally)
- v15.0 — 4-tier contract confidence protocol (Step 4b) + intent-aware ACs (Phase A.5)
- v15.1 — AC template skill extraction + amender catch-up with v15 markers
- v16.0 — Phase A0 step 4b eager-loads AC template skill (consistency + fail-fast)
- v19.0 — `freshness_check (A.0.5)` phase added between A0 and A
- v20.0 — semantic phase names introduced
