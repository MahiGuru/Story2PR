# 06 — Review

## Quick Reference

### Invocation modes

| Mode | Sub-mode | Trigger | Outcome |
|------|---------|---------|---------|
| **Pipeline** | — | `Run the review` (from Surgeon gate) | Full review: build + tests + code review + blast radius + test plan + AC compliance + enrichment fidelity |
| **Standalone** | `diff` | `@review.md Review changes` | Compact code quality on current git diff |
| **Standalone** | `ticket` | `@review.md Review <TICKET>` | Loads ACs from `$CONTEXTS_FILE`; AC coverage + code quality |
| **Standalone** | `ac-driven` | `@review.md Review against:` + bullets | Ad-hoc ACs; same engine as ticket mode |

### Example commands

```
# Pipeline (full)
Run the review

# Standalone — diff only
@review.md Review changes

# Standalone — ticket
@review.md Review PROJ-1234
@review.md Review PROJ-1234 against pattern PROJ-100      # + reference
@review.md Review PROJ-1234 against design:               # + image
[attach design.png]

# Standalone — inline ACs
@review.md Review against:
  - AC1: User can click Reset on filter panel
  - AC2: Reset clears filter state

@review.md Review against:
  - AC1: ...
  — reference: PROJ-100
[attach design.png]
```

### What it reads

| From `pipeline.yaml` | Why |
|---------------------|-----|
| `skills.layer_map` | Per changed file → Tier 2 standards skill |
| `skills.extra_triggers` | Orthogonal add-on skills (a11y, ExtJS, tests) |
| `skills.orchestrator.ac_templates_intent_aware` | AC intent classification for coverage |
| `builds.review_gate` | Clean build command (pipeline only) |
| `builds.tests.*` | Test suite commands (pipeline only) |
| `shared_paths.*` | For blast radius consumer search (pipeline only) |
| `scan_exclusions` | Grep safety everywhere |

### What it reads from contexts/

**Pipeline:**
- `$CONTEXTS_FILE` — ACs + Requirement Summary + Pattern Reference + Visual Spec
- `$LLD_FILE` — PART 1 (compliance baseline) + PART 2 (per-task review)
- `$TESTPLAN_FILE` — PART 3 (test plan validate) + PART 4 (spec coverage)
- `$EXPLORATION_FILE` — Task Annotation Summary
- `$MANIFEST_FILE` — Surgeon's per-task rows
- Optional `$DEMO_REPORT` — AC-E2E-Check output (cross-ref)
- Optional reference ticket's artifacts

**Standalone:**
- `diff` — `git diff` output, no context file
- `ticket` — only `$CONTEXTS_FILE` for ACs
- `ac-driven` — inline ACs from trigger

### What it writes

| Output | Mode |
|--------|------|
| `$REVIEW_FILE` | Pipeline — full review + Pattern Reference + Visual Fidelity + epic-context append |
| `contexts/<epic>/epic-context.md` (append) | Pipeline — story entry with CREATED/MODIFIED/CONFIG files |
| `contexts/<epic>/project-map.md` updates | Pipeline — if shared components added/changed |
| `contexts/standalone/standalone-review-{ts}.md` | Standalone `diff` |
| `contexts/standalone/standalone-ticket-review-{ts}.md` | Standalone `ticket` |
| `contexts/standalone/standalone-ac-review-{ts}.md` | Standalone `ac-driven` |

### Phase overview (pipeline)

```
0    detect_invocation_mode    — pipeline / standalone sub-modes
0    check_prerequisites       — $CONTEXTS/$LLD/$TESTPLAN/$EXPLORATION/$MANIFEST + branch + uncommitted diff
1    full_verification         — 1a full_clean_build + 1b unit_test_suite (JS/TS/Java)
2    code_review               — per task from manifest, against LLD, with Tier 2 + extra_triggers
3    blast_radius              — shared-component consumer search
3.5  enrichment_fidelity       — (if ref/images set) 3.5a pattern, 3.5b visual
4    test_plan_validation      — 4a validate + 4b spec coverage
5    epic_context_update       — append story to epic-context.md
5b   project_map_update        — reflect shared changes
6    token_measurement
```

