# 05 — AC-E2E-Check

## Quick Reference

### Invocation modes

| Mode | Trigger | Outcome |
|------|---------|---------|
| **Pipeline — story** | `Demo <TICKET>` / `Verify <TICKET>` / `AC e2e check <TICKET>` | Gap analysis + browser walk per AC |
| **Pipeline — epic** | `Demo epic <EPIC_ID>` / `Verify epic <EPIC_ID>` | Full epic E2E plan run + status updates |
| **Pipeline — plan maintenance** | `Update epic plan <EPIC> with <TICKET>` / `Sync epic plan <EPIC>` | Maintain `epic-e2e-plan.md` without running tests |
| **Standalone** | `@ac-e2e-check.md Demo <URL>` or `Verify: <scenario>` | Ad-hoc browser walkthrough; no ticket required |

### Example commands

```
# Pipeline
Demo PROJ-1234                                  # verify all ACs for this story in a browser
Verify PROJ-1234                                # alias
Demo PROJ-1234 analyze                          # static gap analysis only, no browser
Demo epic PROJ-EPIC-100                         # run the full epic E2E plan

# Standalone
@ac-e2e-check.md Demo https://staging.example.com/user/profile
@ac-e2e-check.md Verify: log in as admin, click Save, confirm toast
```

### What it reads

| From `pipeline.yaml` | Why |
|---------------------|-----|
| `demo.enabled` | Master toggle |
| `demo.base_url` | Target environment |
| `demo.auth.login_url` + `username` + `password` | Browser login flow |
| `demo.verify_mode` | `ai_browser` / `e2e_generate` / `terminal_run` / `both` |
| `demo.pre_verify.*` | Optional build/deploy command before verification |
| `demo.e2e.*` (framework, run_command, spec_dir, spec_pattern) | For `terminal_run` mode |
| `demo.screenshots_dir` | Where to save browser screenshots |
| `skills.orchestrator.ac_templates_intent_aware` | AC intent classification (same skill Orchestrator uses) |
| `scan_exclusions` | Keep any greps out of node_modules |

### What it reads from contexts/

**Pipeline:**
- `$CONTEXTS_FILE` — AC Registry + Requirement Summary
- `$LLD_FILE` — PART 2 tasks (for coverage map)
- `$MANIFEST_FILE` (if exists) — to know what Surgeon implemented

**Standalone:**
- Only `pipeline.yaml`'s `demo.*` config — no ticket required

### What it writes

| Output | When |
|--------|------|
| Screenshots to `demo.screenshots_dir/` | All verification runs |
| New tasks appended to `$LLD_FILE` PART 2 | If gap analysis finds missing coverage |
| `contexts/<epic>/<TICKET>-demo.md` | Verification report (pipeline) |
| `contexts/<epic>/epic-e2e-plan.md` | Epic mode — living plan doc |
| `contexts/standalone/standalone-demo-{ts}.md` | Standalone browser walk |

### Phase overview

```
0    detect_invocation_mode   — pipeline / standalone
0    check_prerequisites      — (pipeline) ACs + tasks exist; (standalone) URL + creds
0    resolve_mode             — story / epic / plan-maintenance / standalone
1    load_demo_config         — base_url, auth, verify_mode
1b   verify_mode              — pick ai_browser / e2e_generate / terminal_run
1c   pre_verify_build         — optional build + health check
0a   build_coverage_map       — (pipeline story) 3-way: Req → AC → Task
0b   print_coverage_matrix    — surface gaps
0c   generate_gap_tasks       — (on approval) create new tasks
0d   add_tasks_run_surgeon    — append to $LLD_FILE PART 2, route back to Surgeon
1-6  browser verification     — walk each AC, screenshot results
```

### Enrichment support

Not applicable. AC-E2E-Check consumes ACs from `$CONTEXTS_FILE` (pipeline) or free-form scenario (standalone). No reference-ticket or image enrichment — browser verification is the enrichment itself.

### Typical scenarios

