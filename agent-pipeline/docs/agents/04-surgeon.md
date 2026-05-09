# 04 — Surgeon

## Quick Reference

### Invocation modes

| Mode | Sub-mode | Trigger | Notes |
|------|---------|---------|-------|
| **Pipeline** | — | `Run the surgeon` (from Explorer gate) | Full task loop: LLD PART 2 → code + manifest |
| **Standalone** | `apply` | `@surgeon.md Apply: <spec>` or `Apply: <spec> in <files>` | Direct small change (≤5 files, ≤150 lines) |
| **Standalone** | `ac-driven` | `@surgeon.md Implement:` + bullet list of ACs | Mini-pipeline: parse ACs, classify, locate files, **plan gate**, execute |

### Example commands

```
# Pipeline (full flow)
Work on PROJ-1234                                 # → Orchestrator → Explorer → Surgeon
Run the surgeon                                   # at Explorer gate

# Standalone — direct change
@surgeon.md Apply: add null check to handleSubmit in featureCtrl.js
@surgeon.md Apply: fix typo "recieve" → "receive"    # one file, Surgeon infers
@surgeon.md Apply: <spec> using exploration at contexts/standalone/standalone-exploration-...

# Standalone — AC-driven (caps: ≤5 ACs, ≤5 files, ≤150 lines)
@surgeon.md Implement:
  - AC1: User can click Reset on filter panel
  - AC2: Clicking Reset clears state + re-fetches list
  - AC3: Reset disabled when no filters applied

# Standalone with enrichment
@surgeon.md Implement:
  - AC1: ...
  - AC2: ...
  — reference: PROJ-100
[attach design.png]
```

### What it reads

| From `pipeline.yaml` | Why |
|---------------------|-----|
| `skills.layer_map` | File path + task.Layer → Tier 2 standards skill + build command |
| `skills.extra_triggers` | Orthogonal skills (a11y, ExtJS, test conventions) |
| `skills.orchestrator.ac_templates_intent_aware` | AC-driven mode: classify AC intent |
| `builds.commands[layer]` | Per-file build after each task |
| `builds.forbidden` | Never run these (deploy, drop table, force push) |
| `builds.review_gate` | Final full build after all tasks |
| `builds.lint`, `builds.tests` | Optional per-task checks |
| `shared_paths.*` | Step 0a reuse verification |
| `operation_patterns` | AC-driven mode: match data-op ACs |
| `component_structure` | Which companion files must exist per new component |
| `i18n.*` | Step 0a — check for dynamic data misrouted to messages.properties |
| `subagents.surgeon_pre_task` / `surgeon_post_task` | Optional pack extension hooks |
| `scan_exclusions` | Reuse-check grep safety |

### What it reads from contexts/

**Pipeline mode:**
- `$CONTEXTS_FILE` — Requirement Summary, Pattern Reference, Visual Spec
- `$LLD_FILE` — PART 2 tasks (primary work list)
- `$TESTPLAN_FILE` — PART 4 test tasks
- `$EXPLORATION_FILE` — Task Annotation Summary (WHERE to put code)
- `$MANIFEST_FILE` — for resume-from-checkpoint

**Standalone mode:**
- Trigger text + attached images/reference (self-contained)
- Optionally: a `standalone-exploration-*.md` file if cited

### What it writes

| Output | Mode |
|--------|------|
| Source-code edits (uncommitted) | All modes |
| `$MANIFEST_FILE` (pipeline) | Per-task rows with files/lines/verdict/reference/visual annotations |
| `contexts/standalone/standalone-manifest-{ts}.md` | Standalone `apply` mode |
| `contexts/standalone/standalone-ac-manifest-{ts}.md` | Standalone `ac-driven` mode (includes AC→task map, Pattern Reference, Visual analysis) |

### Phase overview (pipeline)