### Phase overview (standalone)

```
diff sub-mode:
  load_config (subset) → standalone_code_review → write $STANDALONE_REVIEW_FILE

ticket sub-mode:
  check_ticket_inputs → Shared AC-Aware Review Engine → write $STANDALONE_TICKET_REVIEW_FILE

ac-driven sub-mode:
  parse_acs → Shared AC-Aware Review Engine → write $STANDALONE_AC_REVIEW_FILE

Shared engine adds (when enrichment present):
  compare_against_reference          — Pattern Reference section
  compare_against_design_image       — Visual Fidelity section
```

### Enrichment support

- **Reference ticket** — `against pattern <TICKET>` or `— reference: <TICKET>` — compares diff's approach against ref's pattern (task count, reuse ratio, layer split)
- **Images** — attached to trigger OR `against design:` marker — element-by-element visual fidelity check
- **Pipeline auto** — pipeline Review reads enrichment already set by Orchestrator, no additional triggers needed

### Typical scenarios

| Situation | Command |
|-----------|---------|
| End of pipeline (after Surgeon) | `Run the review` |
| Just want code-quality check on my diff | `@review.md Review changes` |
| Check AC coverage without running tests | `@review.md Review <TICKET>` |
| Check against both pattern + design | `@review.md Review <TICKET> against pattern <REF>` + attach design image |
| No ticket yet, but have ACs | `@review.md Review against:` + bullets |

---

## Purpose

Verifies the story is ready to ship. Runs full build + unit tests, does code review per task, analyzes blast radius, validates test plan, updates epic context, updates project-map, previews epic E2E plan. Outputs a `Ship-ready: YES/NO` signal that Ship's pre-flight respects.

Also handles two CRITICAL update responsibilities:
- `project_map_update (PART 5b)` — keeps project-map.md fresh across stories (v14+, with v15/v16 invalidation layer)
- `epic_e2e_plan_preview (PART 5c)` — previews what Ship will add to the epic E2E plan

## When it runs

- **Per ticket, Step 4 of 5** — after Surgeon hands off (or after AC-E2E-Check if used)
- **Reads the full Change Manifest** + exploration + LLD
- **Updates shared state** — project-map, epic context, epic E2E plan

## Trigger commands

- `review`, `run review`, `Review`
- Auto: after Surgeon's `final_build_check` passes (if configured)

## Part overview

Review uses PART (not Phase) naming for its top-level sections — a historical convention preserved through v21:

```
Pre-flight: load_config + resolve paths + verify Surgeon complete
    ↓
full_verification (PART 1)          [build + unit tests]
    ↓
code_review (PART 2)                [per task, file-by-file]
    ↓
blast_radius (PART 3)
    ↓
test_plan_validation (PART 4)       [test plan check + spec coverage]
    ↓
epic_context_update (PART 5)        [feeds next story's Orchestrator]
    ↓
epic_e2e_plan_preview (PART 5c)     [preview for Ship's actual commit]
    ↓
project_map_update (PART 5b)         [keep project-map.md current]
    ↓
token_measurement (PART 6)
```

## PART-by-PART

### full_verification (PART 1)

Runs the complete build + test suite fresh. Two steps:

- `full_clean_build (1a)` — clean + compile. Fails fast on build breaks.
- `unit_test_suite (1b)` — MANDATORY, not optional. Runs pack's test command (e.g. `ant test`). If tests fail → HALT with `Ship-ready: NO`.

Rationale: Surgeon's `final_build_check` already passed, but it's the responsibility of Review to run unit tests against the full state. Surgeon runs tests per-task; Review runs the full suite.

### code_review (PART 2)

Per-task, file-by-file. For each file in Change Manifest:
- Read diff (or full file for new files)
- Check against coding standards
- Verify task's AC is satisfied
- Check for introduced complexity / anti-patterns
- Surface any issues

This is the LLM-based code review pass — not a substitute for human review, but a first pass that catches obvious issues (commented-out code, missing error handling, etc.).