| Situation | Command |
|-----------|---------|
| Verify Surgeon's work in a browser before Review | `Demo PROJ-1234` |
| Just analyze ACs vs. tasks (no browser) | `Demo PROJ-1234 analyze` |
| Run full epic plan | `Demo epic PROJ-EPIC-100` |
| Add a manually-coded story to an existing epic plan | `Update epic plan PROJ-EPIC-100 with PROJ-1240` |
| Just walk through a URL, no ticket | `@ac-e2e-check.md Demo https://...` |

---

## Purpose

Verifies that every Acceptance Criterion from the LLD is actually satisfied by the implemented code. Runs **between Surgeon and Review**, but is OPTIONAL — teams can skip it if their Review process covers the same ground, or run it selectively on risky stories.

Operates in three modes:
- **Story mode** — static gap analysis per story; optional browser verification
- **Epic mode** — walk through all scenarios in the Epic E2E Plan
- **Terminal mode** — execute generated E2E specs headlessly

## When it runs

- **Per ticket, optional Step between Surgeon and Review**
- **Epic mode:** `Demo epic <EPIC_ID>` — end-of-epic verification
- **Spec generation mode:** configurable via `demo.verify_mode` in pipeline.yaml
- **Not auto-invoked** — user explicitly runs it

## Trigger commands

- `AC e2e check`, `Verify ACs`, `Demo` (legacy alias)
- `Demo epic <EPIC_ID>` — Epic mode
- Commands vary per pack; see router rule.

## Phase overview

```
Pre-flight:
    resolve_mode (0)
        ↓
    load_demo_config (1)
        ↓
    verify_mode (1b)
        ↓
    pre_verify_build (1c)   [optional health check]
        ↓
    [branch by mode]
    ├── Story mode  → static_gap_analysis (Phase 0) + optional browser
    ├── Epic mode   → epic_e2e_walkthrough (Phase 0-EPIC)
    └── Terminal    → terminal_run (Phase T)

Story mode with browser verification:
    static_gap_analysis (Phase 0) [three-way coverage check]
        ↓
    walkthrough_plan (Phase 2)
        ↓
    execute_each_ac (Phase 3)
        ↓
    passive_checks (Phase 4)
        ↓
    browser_failure_surgeon_loop (Phase 5)   [if failures → back to Surgeon]
        ↓
    complete_picture_report (Phase 6)
```

## Phase-by-phase (Story Mode)

### resolve_mode (0)

Determines: Story / Epic / Plan Maintenance. Based on trigger command + LLD contents.

### load_demo_config (1)

Reads `demo:` section of pipeline.yaml — verify_mode, browser settings, spec generation preferences.

### verify_mode (1b)

Three canonical verify modes:
- `static_only` — just static gap analysis, no browser
- `ai_browser` — uses browser MCP tool for interactive verification
- `terminal_run` — executes generated E2E specs via bash_tool
- `both` — static + one of the above
- `e2e_generate` — generates spec files (no execution)

### pre_verify_build (1c)

Optional health check: run build + smoke test before attempting UI verification. Catches "app doesn't start" before wasting browser time.

### static_gap_analysis (Phase 0) — three-way coverage (v15+)

The core Story-mode check. Builds a three-way trace:

```
REQUIREMENT SUMMARY → AC REGISTRY → TASKS
```

Three checks:

**Requirement → AC (forward trace):**
- Every item in `what_to_build` has a matching AC? If not → 🔴 ORCHESTRATOR GAP
- Every constraint has an enforcing AC? If not → 🟡 CONSTRAINT GAP
- Every edge case has coverage? If not → 🟡 EDGE CASE GAP

**AC → Task (implementation trace):**
- Every AC has a task satisfying it? If not → 🔴 SURGEON GAP
- Task exists but verify_by is vague? → ⚠ PARTIAL
- Orphan task (code with no AC justification)? → note SCOPE CREEP candidate

**Task → Requirement (reality check):**
- Every task maps to something in `what_to_build`? If not → 🟡 SCOPE CREEP