```
0    detect_invocation_mode         — pipeline / standalone / ac-driven
0    check_prerequisites            — $CONTEXTS/$LLD/$TESTPLAN/$EXPLORATION + branch + drift check
                                       (drift check: compare manifest's lld_version to current)
0a   reuse_verification             — MANDATORY — verify CREATE vs. REUSE per task
0b   load_coding_standards          — Tier 2 per task.Layer + extra_triggers
0c   pre_implementation_check       — deps met, target file state, insertion point
1    complexity_circuit_breaker     — halt if task complexity > threshold
2    implement                      — write code following Tier 2 skills
3    post_verification              — per-layer build + pack postverify rules
3a   ui_edge_case_checklist         — 5 questions for UI tasks
3b   per_task_build                 — builds.commands[layer]
4    track_changes                  — append to manifest with enrichment annotations
5    task_report                    — per-task verdict row
...  loop over next task
6    final_build_check              — builds.review_gate clean build
```

### Phase overview (standalone ac-driven)

```
0    detect_invocation_mode → sub_mode=ac-driven
     parse_acs                  — parse bullet list
     resolve_reference          — if — reference: <TICKET>
     analyze_image              — if images attached
     classify_and_locate        — inline mini-Explorer
     build_inline_plan          — aggregate into tasks
     plan_gate                  — MANDATORY user approval
     execute_ac_driven          — per-task with reuse check, skills, build
     write_ac_manifest
```

### Enrichment support

- **Reference ticket** (`— reference: <TICKET>`) — reads ref's artifacts via Procedure B; extracts pattern; biases classify_and_locate
- **Images** (attached to trigger) — LLM analyzes UI elements; matches to shared_paths; visual-to-AC cross-ref
- **MCP** — if Atlassian MCP available, can resolve reference ticket's linked PR status via GitHub MCP

### Typical scenarios

| Situation | Command |
|-----------|---------|
| Real story from ticket | Pipeline flow (`Work on PROJ-1234` → eventually `Run the surgeon`) |
| Known one-line fix | `@surgeon.md Apply: <exact change> in <file>` |
| Paste ACs, let Surgeon figure out files | `@surgeon.md Implement:` + bullets |
| Clone an approach from a prior ticket | Add `— reference: PROJ-100` to trigger |
| Implement from a design mockup | Attach image to trigger |
| Standalone resume after crash | Surgeon's check_prerequisites reads manifest version — asks Restart/Proceed/Cancel if LLD drifted |

---

## Purpose

Takes the LLD from Orchestrator + exploration map from Explorer, implements every task with minimal, precise code changes. Produces a Change Manifest tracking every file created/modified. Does NOT run git commit — commits happen in Ship.

## When it runs

- **Per ticket, Step 3 of 5** — after Explorer hands off
- **Per task, sequentially** — tasks run in dependency order
- **Post-verification after each task**, not just at end

## Trigger commands

- `run surgeon`, `Surgeon`
- Auto: after Explorer exploration complete (if configured)

## Phase overview

```
Pre-flight: load_config + resolve context + read LLD + exploration
    ↓
Per-task loop:
    reuse_verification (0a)          [MANDATORY FIRST STEP]
        ↓
    load_coding_standards (0b)       [per-task skill loading]
        ↓
    surgeon_pre_task_hook (0b)        [extension point, optional]
        ↓
    pre_implementation_check (0c)    [MANDATORY]
        ↓
    complexity_circuit_breaker (1)
        ↓
    implement (2)                    [THE CORE STEP]
        ↓
    post_verification (3)            [MANDATORY, per task]
        └── ui_edge_case_checklist (3a) [for frontend tasks]
        ↓
    surgeon_post_task_hook (3b)       [extension point, optional]
        ↓
    track_changes (4)                [NO GIT COMMIT]
        ↓
    task_report (5)
        ↓
    [next task]

After all tasks:
    final_build_check (4)            [all tasks complete]
```

## Phase-by-phase

### reuse_verification (0a) — MANDATORY FIRST STEP

Before writing any code, verify the task's declared action. For 🆕 CREATE tasks:
- Grep shared directories for matching components
- If something resembles the target → HALT, surface to user
- Rationale: Orchestrator + Explorer are supposed to catch this, but Surgeon is the last line of defense

For ♻️ USE tasks:
- Confirm target component exists at declared path
- Mismatch → HALT, don't silently create

Includes i18n check: if new strings are being added, verify they go in the messages file (not hardcoded).

### load_coding_standards (0b) — MANDATORY per task