### blast_radius (PART 3)

Analyzes impact beyond declared tasks:
- Files modified outside the LLD task list? (unintended changes)
- Dependencies on the modified files (downstream consumers) — any that break?
- Shared code changes — what else uses this?
- Refactoring creep — did Surgeon change unrelated code?

### test_plan_validation (PART 4)

Two steps:

- `validate_test_plan (4a)` — does the test plan match the implementation? Missing tests for new methods? Tests for methods that weren't actually changed?
- `spec_coverage_check (4b, Gap 8)` — for AC verification via spec files: does each AC have at least one spec? Are spec files in the right location per pack config?

### epic_context_update (PART 5)

MANDATORY. Updates `contexts/{EPIC_ID}-context.md` with:
- Decisions made this story (e.g. "chose sp-reviewer-selector over creating new")
- Patterns established (e.g. "Java services in this epic use AuditService, not logging directly")
- Constraints discovered (e.g. "user permissions checked at controller level, not service")

Next story's Orchestrator's `parent_and_sibling_context (A.4)` reads this. Feeds continuity across stories.

### project_map_update (PART 5b) — v14+, v16 enhanced

MANDATORY. Keeps `contexts/project-map.md` current after each story.

**Base logic:**
Read Change Manifest → for each file, check if it's in `shared_paths` from pipeline.yaml:
- In shared FE ui_elements → update § 3 Shared UI Components
- In shared FE services → update § 4 Shared Frontend Services
- In shared BE services → update § 4 Shared Backend Services
- In shared BE rest_endpoints → update § 6 REST Endpoints
- In shared templates → update § 6 + § 6-enh

**v16 invalidation layer:**
When a shared file is MODIFIED (not just created), infer what project-map metadata might be stale:

- **REST resource modified** — signature/schema/return-type changes downgrade `contract_confidence: HIGH → MEDIUM`. LOW/MEDIUM get "may be stale" notes. NONE is no-op. Add to § Pending Rescan: "Run `Rescan contracts`".
- **UI component modified** — label text changes flag matching § 10c rows as `potentially-stale`. Template/props-only changes just update § 3 API.
- **Shared service modified** — method signature changes flag consumer graph (§ 10) as "may need `Rescan consumers`".
- **Shared template modified** — layout inheritance flagged in § 6-enh.

**Pending Rescan counter:** when 5+ hints accumulate, Review emits warning: "consider running suggested rescans before drift compounds."

**Promotion check:** for new feature-local files, count consumers. 3+ features → flag as PROMOTION CANDIDATE in § 3b.

### epic_e2e_plan_preview (PART 5c)

MANDATORY. Previews what Ship's `update_epic_e2e_plan (Step 6b)` will commit to `{EPIC_ID}-epic-e2e-plan.md`.

Four sub-steps:

- `resolve_and_read_plan (5c-a)` — locate plan + read manual rows (don't clobber hand-written entries)
- `classify_acs_to_scenarios (5c-b)` — classify this story's ACs into scenario types (happy-path, edge-case, data-flow, permission, regression)
- `detect_cross_story_flows (5c-c)` — if plan exists, detect flows involving this story + prior stories (Story 3 reads data that Story 1 created)
- `preview_output (5c-d)` — show user what Ship will write; user can adjust classifications before Ship runs

Review only PREVIEWS. Ship's Step 6b does the actual commit. Rationale: issues caught now are free to fix; post-Ship edits cost a new commit.

### token_measurement (PART 6)

Tallies pipeline token usage for this story. Per agent + total. Feeds team analytics about story-level cost.

## Inputs

| Source | What's read | PART |
|---|---|---|
| `contexts/{TICKET}.md` | LLD for comparison | full_verification + code_review + test_plan_validation |
| `contexts/{TICKET}-exploration.md` | for context during review | code_review |
| `contexts/{TICKET}-manifest.md` | Change Manifest — every file touched | All PARTs |
| `contexts/project-map.md` | current state (to update) | project_map_update |
| `contexts/config/pipeline.yaml` | shared_paths for classification | project_map_update |
| `contexts/{EPIC}-context.md` | prior epic decisions | epic_context_update |
| `contexts/{EPIC}-epic-e2e-plan.md` | for preview | epic_e2e_plan_preview |
| Source code | diffs for review | code_review |
| Test output | pass/fail details | full_verification |

## Outputs

Primary: `contexts/{TICKET}-review.md`:
- Build + test results
- Code review notes per task
- Blast radius findings
- Test plan validation
- Ship-ready: YES/NO signal
- Issues tracker

Side effects on shared state:
- `{EPIC}-context.md` — epic decisions appended
- `project-map.md` — shared file entries updated + pending-rescan hints
- `{EPIC}-epic-e2e-plan.md` — NO writes (Ship does these)

## Hand-off contract

After Review complete:
1. `{TICKET}-review.md` written with Ship-ready signal
2. Shared state updated (epic-context, project-map)
3. Hand off to Ship

Ship's pre-flight reads `Ship-ready: YES` before proceeding. NO halts Ship and surfaces reasons.

## Dependencies

- **Surgeon must have completed** — Change Manifest required
- **Build tool available** for full_verification
- **project-map.md + pipeline.yaml** for PART 5b classification
- **Epic context files** (created by first story in epic) — Review extends them

## Token economics

Typical medium-complexity story:

| PART | Input tokens |
|---|---|
| pre-flight | ~1k |
| full_verification | ~2-5k (build log truncation) |
| code_review | ~10-15k (file diffs) |
| blast_radius | ~3-5k (consumer checks) |
| test_plan_validation | ~2k |
| epic_context_update | ~1-2k |
| project_map_update | ~2-3k (path classification + metadata) |
| epic_e2e_plan_preview | ~2-3k |
| token_measurement | ~500 |

Total: ~25-35k. Review is moderate cost — reads a lot but doesn't modify much.

## Common failure modes

- **Build fails in full_verification** — `Ship-ready: NO`. User runs Surgeon with fix directive.
- **Tests fail in unit_test_suite** — same handling.
- **Blast radius finds unintended scope** — Surgeon touched files outside LLD. Surface + user decides (amend LLD or revert extra changes).
- **project_map_update finds stale metadata** — v16 invalidation surfaces "§ 6 REST entry may be stale" as Pending Rescan. Not blocking, but warning.
- **epic_e2e_plan_preview can't classify ACs** — classification tree doesn't fit. Manual override in Step 5c-b.
- **Review's PART 5b corrupts project-map** — Ship's v16 marker integrity check catches it at commit time, halts.

## Configuration knobs

```yaml
runtime:
  review:
    enabled: true
    require_full_build: true           # fail if build not run
    require_unit_tests: true           # fail if tests not run
    max_review_tokens: 50000           # soft limit warning

shared_paths:                           # written by analyzer, read by Review
  frontend:
    ui_elements: [...]
    services: [...]
  backend:
    services: [...]
    rest_endpoints: [...]
    templates: [...]

builds:
  commands:
    main: "ant main"
    test: "ant test"
```

## Cross-agent awareness

- **Reads Surgeon's Change Manifest** — primary input
- **Reads Orchestrator's LLD** — for verification
- **Updates project-map for future Orchestrator/Explorer runs** — project_map_update (PART 5b)
- **Updates epic-context for future stories** — epic_context_update (PART 5)
- **Previews what Ship will write** — epic_e2e_plan_preview (PART 5c)
- **v16 invalidation** — downgrades contract_confidence when signatures change, flags intent stale when labels change

## Version history

- Pre-v14 — core PART structure established
- v14+ — project_map_update (PART 5b) introduced for incremental map maintenance
- v15.0 — spec_coverage_check (Step 4b) added to test_plan_validation
- v15.1 — epic_e2e_plan_preview (PART 5c) for pre-Ship visibility
- v16.0 — invalidation layer in project_map_update (contract_confidence downgrades, intent stale flags, pending rescan hints)
- v21.0 — semantic naming (PART preserved as Review's historical convention; Step/Phase within PARTs renamed)