**Intent-aware gap prioritization (v16):**
Gaps are escalated/demoted by button intent:
- `destructive-confirm`, `destructive-immediate`, `bulk-action` → 🛑 CRITICAL (must fix before review)
- `submit` → 🔴 HIGH
- `async-action` → 🟡 MEDIUM (default)
- `navigation`, `toggle` → 🟢 LOW
- `unknown-intent`, `ambiguous` → HALT

Critical gaps block progression to browser verification until fixed (via `generate_gap_tasks` + re-run Surgeon).

### build_coverage_map (0a) + print_coverage_matrix (0b)

Emits the three-way matrix. Format:

```markdown
## 🛑 CRITICAL GAPS (destructive / bulk intents)

| Task | Button | Intent | Missing ACs |
|------|--------|--------|-------------|
| T5   | Revoke | destructive-confirm | Audit log, Undo/rollback |

## 🔴 HIGH GAPS (submit intents)
...

## 🟡 MEDIUM / 🟢 LOW GAPS
...
```

### generate_gap_tasks (0c) — on approval

If gaps found and user approves "Add tasks", generates new LLD tasks to close them:
- Adds to existing LLD PART 2
- Updates AC Registry
- Bumps LLD amendment version

### add_tasks_run_surgeon (0d)

If user chose to add tasks, invoke Surgeon to implement them. Loop returns to static_gap_analysis once complete.

### walkthrough_plan (Phase 2) → execute_each_ac (Phase 3) → passive_checks (Phase 4)

Browser verification phases (ai_browser or both mode):
- Phase 2: build the click-through plan per AC
- Phase 3: execute each AC in order, capturing screenshots
- Phase 4: check non-functional properties (no console errors, a11y basics, response times)

**Priority ordering (v16):** Phase 3 runs CRITICAL first, then HIGH, then MEDIUM, then LOW. `--skip-low` flag for token-constrained runs.

### browser_failure_surgeon_loop (Phase 5)

If browser verification reveals a failing AC:
1. Capture screenshot + console state
2. Emit bug LLD with localization hint
3. Hand off to Surgeon with fix directive
4. Surgeon fixes, loops back to Phase 3

### complete_picture_report (Phase 6)

Final verification report:
- Which ACs passed / failed
- Screenshots per AC
- Gaps that were closed during this run
- Any remaining gaps (if user declined to fix)

## Phase-by-phase (Epic Mode)

### epic_e2e_walkthrough (Phase 0-EPIC)

Runs when user says `Demo epic <EPIC_ID>`. Walks through `{EPIC_ID}-epic-e2e-plan.md` — the epic-level E2E plan Review built incrementally.

- `load_plan_check_missing (0-E1)` — load plan, warn if any story in epic hasn't contributed scenarios
- `execute_scenarios (0-E2)` — run each scenario, update status in real time
- `cross_story_integrity (0-E3)` — verify data flows across stories (Story 1 creates X, Story 3 reads X)
- `update_plan_file (0-E4)` — persist statuses to `epic-e2e-plan.md`

## Phase-by-phase (Terminal Mode)

### terminal_run (Phase T) — when verify_mode = terminal_run

Executes generated E2E spec files via bash_tool (headless browser):
- `check_specs_exist (T-1)` — verify spec files present
- `terminal_pre_verify (T-2)` — same as Phase 1c
- `execute_terminal_runner (T-3)` — run Playwright/Cypress/similar
- `present_results_gate (T-4)` — show pass/fail summary
- `load_screenshots_on_demand (T-5)` — user requests specific screenshots

## Phase-by-phase (E2E Spec Generation)

### e2e_spec_generation (Phase 0E)

When verify_mode includes spec generation:
- `generate_specs (0E-a)` — generate spec files from AC Registry
- `run_specs_headless (0E-b)` — optional headless run to smoke-test generated specs
- `commit_spec_files (0E-c)` — if `demo.e2e.commit_specs: true`, commit to repo

## Inputs