Loads Tier 2 coding standards skill for the task's Layer. Each pack ships its own at `packs/{pack}/skills/` — e.g. `{pack}-angularjs-standards.md`, `{pack}-angular18-standards.md`, `{pack}-java-standards.md`, `{pack}-rest-standards.md`, `{pack}-test-standards.md`, `{pack}-accessibility-standards.md`.

**Tier 2 skills are per-task** — released before loading next task's skills. Keeps context budget tight.

### surgeon_pre_task_hook (0b, extension point)

Optional. Pack ships a custom skill at `extension_points.surgeon_pre_task` if it wants to insert project-specific pre-implementation logic (e.g. verify JIRA ticket fields, validate environment access, run a security audit for auth-sensitive paths).

### pre_implementation_check (0c) — MANDATORY

Reads target files fully. Consults exploration.md for insertion points + wiring templates.

**v19 rule:** if exploration.md has `STALE_FOR_STORY` markers for any file, re-read the file fully and verify insertion point. Don't trust line numbers from a stale map entry.

### complexity_circuit_breaker (1)

Pre-flight check: does this task realistically take >5 files or >200 lines?
- If yes → HALT, suggest splitting
- Rationale: large single tasks are hard to review + often indicate LLD miscoping

### implement (2) — THE CORE STEP

Writes the code. Follows:
- Coding standards loaded at 0b
- Insertion points + wiring templates from exploration.md
- Task's action type (USE = wiring only, CREATE = full component, MODIFY = delta)
- Contract confidence rules:
  - HIGH → use declared schema
  - MEDIUM/LOW → use Explorer's wiring template exactly
  - NONE + consumer hint → use consumer-derived pattern only

**Convention priority:** codebase-map > Tier 1 rules > Tier 2 skills. If codebase already uses pattern X, match it even if Tier 2 skill says Y.

### post_verification (3) — MANDATORY per task

After each task:
- Syntax valid? (type check for TS, compile for Java)
- Task-specific verification (e.g. new directive registered in module.js)
- Imports resolved?
- No accidental business logic changes outside scope

For MEDIUM/LOW/NONE contract tasks: does NOT assert schema shape — those defer to integration tests.

### ui_edge_case_checklist (3a) — MANDATORY for frontend tasks

Ten checkpoints for every UI task:
- Loading state visible
- Error state renders
- Empty state handled
- Permission state (user without perms sees appropriate UI)
- Disabled/read-only state works
- Keyboard navigation works
- Screen reader labels present
- Mobile/narrow viewport layout OK
- Long-text truncation
- Focus management after action

### surgeon_post_task_hook (3b, extension point)

Optional. Symmetric to pre_task hook.

### track_changes (4) — NO GIT COMMIT

Appends to `contexts/{TICKET_ID}-manifest.md`:
```markdown
## T1 — [done] — ♻️ USE sp-reviewer-selector
Files modified:
  - {frontend_path}/feature/featureList.html (+4 lines)
  - {frontend_path}/feature/featureListCtrl.{ext} (+8 lines)
Stale map re-read: (none for this task)
```

Surgeon does NOT run `git add` or `git commit`. Ship owns all git operations. Manifest is the source of truth for "what this story changed."

### task_report (5)

Inline status after each task — tells user current progress, reveals any issues surfaced during verification. No user gate between tasks by default; can be configured to pause.

### final_build_check (4, all tasks complete)

After every task is done:
- Run pack's full build command (declared in `builds.review_gate` in the pack's pipeline.yaml — e.g. `ant main`, `npm run build`, `mvn test`)
- If build fails → surface error + HALT before Review
- Rationale: fail fast; don't hand broken code to Review

## Inputs

| Source | What's read | Phase |
|---|---|---|
| `contexts/{TICKET}.md` | LLD (tasks, markers, metadata) | pre-flight |
| `contexts/{TICKET}-exploration.md` | insertion points, wiring templates, STALE markers | pre_implementation_check |
| `contexts/project-map.md` | occasional cross-refs (§ 3b, § 6, § 10c) | implement |
| Pack Tier 2 skills | coding standards per layer | load_coding_standards |
| Pack Tier 1 rules | project-wide rules (i18n, security, etc.) | reuse_verification, implement |
| Pack extension skills | pre/post-task hooks (optional) | surgeon_pre_task_hook, surgeon_post_task_hook |
| Target files | actual source to modify | implement |

## Outputs

Primary: `contexts/{TICKET_ID}-manifest.md` — Change Manifest:
- One section per task: files created/modified/deleted with line counts
- Stale map re-reads (v19): which STALE files got re-verified
- Build status: pass/fail per task + final

Secondary: actual code changes in the repo (uncommitted). Ship commits.

## Hand-off contract

After all tasks complete + final build passes:
1. `{TICKET}-manifest.md` written and valid
2. All code changes in working directory (NOT committed)
3. Hand off to Review (or AC-E2E-Check optionally)

Review reads the Change Manifest + runs its own verification. Ship reads the manifest for commit message generation.

## Dependencies

- **Orchestrator + Explorer must have run** — LLD + exploration.md required
- **pipeline.yaml must declare** `skills.surgeon.coding_standards.*` per layer
- **Build tool must be available** for final_build_check (ant/npm/maven/gradle)
- **Git required** only for tracking mods — Surgeon never commits

## Token economics

Typical medium-complexity story (3-5 tasks):

| Phase | Per-task input | × tasks | Total |
|---|---|---|---|
| pre-flight (once) | ~3k | 1× | ~3k |
| reuse_verification | ~500 | 3-5× | ~2k |
| load_coding_standards | ~2-3k | 3-5× | ~10-15k (tier 2 skills) |
| pre_implementation_check | ~3-5k | 3-5× | ~10-20k (file reads) |
| implement | ~2-4k output | 3-5× | ~10-15k output |
| post_verification | ~500 | 3-5× | ~2k |
| final_build_check | ~1k | 1× | ~1k |

Total: ~40-60k input + ~10-15k output. Surgeon is usually the most expensive agent per story because it actually reads and writes code.

## Common failure modes

- **reuse_verification HALT** — found a matching component that Orchestrator missed. User amends LLD (change CREATE → USE) via `gate_for_approval (C)`.
- **complexity_circuit_breaker HALT** — task is too big. User splits it via Amender, or accepts the over-scoping with explicit override.
- **implement fails post_verification** — build breaks, types don't resolve. Surgeon surfaces error; user can fix manually or re-run with adjusted approach.
- **Stale map re-read reveals insertion point moved** — file was refactored. Surgeon adjusts; notes in manifest.
- **Extension hook skill errors** — pack-shipped hook has a bug. Surgeon falls back to default behavior if `extension_points.surgeon_pre_task.on_error: continue`.
- **final_build_check fails** — one of the tasks introduced a regression elsewhere. Surface to user before Review.

## Configuration knobs

```yaml
skills:
  surgeon:
    coding_standards:
      angularjs: "{pack}-angularjs-standards.md"
      angular18: "{pack}-angular18-standards.md"
      java: "{pack}-java-standards.md"
      # ... per layer
  tier_1:
    - "{pack}-rule-i18n.md"
    - "{pack}-rule-no-devrebuild.md"
    - "{pack}-rule-structured-logging.md"
    - "{pack}-rule-test-coverage.md"

builds:
  commands:
    main: "ant main"
    test: "ant test"
  never_run:
    - "ant -f DevRebuild.xml"

extension_points:
  surgeon_pre_task: null              # optional pack-provided skill
  surgeon_post_task: null

runtime:
  surgeon:
    complexity_breaker:
      max_files_per_task: 5
      max_lines_per_task: 200
```

## Cross-agent awareness

- **Reads Explorer's STALE_FOR_STORY markers** (v19) — re-reads flagged files
- **Respects Orchestrator's contract_confidence markers** — adjusts verification per tier
- **Respects Orchestrator's button_intent markers** — ensures required ACs are satisfied
- **Writes Change Manifest** — consumed by Review + Ship
- **Tier 2 skills per-task** — context budget discipline

## Version history

- Pre-v14 — core phase structure established
- v14.0 — MANDATORY Step 0c pre-implementation check
- v15.0 — contract confidence adjustment in post_verification (don't assert MEDIUM/LOW schemas)
- v15.1 — reuse_verification strengthened for v15 marker preservation
- v16.0 — extension points for pre/post_task hooks
- v19.0 — STALE_FOR_STORY awareness rule added
- v21.0 — semantic phase names