| Source | What's read | Phase |
|---|---|---|
| `contexts/{TICKET}.md` | LLD (Requirement Summary, AC Registry, Tasks, Intents) | static_gap_analysis |
| `contexts/{TICKET}-manifest.md` | Change Manifest (what code changed) | static_gap_analysis, execute_each_ac |
| `contexts/{EPIC}-epic-e2e-plan.md` | epic-level plan (Epic mode) | epic_e2e_walkthrough |
| `contexts/project-map.md § 10c` | button intents for prioritization | static_gap_analysis |
| Pack AC template skill | intent → required ACs | static_gap_analysis |
| `pipeline.yaml.demo` | verify_mode, spec settings | load_demo_config |
| Browser MCP tool | ai_browser mode runtime | walkthrough_plan, execute_each_ac |
| bash_tool | terminal_run mode | terminal_run |

## Outputs

Mode-dependent:
- **Story mode** — Coverage report (markdown), optional new LLD tasks to close gaps, optional screenshots
- **Epic mode** — Updated `{EPIC}-epic-e2e-plan.md` with scenario statuses
- **Terminal mode** — Test run results + screenshots on demand
- **Spec generation** — `.spec.ts` files (optionally committed)

## Hand-off contract

Not part of the mandatory 5-step flow. After AC-E2E-Check:
- **All ACs pass** → hand off to Review normally
- **Gaps closed via Surgeon loop** → Surgeon ran again, now hand off to Review
- **User declined to close gaps** → Review gets the incomplete state + warning flags

## Dependencies

- **Surgeon must have completed** — code changes + manifest required
- **Orchestrator's LLD markers** (intent, contract_confidence) consumed
- **pipeline.yaml.demo** configured — at minimum `verify_mode` set
- **Browser MCP tool** available if using ai_browser mode
- **Spec runner** (Playwright/Cypress/etc) installed if using terminal_run

## Token economics

Highly variable:

| Mode | Typical cost |
|---|---|
| static_gap_analysis only | ~5-10k |
| static + ai_browser | ~20-50k (browser screenshots + DOM reads) |
| terminal_run | ~5-10k (just reading results) |
| Epic mode | ~30-80k (scenarios × stories) |
| Spec generation | ~15-25k |

Cost is higher than Review because browser verification sees real pages.

## Common failure modes

- **No browser MCP tool connected** — ai_browser mode fails. Fall back to static_only.
- **LLD missing AC IDs** — three-way trace can't build. Surface to user to amend LLD.
- **Browser can't navigate to the app** — pre_verify_build catches this. User fixes env before verifying.
- **Flaky AC verification** — intermittent failures confuse Phase 5 loop. Pack can set retry count.
- **Epic plan out of sync** — stories contributed scenarios to plan but plan file wasn't updated. `load_plan_check_missing` warns.
- **Critical gaps user refuses to close** — AC-E2E-Check proceeds with warnings, but Review likely flags too.

## Configuration knobs

```yaml
demo:
  enabled: true                          # master toggle
  verify_mode: "static_only"             # or ai_browser | terminal_run | both | e2e_generate
  
  browser:
    url: "https://localhost:8443/iiq"    # where the app runs
    login_flow: "{pack}-login.md"        # pack-specific login skill
    
  e2e:
    commit_specs: false                  # write generated specs to repo
    spec_dir: "tests/e2e/generated/"
    runner: "playwright"                 # or cypress
    
  health_check:
    enabled: true                        # pre_verify_build
    endpoint: "/health"
    timeout_sec: 30
```

## Cross-agent awareness

- **Reads Orchestrator's intent markers** — drives gap prioritization (v16)
- **Reads Orchestrator's contract markers** — skips schema assertions for MEDIUM/LOW/NONE
- **Invokes Surgeon** via browser_failure_surgeon_loop (Phase 5) or generate_gap_tasks (Step 0c)
- **Writes to Epic E2E Plan** — Review's epic_e2e_plan_preview (PART 5c) previews what Ship will commit
- **Screenshots captured via browser MCP** — if tool unavailable, ai_browser mode degrades

## Version history

- v14.0 — renamed from demo-verify.md (legacy "Demo" trigger still works)
- v15.0 — three-way coverage check introduced
- v16.0 — intent-aware gap prioritization + priority-ordered browser verification
- v21.0 — semantic phase names
