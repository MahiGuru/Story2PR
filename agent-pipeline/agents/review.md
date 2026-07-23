---
name: review
model: inherit
description: REVIEW (Step 4/5). Full project build, per-task code review against LLD, blast radius check, test plan validation, AC compliance, epic-context update. Supports two modes via trigger flag — default (full per-task review) and --slim (integration + AC + blast only, trusts Surgeon's per-task work, ~40% cheaper).
---

## Role

Step 4 of 5. Supports two modes via trigger flag:

**Default (full)** — runs all 6 parts below. Second-opinion code review on every task + all cross-cutting checks. **Required before Ship.** ~95K input tokens, ~$0.50 on Sonnet 4.5.

**`--slim` mode — dev-iteration tool.** Trusts Surgeon + Explorer + Orchestrator's generated context files. Spawns terminal to run the **build + tests**, verifies task/test **presence** in the diff, and **routes failures back to Surgeon** via a gate. Skips everything else (per-task code review, blast radius, AC compliance matrix, pattern, visual, epic-context update). ~40-50K input tokens, ~$0.22. Use between Surgeon iterations. **Never** Ship-ready — you still need default full Review before Ship.

### Six parts in sequence (✓ = runs in --slim; ✗ = skipped in --slim)

| # | Part | Default | `--slim` | Why skipped in slim |
|---|------|:---:|:---:|---|
| 1 | **FULL VERIFICATION** — clean build + full unit test suite | ✅ | ✅ | core signal; always runs |
| 2 | **CODE REVIEW** — per-task correctness / conventions / edge cases | ✅ | ❌ | Surgeon already did per-task review (layer skills, verify-by, Q1-Q5) |
| 3 | **BLAST RADIUS** — cross-feature impact of changed files | ✅ | ❌ | cross-file impact isn't needed for dev iteration — full Review catches before Ship |
| 4 | **TEST PLAN VALIDATION** — AC coverage + spec presence + AC compliance matrix | ✅ | ⚡ presence-only | slim: just "does the expected spec file exist?" No AC→code cross-reference |
| 5 | **EPIC CONTEXT UPDATE** — append story summary to epic-context.md | ✅ | ❌ | slim is an iteration gate, not a shipped-story record — full Review owns this |
| 5b | **PROJECT MAP UPDATE** — update project-map.md if shared resources changed | ✅ | ❌ | slim shouldn't touch project-map mid-iteration — full Review owns this |

**`--slim` failure routing:** if any check fails (build red, tests red, missing task files, missing test files), the gate offers **`Fix via Surgeon`** — hands the failing task list to Surgeon for targeted re-run. Iterate slim → Surgeon → slim until PASS, then run full Review.

## Inputs

- Uncommitted changes on feature branch + Change Manifest from surgeon (`$MANIFEST_FILE`)
- LLD — split across three files:
  - `$CONTEXTS_FILE` — Requirement Summary + Enriched AC Registry (AC compliance matrix, demo scoring)
  - `$LLD_FILE` — PART 2 (Tasks, per-task code review) ALWAYS. PART 2 Section 23b now holds Explorer's filled per-task details (`Insertion Point`, `Reuse Match`, `Explorer Notes`) — Review cross-checks the implemented code against what Explorer said would happen there, flagging any drift (e.g., Surgeon modified a different line than Explorer specified, or the reuse match differs from what landed). **PART 1 (Design rationale) is read ON-DEMAND only** — load it lazily when a cross-task design question emerges during review (e.g., "does T3's approach contradict the architecture decision in PART 1 § 5?"). Default mode skips the PART 1 read to save 5–10K per story. Slim mode already skips it.
  - `$TESTPLAN_FILE` — PART 3 (Test Plan, test_plan_validation) + PART 4 (Test Tasks, spec coverage)
- Explorer report (`$EXPLORATION_FILE`) **— loaded in default mode only; `--slim` skips it**
- Per-layer standards skills (Java, REST, AngularJS, Angular18, etc.) **— loaded in default mode only; `--slim` skips them (Surgeon already applied them per-task)**
- KNOWN_ISSUES from surgeon (if "proceed with errors")

### `--slim` input reduction

Slim treats upstream artifacts as **authoritative context** — reads them to know what to test, does NOT re-analyze them.

| Input | Default | `--slim` | Why |
|---|:---:|:---:|---|
| `review.md` agent prompt | full ~17K | full ~17K | same file, both modes |
| Kernel rules + system overhead | ~14K | ~14K | always-on |
| `pipeline.<pack>.yaml` (core) | ~3K | ~3K | needed for runtime.contexts_layout, branching |
| `pipeline.<pack>.builds.yaml` | ~4K | ~4K | needed for review_gate, review_test_suite |
| `pipeline.<pack>.skills.yaml` | ~2K | ⚡ only `skills.layer_map` path_globs | slim: to map changed files → layer, nothing more |
| `pipeline.<pack>.analyzer.yaml` | ~2K (for scan_exclusions) | ❌ skip | no grep-heavy work in slim |
| `project-context.md` | ~1K | ~1K | ambient project norms |
| `ac-templates-intent-aware` skill | ~1.5K | ❌ skip | no AC-intent matrix in slim |
| Per-layer standards skills (Java, REST, Angular, etc.) | ~8-10K | ❌ skip | Surgeon already applied them per-task |
| `$CONTEXTS_FILE` (Requirement Summary + AC Registry) | ~5K | ⚡ AC titles only (~1K) | slim: just need AC count for test-plan presence |
| `$LLD_FILE` PART 1 (Design rationale) | full ~7K | ❌ skip | no design cross-ref in slim |
| `$LLD_FILE` PART 2 (Tasks) | full ~5K | ⚡ task list only (~3K) | slim: titles + Files + Verify By; no deep review |
| `$TESTPLAN_FILE` PART 3 (Test Plan narrative) | ~4K | ❌ skip | slim doesn't build coverage matrix |
| `$TESTPLAN_FILE` PART 4 (Test tasks) | ~4K | ⚡ test-task list only (~2K) | slim: T-TC → expected spec-file path |
| `$EXPLORATION_FILE` (Explorer's insertion-point annotations) | ~5K | ❌ skip | slim doesn't do per-task review |
| `$MANIFEST_FILE` (Surgeon's Change Manifest) | full ~3-5K | ⚡ task.build_result, verify_by_result only (~2K) | slim reads the trust contract fields |
| Git diff (full content) | ~10-25K | ⚡ `git diff --name-only` (~0.5K) | slim only needs changed-file list, not content |
| project-map.md | ~8-15K | ❌ skip | no blast radius in slim |
| epic-context.md (read to update) | ~3-10K | ❌ skip | no update in slim |
| Build stdout (on failure) | ~2-5K | ~2-5K | same |
| Test stdout (per layer) | ~2-5K | ~2-5K | same |
| **Total** | **~95-120K** | **~40-55K** | |

Expected savings: ~50-65K input tokens with `--slim` (~55% reduction). Cost on Sonnet 4.5: ~$0.22 vs ~$0.50.

## Pre-flight

### Step: parse_slim_flag (0a — parse trigger for --slim)

Before invocation-mode detection, check the trigger text for the `--slim` flag:

```
{slim_mode} = false

IF trigger contains "--slim":
  {slim_mode} = true
  Strip "--slim" from the trigger before further parsing
```

When `{slim_mode} == true`:
- Skip loading `$EXPLORATION_FILE`
- Skip loading per-layer standards skills (Java, REST, AngularJS, Angular18, etc.)
- Skip Part 2 (CODE REVIEW) entirely
- Skip Part 3 (BLAST RADIUS)
- Part 4: presence check only (no AC→TC matrix)
- Skip Part 5 (EPIC CONTEXT UPDATE)
- Skip Part 5b (PROJECT MAP UPDATE)
- Write `mode: slim` in report frontmatter
- At gate, render the slim gate

**One-shot design (no auto-loop):** slim runs once per invocation. On FAIL, the gate does NOT offer an auto-retry via Surgeon. Instead it offers: `Fix manually`, `Run full review` (escalate), or `Cancel`. The user handles the fix themselves (or re-triggers Surgeon explicitly if they want a targeted task-subset re-run).

Rationale: an automatic slim → Surgeon → slim loop can mask structural problems (wrong LLD task, wrong file paths, Surgeon systematically misunderstanding an AC). Forcing the user to decide — fix manually vs escalate to full Review — surfaces those issues immediately.

Slim mode ONLY applies to pipeline mode (`Run the review`). Standalone sub-modes ignore the flag — their scope is already narrower.

### Step: detect_fresh_flag (0a-bis — parse trigger for --fresh, runs after --slim parsing)

Parse the trigger text for the `--fresh` flag (kernel rule: `agent-flow.mdc § --fresh flag`).

```
{flags}.fresh = trigger contains "--fresh"
IF {flags}.fresh: strip "--fresh" from the trigger before further parsing
```

`--fresh` and `--slim` are independent — they can be combined (`Run the review --slim --fresh`), in which case Review runs slim-mode while ignoring prior verdicts.

If `{flags}.fresh == true`, set internal flag `{ignore_freshness_reuse} = true` for this run. This causes:

1. The Surgeon-verdict freshness reuse pre-check in Step 1a (`full_clean_build`) to be SKIPPED — Review always runs the build from scratch, regardless of `$SURGEON_BUILD_REPORT` content.
2. Existing `$REVIEW_FILE`, `$REVIEW_BUILD_REPORT`, and per-layer test reports to be IGNORED on read — Review treats them as if they don't exist.
3. The Part 2 (code review) caching of prior findings to be BYPASSED — every task is reviewed fresh against Tier 2 standards.
4. The Part 5 epic-context update to OVERWRITE this story's prior entry in `epic-context.md` (rather than appending a duplicate) — Review locates the existing entry by ticket ID and rewrites it in place.

Render the active-context line: `Mode: fresh{ + slim if --slim is also set} · ignoring prior verdicts`.

**No file deletion. No confirmation gate.** Pre-existing `$REVIEW_FILE`, `$REVIEW_BUILD_REPORT`, and per-layer test reports stay on disk until Review overwrites them with the new verdicts.

⚠ Note for the user (rendered in active context only when `flags.fresh == true`):

> --fresh re-verifies what's currently on disk; it does not redo Surgeon's
> work. If you want a fresh implementation too, run
> `@surgeon.md Run the surgeon --fresh` BEFORE this command.

### Step: detect_invocation_mode (0 — RUNS FIRST)

Review supports two invocation modes, and standalone has three sub-modes.

```
PIPELINE MODE trigger (requires full upstream chain — Orchestrator → Explorer → Surgeon):
  - "Run the review"              (from Surgeon gate — session-carried ticket)

STANDALONE MODE triggers (ad-hoc):

  Sub-mode: "diff" — generic code-quality review of current diff:
    - "Review changes"            (review current uncommitted + ahead-of-base diff)

  Sub-mode: "ticket" — ticket-scoped review (loads ACs from existing context):
    - "Review <TICKET_ID>"        (trigger matches project_key pattern like PROJ-\d+)
    - Requires $CONTEXTS_FILE to exist for the ticket (Orchestrator ran at least)

  Sub-mode: "ac-driven" — ad-hoc review against inline ACs:
    - "Review against:" + bullet list of ACs
    - "Review against:" + AC{N} markers
    - Any "Review:" trigger whose body contains ≥2 "AC\d+:" or bullet-list ACs

  Enrichment modifiers (combine with any standalone sub-mode):
    - " against pattern <TICKET_ID>"      (ticket + reference) — e.g.
        "Review PROJ-1234 against pattern PROJ-100"
    - " — reference: <TICKET_ID>"         (em-dash alternative syntax)
    - " against design:" + image attachment(s)
        "Review changes against design:" + attached image(s)
    - Image attachment(s) without explicit marker
        → treated the same as "against design:" (agent detects attachments)

  Enrichment limits:
    - At most ONE reference_ticket per run (first kept; rest → warn)
    - At most THREE reference_images per run (first 3 kept; rest → warn)
    - Reference is ENRICHMENT, not required. If reference resolution fails
      (no context file for ref ticket), WARN and proceed without it.

Detection priority:
  1. "Run the review" (exact phrase, no ticket/AC content) → mode=pipeline
  2. "Review against:" + bullets OR ≥2 AC markers → mode=standalone, sub_mode=ac-driven
  3. "Review <TICKET_ID>" (project_key-shaped ID in trigger) → mode=standalone, sub_mode=ticket
  4. "Review changes" (no ticket, no ACs) → mode=standalone, sub_mode=diff
  5. Anything else → HALT with ask

Enrichment detection happens AFTER sub-mode resolution:
  - Extract {reference_ticket} from "against pattern <TICKET>" or "— reference: <TICKET>"
  - Extract {reference_images} from attachments (up to 3)

Ambiguous? HALT ⛔
  "Couldn't tell what kind of review you want:
     Pipeline:        @review.md Run the review      (after Surgeon in full pipeline)
     Diff-only:       @review.md Review changes      (generic code quality)
     Against ticket:  @review.md Review <TICKET_ID>  (AC coverage + quality)
     Against ACs:     @review.md Review against:
                        - AC1: <your criterion>
                        - AC2: ..."

Set {mode} = "pipeline" | "standalone".
If standalone, set {sub_mode} = "diff" | "ticket" | "ac-driven".

IF {mode} == "pipeline":
  run check_prerequisites below.

IF {mode} == "standalone":
  LOAD AND FOLLOW: modes/standalone-review-flow.md
  (the file dispatches by {sub_mode} = diff | ticket | ac-driven and contains
   the shared AC-aware review engine + shared output shape used by ticket +
   ac-driven sub-modes. Externalized to keep the cached prefix small on the
   pipeline path.)
  Do NOT continue with the rest of this file when {mode} == "standalone".
```

### Step: bundle_context_guard (0c — RUNS BEFORE check_prerequisites)

This file is the **single-story / bug** review. Bundle mode has its own dedicated entry point at `agents/bundle/bundle-review.md`. We refuse to handle bundle context here.

```
IF {mode} == "standalone":
  Skip — bundle is pipeline-only.

ELSE ({mode} == "pipeline"):
  Apply Procedure B from agent-flow.mdc with {TICKET_ID} to resolve $CONTEXTS_FILE.
  Read $CONTEXTS_FILE frontmatter ONLY.

  IF frontmatter.mode == "bundle":
    ⛔ HALT — render this redirect:

      ⚠ Bundle context detected (mode: bundle, bundle_id: {frontmatter.bundle_id}).
        The regular @review.md is single-story / bug only.

      Use the dedicated bundle-review instead:

        @bundle-review.md Run the bundle review
        [▶ Run Bundle Review in new chat](cursor://anysphere.cursor-deeplink/prompt?text=%40bundle-review.md%20Run%20the%20bundle%20review)

      Or to resume from a specific task:
        @bundle-review.md Resume bundle-review for {frontmatter.bundle_id} from T<N>

    Do NOT continue with the rest of this file.

  ELSE IF frontmatter.mode in ("bundle-card", "bundle-card-lld", "bundle-evidence"):
    ⛔ HALT: "{$CONTEXTS_FILE} is a bundle companion card; review cannot operate
       on it directly. Use @bundle-review.md Run the bundle review."

  ELSE (frontmatter.mode in ["story", "bug"] OR absent):
    # User context propagation (NEW — opt-in per ticket)
    IF frontmatter has any of {user_context, user_context_path_hints,
                                user_context_layer_hints, reference,
                                out_of_scope, constraints}:
      Stash as {user_directives}; add user-context compliance checks to
      the per-task review pass — same semantics as bundle-review.md
      § User context propagation:
        - Layer-hint coverage: every layer in user_context_layer_hints
          must appear in $MANIFEST_FILE (else flag P1)
        - Constraints compliance: verify each item in constraints
          (perf budget, browser support, a11y, etc.)
        - Out-of-scope violations: any manifest row touching an
          out_of_scope path → flag P0
      Verdict carries an extra `user_context_compliance: PASS|PARTIAL|FAIL`
      flag; PARTIAL drops the overall ship-readiness to PARTIAL.

    Continue to check_prerequisites — UNCHANGED single-story / bug behavior.
```

### Step: check_prerequisites (pipeline mode ONLY — skipped in standalone)

```
1. $CONTEXTS_FILE must exist (via Procedure B).
   IF missing:
     HALT ⛔
     "No context file found for {TICKET_ID}.
      Run the full pipeline first:
        @orchestrator.md Work on {TICKET_ID}
      then Explorer, then Surgeon, then Review."

2. $LLD_FILE + $TESTPLAN_FILE must exist.
   IF either missing:
     HALT ⛔ "LLD/TESTPLAN companion missing. Re-run Orchestrator."

3. $EXPLORATION_FILE must exist.
   IF missing:
     HALT ⛔
     "Exploration missing. Run: @explorer.md Explore {TICKET_ID}"

4. $MANIFEST_FILE must exist (produced by Surgeon).
   IF missing:
     HALT ⛔
     "Change Manifest not found: {path}.
      Surgeon has not run (or did not complete). Run:
        @surgeon.md Run the surgeon
      Review needs the manifest to know which files each task changed."

5. Working tree must have uncommitted changes (what Surgeon produced).
   Check: `git diff --name-only` returns ≥ 1 file.
   IF working tree is clean:
     HALT ⛔
     "Working tree is clean — no uncommitted changes to review.
      Possible causes:
        - Surgeon has not run yet → @surgeon.md Run the surgeon
        - Surgeon ran but changes were already committed → Review only covers uncommitted changes
        - You're on the wrong branch → check `git branch --show-current`"

6. Current branch must match the feature branch recorded in $CONTEXTS_FILE.
   IF mismatch:
     HALT ⛔
     "Not on the expected feature branch.
        Expected: {expected}
        Current:  {current}
      Switch: `git checkout {expected}`"
```

If ALL checks pass, continue.

Resolve paths via `agent-flow.mdc § Procedure B` → `$CONTEXTS_FILE`, `$LLD_FILE`, `$TESTPLAN_FILE`, `$EXPLORATION_FILE`, `$MANIFEST_FILE`, `$REVIEW_FILE`. Check for KNOWN_ISSUES.

**Build `$EXCLUDES` once for every `grep -r` in this agent** (same pattern as Explorer and Project-Analyzer):

```bash
EXCLUDES=$(yaml_get scan_exclusions | jq -r '[.[][]] | unique | map("--exclude-dir=" + .) | join(" ")')
[ -z "$EXCLUDES" ] && EXCLUDES="--exclude-dir=node_modules --exclude-dir=jspm_packages --exclude-dir=bower_components --exclude-dir=vendor --exclude-dir=.venv --exclude-dir=target --exclude-dir=build --exclude-dir=dist --exclude-dir=.next --exclude-dir=__pycache__"
```

This keeps blast-radius search out of dependency/build dirs where third-party code could spuriously match a changed filename.

**Optional — load Demo Report if AC-E2E-Check ran (Step 3.5):**
```bash
DEMO_REPORT=$(glob "contexts/**/{TICKET_ID}-demo.md" | head -1)
if [ -f "$DEMO_REPORT" ]; then
  # Read summary only: coverage pct, AC results table, P1 issues
  # Use in code_review (PART 2) code review: Demo FAIL on an AC → P1 in code review
  DEMO_SUMMARY=$(extract_demo_summary "$DEMO_REPORT")
fi
```

### Step: render_active_context (pre-flight final — user-visible disclosure)

After pre-flight completes, render the **Active Context** block once. Resolve every `{placeholder}` — don't print the literal `{...}`.

```
┌─ Active Context — Review (Step 4/5) ───────────────────────────┐
│ Ticket:    {TICKET_ID} · changed files: {N}                    │
│ Pack:      {postverify rule(s) that will load per-task}        │
│            e.g. {pack}-angularjs-postverify.mdc                │
│ Build:     {builds.review_gate command — e.g. "ant clean build"}│
│ Tests:     {builds.tests.* list — e.g. jstests, ng test, jtest}│
│ Hooks:     {none — Review has no pre/post hooks today}         │
│ Demo:      {"loaded from $DEMO_REPORT" | "not available"}      │
│ Routing:   vcs → {role_resolution.vcs.mcp} {status_marker}     │
│            (used only for reference-PR fidelity check)          │
│ Config:    scan_exclusions ({N} dirs)                          │
│ Rules:     Tier 1 kernel + {pack-name}-postverify rules        │
└────────────────────────────────────────────────────────────────┘
```

**Rendering rules:**
- Pack postverify rules are pack-specific (`{pack}-…` filename prefix); list all that will apply based on the task layers in the manifest.
- If `$DEMO_REPORT` is absent: show `Demo: not available (AC-E2E-Check did not run)`.
- **Routing line:** Review consumes `{role_resolution.vcs.mcp}` — inherited from Orchestrator's `contexts/{TICKET}-*.md` artifacts (the reference-PR diff, if any, was already fetched during Orchestrator's `resolve_enrichments (A0.6)` and is available via Cross-Reference Findings). Re-resolve the VCS role only if Review is running standalone (no Orchestrator artifacts present) — follow the ladder in `agent-flow.mdc § MCP role resolution § Resolution ladder`. Show `→ {local_fallback}` if a flag removed the MCP (pattern comparison degrades to local-ref-LLD-only).
- Render once at end of pre-flight; do not repeat per-task (review keeps context tight).

---

## Part: full_verification (PART 1 — build + unit tests)

**Why both matter:** Build catches compile errors. Tests catch behavioral regressions. Running build only and calling it "verified" is half the check. A story can build cleanly while breaking 3 other features' test specs.

### Step: full_clean_build (1a)

**Pre-check — reuse Surgeon's build report if fresh.** Before running anything, check whether Surgeon already completed the same `ant clean build` and nothing has changed since. When that's true, Review skips the re-run and reuses the verdict. See "Build report contract" in `agent-pipeline/rules/agent-flow.mdc` for the schema + freshness-check spec.

**`--fresh` flag override:** if `{ignore_freshness_reuse} == true` (set by `detect_fresh_flag` step 0a-bis), SKIP the entire pre-check below and FALL THROUGH directly to the full clean build. The user explicitly opted into a fresh re-run; verdict reuse is bypassed.

```bash
IF {ignore_freshness_reuse}:
    echo "→ --fresh mode: skipping freshness reuse, running review_gate from scratch"
    FALL THROUGH to the full clean build below

ELSE IF exists($SURGEON_BUILD_REPORT):
    Read $SURGEON_BUILD_REPORT → parse YAML front-matter → extract .verdict, .started_at, .command, .duration_s
    manifest_mtime = max(mtime of each file path listed in $MANIFEST_FILE)

    IF .verdict == "PASS" AND .started_at > manifest_mtime AND .command == $(yaml_get builds.review_gate):
        echo "→ Surgeon's final build report is fresh (PASS, ${duration_s}s, ${started_at}) — reusing verdict"
        echo "→ Skipping review_gate (saved ~${duration_s}s of rebuild time)"
        APPEND to $REVIEW_FILE under "## Build Gate":
          Build: PASS (reused from $SURGEON_BUILD_REPORT)
          Command: {.command}
          Duration: {.duration_s}s
          Started at: {.started_at}
          Reused: true
        DO NOT write $REVIEW_BUILD_REPORT — Surgeon's report is the authority.
        PROCEED to Step 1b (unit_test_suite)

    ELSE IF .verdict == "FAIL":
        echo "→ Surgeon's final build FAILED (${started_at}) — Review should not be running yet"
        echo "→ Hand back to Surgeon via Fix-via-Surgeon gate; do not attempt Review fixes on a failed Surgeon build"
        Render the build-failure gate below with context "Surgeon's build failed — not re-running"

    ELSE IF .started_at <= manifest_mtime:
        echo "→ Surgeon's build report is stale (file edits after ${started_at}) — running review_gate fresh"
        FALL THROUGH to the full clean build below

ELSE:
    echo "→ No $SURGEON_BUILD_REPORT found — running review_gate fresh"
    FALL THROUGH to the full clean build below
```

**Visibility — when Review DOES run its own build, print this so the user sees what's running and why it failed if it fails:**

```
[Before running]
▶ Running: {exact review_gate command}
  (source: builds.review_gate)

[Heartbeat if silent > 60s]
⏳ Still running at {n}s — {exact command}

[After success]
✓ Done in {Xs} — {exact command}

[After final failure (see gate below)]
✗ Failed after {Xs} (exit {N}) — {exact command}

  Output (last 20 lines, middle-truncated if longer):
  ─────────
  {first 10 lines}
  ... {K} lines omitted (total output: {total} lines) ...
  {last 10 lines — usually the actual error}
  ─────────
```

**Runner wrapper (MANDATORY — file-only mode):** Compose `{build_command}` through `builds.runner.template_with_report` so the tool result is just `exit=N` and the verdict is written to `$REVIEW_BUILD_REPORT`. Review's fix loop may invoke the build up to 3 times; without the file-only wrapper those 3 runs' tails would all end up in Review's context permanently.

```bash
RUNNER_TPL=$(yaml_get builds.runner.template_with_report)
LOG=$(yaml_get builds.runner.log_path)
BUILD_CMD=$(yaml_get builds.review_gate)   # pack-specific full build

WRAPPED=$(echo "$RUNNER_TPL" | sed \
  -e "s|{cmd}|$BUILD_CMD|g" \
  -e "s|{log}|$LOG|g" \
  -e "s|{report}|$REVIEW_BUILD_REPORT|g" \
  -e "s|{agent}|review|g" \
  -e "s|{phase}|review_gate|g")
eval "$WRAPPED"
# Tool result: `exit=N`. On FAIL, Read $REVIEW_BUILD_REPORT to get tail_30.
```

If fails on surgeon's changes:
1. Read `$REVIEW_BUILD_REPORT` → parse `.tail_30` → identify the error.
2. Fix with minimal change, show BEFORE/AFTER diff.
3. Re-run build (re-eval the WRAPPED command — overwrites `$REVIEW_BUILD_REPORT` with latest verdict). Repeat until clean or up to **3 iterations** (reduced from 10 — 3 targeted fixes either converge or indicate a structural problem that a 4th–10th attempt will not solve; cap keeps wasted fix cycles from compounding token cost).

**After 3 failed fix iterations OR if the failure is clearly environmental (command not found, missing dep, hang detected by the user):** apply the build-failure gate below — do NOT silently halt the review.

```
## ✗ Review gate build failed

**Command:** `{exact review_gate_cmd}`
**Exit:** {code}
**Elapsed:** {Xs} across {K} fix iterations (cap: 3)
**Report:** `$REVIEW_BUILD_REPORT` (structured verdict)
**Full log:** `{builds.runner.log_path}` (raw output — on disk, machine-local)

Output (last 30 lines — read from $REVIEW_BUILD_REPORT.tail_30 on demand, not inlined):
─────────
{render .tail_30 from the report IF rendering this gate to the user — otherwise just reference the path}
─────────

> **👉** Pick one:
>   - `retry` — re-run the clean build (use if you fixed something in another terminal)
>   - `skip` — mark review_gate SKIPPED; Review continues and the final verdict shows BUILD: FAIL-SKIPPED so Ship and downstream reviewers know the clean build wasn't verified
>   - `Fix via Surgeon` — route the failure back to Surgeon for a targeted re-run (slim-mode-style handoff)
>   - `cancel` — halt Review
```

**Response handling:**

| Response | Action |
|---|---|
| `retry` | Re-run the exact same command once. If it fails again, render this gate again. |
| `skip` | Write `Build SKIPPED: id=review_gate reason="{user reason}"` to `$REVIEW_FILE` under a `## Build Gate` heading. Set BUILD field in the verdict to `FAIL-SKIPPED`. Proceed to Step 1b (unit_test_suite). |
| `Fix via Surgeon` | Standard slim-mode handoff — route the failing task list back to Surgeon. |
| `cancel` | Halt Review; resume via `@review.md Run the review`. |

**Hang behavior:** if the user interrupts the Review conversation while the clean build is running with a message indicating hang ("stuck", "hanging", "skip"), treat it as a `skip` request against `review_gate` — write the skip entry and proceed to Step 1b.

Pre-existing failures (same failure existed before this story started — verify by running on base): log, don't auto-fix. Report: BUILD PASS / PASS WITH FIXES / FAIL-SKIPPED / FAIL.

### Step: unit_test_suite (1b — MANDATORY, not optional)

Run the FULL test suite, not just the tests for the changed files. **Each invocation MUST be wrapped via `builds.runner.template_with_report`** — same rationale as Step 1a. Each test-suite run writes its own report file (so a JS-tests failure doesn't overwrite a Java-tests pass):

```bash
RUNNER_TPL=$(yaml_get builds.runner.template_with_report)
LOG=$(yaml_get builds.runner.log_path)

# Per-layer commands from builds.review_test_suite.*
for LAYER in "js" "angular18" "java"; do
  TEST_CMD=$(yaml_get "builds.review_test_suite.$LAYER")
  [ -z "$TEST_CMD" ] && continue
  # Each layer gets its own report suffix so runs don't clobber each other
  REPORT="${REVIEW_BUILD_REPORT%.md}-tests-${LAYER}.md"

  WRAPPED=$(echo "$RUNNER_TPL" | sed \
    -e "s|{cmd}|$TEST_CMD|g" \
    -e "s|{log}|$LOG|g" \
    -e "s|{report}|$REPORT|g" \
    -e "s|{agent}|review|g" \
    -e "s|{phase}|unit_test_suite:${LAYER}|g")
  eval "$WRAPPED"
  # Tool result: `exit=N`. On FAIL, Read $REPORT for tail_30.
done
```

Source commands from `builds.review_test_suite.*`:
- `ant jstests` — All Jasmine unit tests (JS layer)
- `ng test --watch=false --no-progress` — All Angular unit tests (TS layer, if present)
- `ant jtest` — All JUnit unit tests (Java layer)

**Test result classification:**

```
FOR each test failure:
  Is it in files I changed (from Change Manifest)?
    YES → MY FAILURE (must fix before proceeding)
    NO  → PRE-EXISTING or COLLATERAL DAMAGE

  Collateral damage (my change broke another feature's test):
    → Read the failing test
    → Did I change a shared component?  → likely blast radius
    → Did I change a shared service?    → likely blast radius
    → Determine: EXPECTED (test should be updated) or REGRESSION (my code broke it)
    → REGRESSION → P0 BLOCKER (must fix before continuing)
    → EXPECTED update → fix test, explain why change is correct
```

**Do not skip this step.** If test suite is slow, run only the layers that changed:
- Changed Java only → ant jtest only
- Changed JS only → ant jstests only
- Changed both → run both

**Report format:**
```
Build:  PASS | {N} compile errors (pre-existing: {M})
JS tests:  {P} PASS / {F} FAIL ({mine: N, collateral: M, pre-existing: K})
TS tests:  {P} PASS / {F} FAIL (or: N/A)
Java tests: {P} PASS / {F} FAIL ({mine: N, collateral: M, pre-existing: K})

MY failures (must fix):    {list with test name + error}
COLLATERAL damage (investigate): {list with test name + suspected cause}
PRE-EXISTING (log only):   {list}
```

Any MY failure or COLLATERAL REGRESSION → P0 BLOCKER → fix before code review.

---

## Part: code_review (PART 2 — per task, file-by-file)

**⚡ `--slim` mode: SKIP this entire part.** Surgeon's per-task work (layer skills, verify-by, component atomicity, reuse verification, Q1-Q5 edge-case handling) is trusted. Record in the Review report: `Part 2: SKIPPED — --slim mode. Trusted Surgeon's per-task verdicts from $MANIFEST_FILE.` Then jump to Part 3 (blast_radius).

**In `--slim` mode, read these manifest fields** (instead of doing your own per-task review) to populate the per-task summary row-minimally:
- `manifest.tasks[T{N}].build_result` — PASS/FAIL from Surgeon's per-task build
- `manifest.tasks[T{N}].verify_by_result` — PASS/FAIL from Surgeon's verify-by check
- `manifest.tasks[T{N}].layer_skills_applied` — list (for traceability)
- `manifest.tasks[T{N}].edge_cases_handled` — Q1-Q5 decisions

If ANY of these fields are missing from the manifest, Surgeon's work isn't verifiable from the manifest alone → `--slim` mode HALTs with:
```
⛔ --slim mode requires complete per-task audit in $MANIFEST_FILE (build_result, verify_by_result, layer_skills_applied, edge_cases_handled).
   Missing: {fields}
   Either re-run Surgeon to produce a complete manifest, OR re-run Review without --slim.
```

**Default mode (no --slim flag) continues below — full per-task code review:**

**Context-efficient:** Do NOT load all diffs at once. One task at a time:

```
For each task T{N}:
  1. Read manifest → get T{N}'s files
  2. git diff -- {T{N} files only}
  3. Check against LLD task entry in $LLD_FILE (PART 2 for impl tasks, $TESTPLAN_FILE PART 4 for T-TC* tests)
  4. Produce verdict
  5. Release diff from memory → next task
```

**Checklist per task:**
1. **Correctness** — does it do what `$LLD_FILE` says? ACs from `$CONTEXTS_FILE` actually satisfied?
   - If Demo Report exists: cross-ref with AC browser results
     Demo ✅ PASS → strong confidence
     Demo ❌ FAIL → P1 MAJOR (browser confirmed it doesn't work — must fix)
     Demo ⏭ SKIPPED → review code carefully (no browser confirmation)
2. **Completeness** — fully implemented? All files changed?
3. **Conventions** — follows project patterns? Naming, style?
4. **Edge cases — MANDATORY for frontend tasks** (5 questions, each unhandled = P1):
   ```
   For any task whose Layer starts with "Frontend/" OR whose file paths match
   a frontend entry in pipeline.yaml shared_paths:

   Read the manifest's Edge cases section. If not present → check diff directly.

   The 5 questions are framework-neutral. The specific grep patterns that verify
   them come from pack rules loaded for task.layer — e.g. {pack}-angularjs-postverify.mdc
   provides AngularJS-specific patterns; other packs ship their own framework-specific rule.

   Q1 Null:       Do all data-bound elements guard against null/undefined?
                  Unhandled? → P1 "null data shows blank/crash"

   Q2 Empty:      Does iteration over an empty list show a meaningful empty state?
                  Unhandled? → P1 "empty list shows nothing, no feedback"

   Q3 Loading:    Is there a loading indicator during fetch, removed in BOTH
                  success AND error paths?
                  Unhandled? → P1 "no loading state, or spinner never stops on error"

   Q4 Error:      Does the error handler show user-visible error AND set safe fallback?
                  Unhandled? → P1 "fetch failure shows nothing"

   Q5 Permission: If task has PERMISSION-type ACs, is no-right state handled?
                  Unhandled? → P1 "renders for users without required right"
   ```
5. **Performance** — no leaks, no N+1, caching appropriate?
6. **Security** — no XSS, no exposed secrets, input validation?
7. **LLD compliance** — matches design? No unauthorized changes?
8. **Component structure** — if task CREATED a new component, verify ALL required files exist:
   ```
   FOR each CREATED file in Change Manifest:
     Resolve layer via layer_map in pipeline.yaml
     IF component_structure[layer] exists in pipeline.yaml:
       FOR each required_file in component_structure[layer].required_files:
         Verify file exists → if missing, flag P1
   ```
   Missing file → P1 MAJOR: "Component created but required sibling file is missing"

**Bug classification:**
- P0 BLOCKER: auto-fix with diff, re-build
- P1 MAJOR: present with recommended fix, user decides
- P2 MINOR: note in review
- P3 NIT: review notes only

Per-task verdict: PASS / PASS WITH NOTES / NEEDS FIX.

---

## Part: blast_radius (PART 3)

**⚡ `--slim` mode: SKIP this part.** Slim is a dev-iteration tool — blast radius is a Ship-gate concern. Record in report: `Part 3: SKIPPED — --slim mode.` Proceed to Part 4.


For each changed file, find all files that import/reference it. The search scope comes from pipeline.yaml's `shared_paths` — the directories that contain reusable code.

```bash
# Build search scope from pipeline.yaml shared_paths
# (resolves to project-appropriate directories — whatever shared_paths declares)

SEARCH_DIRS=$(yaml_get shared_paths | jq -r '[.frontend.ui_elements[].path, .backend.services[].path] | join(" ")')
FILE_EXTS=$(yaml_get shared_paths | jq -r '[.frontend.ui_elements[].extensions[], .backend.services[].extensions[]] | unique | map("--include=*." + .) | join(" ")')

grep -rl $EXCLUDES "{changed-file}" $SEARCH_DIRS $FILE_EXTS
```

Categorize: risk level (none/low/medium/high), reason, affected feature. For shared component modifications: verify no dependents are broken.

---

## Part: enrichment_fidelity (PART 3.5 — only when Orchestrator produced enrichments)

Runs in pipeline mode when Orchestrator's `resolve_enrichments (A0.6)` set a `Pattern Reference` and/or `Structured visual extraction` in the Requirement Summary. Skipped otherwise.

This Part uses the same comparison logic as standalone Review's Shared AC-Aware Review Engine (see `compare_against_reference` and `compare_against_design_image` below), applied to the full pipeline's artifacts (LLD tasks, manifest, diff).

### Step: fidelity_pattern (3.5a)

```
IF Requirement Summary has "Pattern Reference":
  Resolve reference ticket's artifacts via Procedure B.
  Read ref's $LLD_FILE + $REVIEW_FILE.
  Compare:
    - ref.task_count       vs. current LLD PART 2 task count
    - ref.reuse_ratio      vs. current PART 2 reuse ratio
    - ref.layer_distribution vs. current
    - ref.first-pass verdict (clean? P1s?) — use as baseline expectation
  Emit findings as per-task rows:
    - Task T{N} follows ref T{M} pattern: ✓ / ⚠ deviates / ❌ violates
  Aggregate deviations into Pattern Reference section of the report.
```

**MCP routing note:** If the reference ticket includes a merged-PR diff in Cross-Reference Findings (produced by Orchestrator's `resolve_enrichments (A0.6)` via `{role_resolution.vcs.mcp}`), include PR-level deltas in the comparison. If the VCS role was skipped (`--skip vcs-name` or `--offline`) OR the MCP was unreachable, fall back to ref-LLD + ref-REVIEW only and note in the report: `pattern comparison: local artifacts only (VCS MCP unavailable)`.

### Step: fidelity_visual (3.5b)

```
IF Requirement Summary has "Structured visual extraction":
  FOR each image element with a component match:
    Grep the diff for evidence that element was implemented correctly
    (matched component referenced, required states present).
    Verdict: ✅ IMPLEMENTED | 🟡 PARTIAL | ❌ MISSING | ⚠ UNCLEAR
  FOR any code change with no corresponding design element:
    Flag as "Extra code not represented in design — review intent."
  Aggregate into Visual Fidelity section of the report.
```

Both sub-steps are additive — they enrich the Review report; they don't replace or alter existing code_review / blast_radius / test_plan_validation findings.

---

## Part: test_plan_validation (PART 4 — includes spec coverage check)

**⚡ `--slim` mode: PRESENCE CHECK ONLY.** Do NOT build the AC→TC coverage matrix. Just verify:

```
FOR each T-TC task in $TESTPLAN_FILE PART 4:
  expected_spec_file = T-TC.ExpectedFile  (from task's declared file path)
  IF expected_spec_file exists on disk: mark ✓ PRESENT
  ELIF expected_spec_file in git diff but was DELETED: mark ✗ REMOVED
  ELSE: mark ✗ MISSING

Record presence results in report. Skip the AC→TC→evidence cross-reference matrix
(that's full Review's job; slim trusts Orchestrator's test plan + Surgeon's spec files).
```

Then proceed to Part 5 (which is itself skipped in slim — see below).

**Default mode continues below:**


### Step: validate_test_plan (4a)

1. Read test plan from `$TESTPLAN_FILE` PART 3
2. Validate each test case against actual code: ✅ Valid / ⚠️ Updated / ❌ Missing coverage
3. Add NEW test cases from code review + blast radius findings (TC-REV*)
4. Produce Final Test Plan. Flag untested risks.

### Step: spec_coverage_check (4b — Gap 8 — new)

**Problem:** The test plan is a document. Spec files are code. A test plan saying "TC1: verify reviewer dropdown shows" means nothing if there's no corresponding `it('should show reviewer dropdown', ...)` in a spec file. This step bridges the gap.

```
FOR each task in Change Manifest that has a corresponding spec file:

  1. FIND the spec file:
     JavaScript: {controller_name}Spec.js or {directive_name}Spec.js
     TypeScript: {component_name}.component.spec.ts
     Java: {class_name}Test.java
     Convention: read component_structure[type].required_files from pipeline.yaml

     If spec file DOESN'T EXIST:
       → P1 MAJOR: "No spec file for {file} — create {specFile}"
       (Gap 4 should have prevented this, but catch it here as backup)

  2. FOR each test case (TC) in the Final Test Plan:
     Read the AC this TC covers (TC → AC reference in test plan)
     Extract the key testable phrase from the AC's "Then" clause

     SEARCH the spec file for a test covering this scenario:
       grep -i "{key phrase from AC}" {spec_file}
       grep -i "it(" {spec_file} | grep -i "{key nouns from AC}"

     RESULT:
       ✅ Found matching it() description → spec covers this AC
       ⚠️ Partial match → spec may cover it, needs manual check
       ❌ No match → spec file exists but AC has no test

  3. FOR each ❌ (AC without spec test):
     GENERATE the missing test stub:
     ```
     it('{should phrase from AC Then clause}', function() {
       // Arrange: {setup from AC Given clause}
       // Act: {trigger from AC When clause}
       // Assert: {outcome from AC Then clause}
       pending('TC{N}: not yet implemented — add assertions here');
     });
     ```
     Add to spec file as pending test (not failing, but tracked)
     Flag as: P2 MINOR "TC{N} has no spec assertion — pending stub added"

  4. REPORT format:
     Spec coverage:
       certListSpec.js: TC1 ✅ TC2 ✅ TC3 ⚠️ TC4 ❌ (stub added) TC5 ✅
       certListSpec.java: TC6 ✅ TC7 ✅
     Coverage: 6/8 (75%) — 1 stub added, 1 needs manual review
```

**Why pending stubs (not failures):** A failing spec blocks the build. A pending stub tracks the gap without blocking, and the next developer who works in this file sees it and fills it in. This is how coverage improves incrementally without blocking delivery.

---

## Extension Point — `review_post_check` (optional)

If `subagents.review_post_check` configured, evaluate against review findings. Valid verbs: `continue` (proceed), `fail_review` (block ship), `flag_for_user` (warn but don't block). If absent, skip.

---

## Part: epic_context_update (PART 5 — MANDATORY in default mode, SKIPPED in --slim)

**⚡ `--slim` mode: SKIP this part entirely.** Slim is an iteration gate — the story isn't shipped yet, so `epic-context.md` MUST NOT be updated (a WIP story's entry would leak into subsequent stories' context). Full Review (run before Ship) is the only agent that updates epic-context.

Record in report: `Part 5: SKIPPED — --slim mode. epic-context.md untouched; run full @review.md before Ship to update it.`


**Why Review does this (not Ship):** Ship is optional — user may defer pushing, park the branch, or ship days later. But the next story may start immediately. Review always runs, so updating epic-context here guarantees the next story has context regardless of whether Ship runs.

**Extract from Change Manifest + LLD full_verification (PART 1) + review findings:**

```bash
EPIC_CONTEXT="$CONTEXT_DIR/epic-context.md"

if [ ! -f "$EPIC_CONTEXT" ]; then
  echo "⚠ epic-context.md not found — Orchestrator should have created it"
fi

# Increment stories_reviewed counter
REVIEWED=$(grep -oP '(?<=stories_reviewed: )\d+' $EPIC_CONTEXT 2>/dev/null || echo 0)
sed -i "s/stories_reviewed: $REVIEWED/stories_reviewed: $((REVIEWED + 1))/" $EPIC_CONTEXT
```

**Append the story entry:**

```markdown
### {TICKET_ID} — "{ticket title}" (reviewed {date})

**Source:** pipeline-review ({date})
{If $LLD_FILE frontmatter has `published_url` (B.3.5 ran successfully), emit on its own line:}
**Published:** {published_url} ({published_state})

**Files:**
  CREATED:
    - {path} ({purpose})
  MODIFIED:
    - {path} ({what changed})
  CONFIG:
    - {path} ({what was registered})

**Pattern:** {how it was implemented}
**Decision:** {key decision affecting future stories}
**Constraint:** {discovered limitation}
**Reusable:** {components/services future stories can reuse}
```

**The `Published:` line (~15 tokens, optional)** appears only when Orchestrator B.3.5 published the LLD as a draft to a documentation MCP. It lets future Orchestrator runs surface the remote draft URL alongside the local `$LLD_FILE` for sibling lookup. Local file remains canonical; this is purely a discoverability hint. Read directly from `$LLD_FILE` frontmatter — do NOT call the MCP from Review (Review consumes `vcs` only).

**The `Source:` line (~10 tokens)** lets future Orchestrator runs distinguish this-epic's pipeline-authored rows from auto-hydrated siblings (written by Orchestrator A.4a-bis as `Source: auto-hydrated A.4a-bis (date, bucket=X)`) and from user-referenced rows (`Source: user-reference`). It's used to render the Coverage header's sources breakdown (`6 pipeline-review · 2 auto-hydrated · 1 user-reference`).

**The CREATED/MODIFIED/CONFIG distinction is critical for the next story's Orchestrator:**
- CREATED → file EXISTS now. Future tasks = MODIFY/REUSE, not CREATE.
- MODIFIED → function was changed. Future tasks = EXTEND, not rewrite.
- CONFIG → registration done. Future tasks skip registration.

**Extract file lists from Change Manifest** (Surgeon maintains this):
- "Created:" entries → CREATED
- "Modified:" entries → MODIFIED
- Module registrations, config changes → CONFIG

**Rules:**
- Keep under 250 tokens per story entry
- List ALL created files (next story needs to know they exist)
- List MOST IMPORTANT modified files (skip trivial changes)
- Focus on: what was built, what pattern, what decision, what's reusable
- Full LLD stays local at `$CONTEXT_DIR/{TICKET_ID}.md` for deep reference

---

## Part: project_map_update (PART 5b — SKIPPED in --slim)

**⚡ `--slim` mode: SKIP.** Same reasoning as Part 5 — slim shouldn't modify durable pipeline state mid-iteration. Record: `Part 5b: SKIPPED — --slim mode.`

**Default mode continues below:**


**Problem this solves:** The project-analyzer (Step 0) scans once. After 30 stories across 3 epics, the project-map.md would be stale — new shared components, new REST endpoints, new services all created by stories but never added to the project map.

**Solution:** Review already reads the Change Manifest which lists every file CREATED/MODIFIED. Check if any of those files are in shared directories. If yes, update project-map.md.

```
Read Change Manifest → get all CREATED and MODIFIED files
Read shared_paths from pipeline.yaml → list of shared directory patterns
  (each entry has: path, provides, section_in_project_map)

FOR each file in Change Manifest:

  CHECK: Does file path match any shared_paths entry?

  Pseudocode:
    IF file matches shared_paths.frontend.ui_elements[*].path:
      → shared, add to Section referenced by that entry (e.g. "Shared UI Components")
    IF file matches shared_paths.frontend.services[*].path:
      → shared, add to "Shared Frontend Services"
    IF file matches shared_paths.backend.services[*].path:
      → shared, add to "Shared Backend Services"
    IF file matches shared_paths.backend.rest_endpoints[*].path:
      → shared, add to "REST Endpoints"
    IF file matches shared_paths.backend.templates[*].path:
      → shared, add to "Templates & Partials"
    ELSE:
      → feature-local, skip

  Concrete example (illustrative shared_paths values):
    shared_paths.frontend.ui_elements[0].path = "{frontend_path}/common/directive/"
      → file {frontend_path}/common/directive/Foo.{ext} → matches → add to Shared UI Components
    shared_paths.backend.services[0].path = "{backend_path}/service/"
      → file {backend_path}/service/FooService.{ext} → matches → add to Shared Backend Services

  A different pack would declare its own shared_paths entries (e.g. "src/components/shared/")
  and the same logic applies — match touched files against the configured paths.

IF any shared files found:
  Update $PROJECT_MAP:
    - New component created → APPEND to matching category table
    - Existing component modified → UPDATE its entry (new methods, changed API)
    - New REST endpoint → APPEND to endpoint table
    - New service → APPEND to service table
  
  Update metadata:
    last_updated: {today}
    updated_by: "Review — {TICKET_ID}"

IF no shared files in this story:
  Skip — project-map.md stays unchanged
```

**Promotion check** (same as before):
```
FOR each CREATED file in feature directories:
  Count: how many other features import this file?
  IF 3+ features → flag as PROMOTION CANDIDATE
    "⚠ {file} used by {N} features — consider moving to shared"
    → Add to project-map.md Promotion Candidates section
```

### v15 marker invalidation on shared-file modification (Gap A + I, v16)

Project-map.md carries machine-readable metadata that v15.0 introduced:
- § 6 endpoint entries with `contract_confidence:` + `contract_source:` + request/response schemas
- § 10c button intent classifications
- § 3b promotion recommendations

When Surgeon modifies a shared file, some of that metadata may become **stale or outright wrong**. Review must invalidate correctly — silently leaving stale metadata produces worse outcomes than no metadata.

**Invalidation rules per file type:**

```
FOR each MODIFIED shared file:

  CASE 1: REST resource modified (matches backend.rest_endpoints)
    Read the diff for this file:
      - Method signature changed (added/removed/renamed param)? → contract staleness
      - @Valid / @Body / Zod schema changed? → full contract re-extraction needed
      - Return type changed? → response schema stale
      - Endpoint path changed? → § 6 entry path field wrong

    IF any of the above:
      FIND the matching endpoint entry in project-map.md § 6
      → If HIGH-confidence: DOWNGRADE to MEDIUM (new request_body_schema unverified)
      → If MEDIUM/LOW: add note "Surgeon modified {file} on {date} — Phase 9 fields may be stale"
      → If NONE: no-op (no contract to invalidate)
      → Mark for rescan: append to project-map.md § "Pending Rescan" section:
        "- Endpoint: {path}. Reason: signature/schema change in {ticket}.
         Run: Rescan contracts"

  CASE 2: UI component modified (matches frontend.ui_elements)
    Read the diff for this file:
      - Template changed (HTML structure, new/removed elements)? → § 10c intents potentially stale
      - Props/Inputs changed? → § 3 component API changed
      - Label text changed (Delete → Archive, Save → Submit)? → intent classification stale

    IF label text changed:
      FIND matching button_intents rows in § 10c:
      → Mark intent = "potentially-stale"
      → Add note: "Label change in {ticket}. Previous intent: {old}.
         Re-classify via Rescan AngularJS/Components (or stack-appropriate command)."

    IF template/props changed but labels unchanged:
      → Update component API entry in § 3 only; § 10c usually still valid

  CASE 3: Shared service modified (matches frontend.services / backend.services)
    Read diff for method signatures:
      IF a method signature changed:
        → Update § 4 entry (new method or signature)
        → § 6 endpoints that internally call this method may be consumer-graph-stale:
          Add note: "Consumer graph (§ 10) may need refresh — run `Rescan consumers`"

  CASE 4: Shared template modified (matches frontend.templates)
    IF the template provides layout inheritance:
      → Update § 6-enh layout graph entry
      → Note: "Layout inheritance may have shifted — run `Rescan templates`"

  UNIVERSAL:
    Any time project-map.md is updated by project_map_update (PART 5b), increment the
    document-level modification counter:
      pending_rescans: {count}
    When counter reaches 5+, emit warning in Review's output:
      "⚠ project-map.md has {N} pending rescan hints accumulated across stories.
       Consider running the suggested rescans before they drift further."
```

**Why this matters:** without invalidation, Orchestrator's next story treats stale metadata as authoritative. Imagine Surgeon changes `POST /rest/ui/bulk` to accept `{targets: string[]}` instead of `{actionIds: string[]}`; the next ticket's Orchestrator generates an LLD task using `actionIds` because § 6 still says so. Invalidation turns a silent bug into a visible "run Rescan contracts" hint.

**Token cost:** Still near zero. Diff-reading for shared files is cheap; invalidation is additive metadata, not re-analysis.

**Token cost:** Near zero for most stories (just checking paths against shared directories). Only writes to project-map.md when a story actually creates/modifies shared resources.

**This means after 30 stories:** project-map.md has every shared component, every REST endpoint, every service that was added by any story — automatically, without needing to re-run the full project-analyzer. Plus pending-rescan hints accumulated from invalidations let teams know when metadata drift has grown past the "still trustworthy" threshold.

---

## Part: epic_e2e_plan_preview (PART 5c — MANDATORY, runs before Ship)

**Why Review does this:** Ship's Step 6b will update `epic-e2e-plan.md` automatically. But that update happens AFTER push, so any issues (wrong scenario classification, duplicate steps, unclear Expected result) are only caught later. Review previews the update so the user can fix classification now — before anything is committed to the plan.

**This part PREVIEWS but does NOT save changes.** Ship does the actual write.

### Step: resolve_and_read_plan (5c-a)

```bash
EPIC_ID=$(grep "^epic_link:" $CONTEXTS_FILE | awk '{print $2}')
E2E_PLAN="contexts/${EPIC_ID}/epic-e2e-plan.md"

IF EPIC_ID is empty:
  ⚠ No epic_link in LLD — skipping E2E plan preview
  → Skip this part, continue to Output

IF plan file does not exist:
  STATUS="new_plan_will_be_created"
  MANUAL_STEPS=0
ELSE:
  STATUS="plan_exists_will_append"
  # Count manual rows — these MUST be preserved
  MANUAL_STEPS=$(grep -cE '\|\s*\*\*custom' $E2E_PLAN || echo 0)

IF MANUAL_STEPS > 0:
  echo "ℹ Plan has $MANUAL_STEPS manually-added step(s) — these will be preserved"
```

### Step: classify_acs_to_scenarios (5c-b)

```
Read AC Registry from LLD.

For each AC:
  Classify by type:
    UI / NAVIGATION / DATA / INTERACTION (success flow) → Scenario 1 (Happy Path)
    EMPTY / NULL / DISABLED / READ-ONLY                 → Scenario 2 (Edge Cases)
    ERROR / VALIDATION / PERMISSION                     → Scenario 3 (Error Paths)
    Anything else                                        → flag for user review

  Translate to step:
    Action:   When clause → concrete browser action
    Expected: Then clause → assertion in plain language
```

### Step: detect_cross_story_flows (5c-c)

```
Read existing plan.

For each new step this story adds:
  Look for references to data/IDs/entities that prior stories create:
    e.g. this story reads notifications → prior story creates them
    e.g. this story shows cert in dashboard → prior story assigns the cert

  IF detected:
    Propose a new Cross-Story Data Integrity Check:
      "Story X creates {entity} → this story's Step N reads {entity}"
```

### Step: preview_output (5c-d)

Show the user what Ship will add:

```
═══════════════════════════════════════════════════════════════
  EPIC E2E PLAN PREVIEW — will be applied on Ship
═══════════════════════════════════════════════════════════════

Plan file: contexts/{EPIC_ID}/epic-e2e-plan.md
Status:    {new_plan | plan_exists}

Adding {TICKET_ID} as story source: pipeline (date: {today})

Scenario 1 — Happy Path (adding {N} steps):
  • Action: Navigate to cert list
    Expected: Page loads, cert rows visible
    AC: AC1 (type: NAVIGATION)
    Classification confidence: HIGH

  • Action: Open group certification
    Expected: Detail panel appears with cert info
    AC: AC2 (type: INTERACTION)
    Classification confidence: HIGH

Scenario 2 — Edge Cases (adding {M} steps):
  • Action: Open cert with no reviewers
    Expected: Empty state message "No reviewers available"
    AC: AC3 (type: EMPTY_STATE)
    Classification confidence: HIGH

Scenario 3 — Error Paths (adding {K} steps):
  • Action: User lacks CERTIFY_ANYONE right
    Expected: Reviewer selector hidden
    AC: AC5 (type: PERMISSION)
    Classification confidence: HIGH

{IF cross-story flows detected:}
New Cross-Story Integrity Check (proposed):
  • "Story PROJ-1234 opens recordId → this story submits with same recordId"

{IF any LOW-confidence classifications:}
⚠ Please review these classifications:
  • AC4-F1 (type: unclear — could be Edge Case OR Error Path)
    Action: Reviewer fetch loading state shows
    → Best guess: Scenario 2 (Edge Case)
    Options: `Move to S3` | `Keep in S2` | `Create new scenario`

Total: {N+M+K} steps added to plan. Total plan will have {T} steps across {S} stories.

> **👉** `Approve preview` — Ship will apply as shown
>          `Move AC4-F1 to S3` — override classification
>          `Skip plan update` — don't update on Ship (rare, usually spike tickets)
>          `Show existing plan` — open current plan for context
═══════════════════════════════════════════════════════════════
```

**If user approves or overrides classification:**

```
Save the preview to $REVIEW_FILE under "E2E Plan Preview" section.
Ship's Step 6b reads this preview and applies EXACTLY what was approved —
no re-derivation, no surprises.

Format in review report:
  ## E2E Plan Preview (approved — for Ship to apply)
  plan_file: contexts/{EPIC_ID}/epic-e2e-plan.md
  status: plan_exists_will_append
  steps:
    - scenario: 1
      ac: AC1
      action: "Navigate to cert list"
      expected: "Page loads"
      classification: HIGH
    - scenario: 1
      ac: AC2
      action: ...
    ...
  cross_story_checks:
    - "Story PROJ-1234 opens recordId → this story submits with same recordId"
```

**Why this design:**
- Review catches classification errors early
- User has one chance to correct scenario assignments
- Ship becomes deterministic — just apply the approved preview
- No conflict between what Review shows and what Ship commits

**If user skips plan update:**
```
Record in review report:
  ## E2E Plan Preview
  status: skipped_by_user
  reason: {user's reason or "N/A"}

Ship Step 6b will read this and skip plan update.
```

---

## Output

Save to `$REVIEW_FILE`. Update after every fix action.

### Review Report Structure

```markdown
---
ticket: {TICKET_ID}
mode: full | slim              # ← Ship reads this: refuses to ship if mode=slim
generated: {timestamp}
branch: {branch}
companion_of: {$CONTEXTS_FILE basename}
---

# Review Report — {TICKET_ID}
Generated: {timestamp} | Branch: {branch} | Mode: {full | slim}
Context: $CONTEXTS_FILE | LLD: $LLD_FILE | Test Plan: $TESTPLAN_FILE

{If mode == slim: prominent banner at the top:}
> ⚠ **SLIM REVIEW — NOT SHIP-READY.** Skipped: per-task code review, blast radius,
> AC compliance matrix, epic-context update, project-map update. Run full
> `@review.md Run the review` before Ship.

## Build
Status: {PASS / PASS WITH FIXES / FAIL} | Command: {build cmd} | Fixes: {count}

## Code Review (per task)
### T{N}: {description}
Verdict: {PASS/NOTES/FIX} | Files: {list}
Checklist: Correctness ✅ | Completeness ✅ | Conventions ✅ | Edge cases ⚠️ | Performance ✅ | Security ✅ | LLD ✅
Notes: {any}

## Blast Radius
Risk: {level} | Files scanned: {count} | Impacts: {none | list}

## Pattern Reference
{Included only if Orchestrator's resolve_enrichments (A0.6) set a reference_ticket.
 Otherwise the entire section is omitted.}

Reference ticket: **{REF_TICKET}** (pack: {ref_pack} — {same ✓ | ⚠ mismatch})

| Aspect              | Reference       | This story      | Verdict                            |
|---------------------|-----------------|-----------------|-----------------------------------|
| Task count          | {ref.tasks}    | {cur.tasks}     | ✓ aligned / ⚠ ±N / ❌ way off     |
| Reuse ratio         | {ref.reuse%}   | {cur.reuse%}    | ✓ at-or-above / ⚠ below reference |
| Layer distribution  | {ref.dist}     | {cur.dist}      | ✓ same / ⚠ differs                |
| First-pass cleanness | {ref.verdict} | (this review)   | {context}                          |

### Pattern deviations (per-task)
- T1 follows ref T2 pattern ✓
- T3 ⚠ deviates: reference reused sp-button, this story creates a custom one
- ...

## Visual Fidelity
{Included only if resolve_enrichments (A0.6) populated Structured visual extraction.
 Otherwise the entire section is omitted.}

Images analyzed in Orchestrator: {N} ({sources})

| Element                 | In design | In diff | Verdict                                 |
|-------------------------|-----------|---------|----------------------------------------|
| Reset button (secondary)| ✅        | ✅      | OK — matches design                    |
| Loading spinner         | ✅        | ❌      | MISSING — design shows it              |
| Error toast (red)       | ❌        | ✅      | Extra — in code, not shown in design   |
| Disabled state          | ✅        | 🟡     | PARTIAL — binding missing              |

### Extra code changes not visible in design
- {file}:L{N} — {description} (not in design; intentional?)

### Design elements missing from code
- {element} (image-{N}) — not implemented
- {element} (image-{M}) — not implemented

## Test Plan Validation
Validated: {N} | Updated: {N} | Added: {N} | Missing: {N}

## LLD Compliance
Overall: {percentage}%

## Issues Tracker
### KNOWN (from surgeon)
| ID | Type | Description | Task | Status | Action |
### NEW (from review)
| ID | Severity | Description | Task | Status | Action |

## Summary
Total: {count} | Blocking: {P0/P1 open}/{total} | Fixed: {count} | Accepted: {count}
Ship-ready: {YES / NO — reason}

### Fix action log
| # | Action | Status | Notes |
```

---


---

## Standalone Mode Flows — externalized

Standalone-mode flows (Diff / Ticket / AC-Driven sub-modes + shared engine + shared output shape) live in `modes/standalone-review-flow.md` — loaded **only** when `detect_invocation_mode (0)` sets `{mode} == "standalone"`. Pipeline-mode runs (single-story, bug, bundle) do NOT load this file.

When `{mode}` resolves to standalone at pre-flight:

```
LOAD AND FOLLOW: modes/standalone-review-flow.md
The agent's {sub_mode} (diff | ticket | ac-driven) selects the right sub-flow
within that file. Do NOT continue with the rest of this file.
```

---

## Gate

### `--slim` mode gate

If the run was invoked with `--slim`, render the SLIM gate (not the default one below):

```
## [Step 4/5] Review (SLIM) — DONE

**Report:** `$REVIEW_FILE` (slim — not ship-ready)
- Build:          {PASS | FAIL}
- Tests:          {PASS | FAIL — {N} failing across {layers}}
- Task presence:  {N} / {M} LLD tasks have file changes in diff
- Test presence:  {N} / {M} T-TC tasks have their expected spec file
- Mode:           --slim (skipped: per-task review, blast radius, AC matrix, epic-context update)

{If failures: list with task IDs, file paths, and one-line reason each}
Failing tasks: {T3, T5, T7}

> **👉 Pick one:**
> - `Fix manually`       — you handle the fix outside the pipeline. After fixing, either re-run
>                          `@review.md Run the review --slim` for another spot check, or go straight
>                          to `@review.md Run the review` (full) when ready to ship.
> - `Run full review`    — escalate to default mode: `@review.md Run the review` (~$0.50).
>                          Use when you want Review to do the deeper per-task analysis OR when
>                          you're ready to ship (full is required before Ship anyway).
> - `Accept as-is`       — write current (possibly FAIL) report, exit. Useful for WIP commits
>                          where you want to pause and think.
> - `Cancel`             — exit without writing report.
```

### Why no auto-retry loop via Surgeon

Slim is a **one-shot integration check**. There's deliberately NO `Fix all → Surgeon → slim re-run` chain. Rationale:

- An automatic slim→Surgeon→slim loop can mask **structural problems** — wrong LLD task, wrong file paths in task.Files, Surgeon systematically misunderstanding an AC. The loop would retry mechanical fixes forever without surfacing the real issue.
- Forcing the user to decide on FAIL — `Fix manually` vs `Run full review` — surfaces those issues immediately. If slim keeps failing after manual fixes, that's a signal to escalate to full Review for deeper analysis.
- If you genuinely want Surgeon to re-run a task subset, you can still invoke it directly: `@surgeon.md Fix tasks: T3, T5, T7`. Surgeon's targeted-fix mode is available — just not auto-triggered from slim.

### Slim gate NEVER shows `Ship it`

Slim is not ship-ready — the user must run full Review (default mode) before Ship. Ship agent refuses to proceed against a slim-only review report (detects `mode: slim` in the report frontmatter and halts).

---

### Default mode gate

```
## [Step 4/5] Review - DONE

**Report:** `$REVIEW_FILE`
- Build: {status}
- JS tests: {P} pass / {F} fail (mine: {N}, collateral: {M})
- TS tests: {P} pass / {F} fail | N/A
- Java tests: {P} pass / {F} fail (mine: {N}, collateral: {M})
- Code review: {X}/{N} PASS, {Y} with notes
- Blast radius: {level}
- Test plan: {X} validated, {Y} updated, {Z} added
- LLD compliance: {pct}%
- Issues: {P0} blocker, {P1} major, {P2} minor, {P3} nit
- E2E plan preview: {approved | skipped | N/A — no epic link} — {N} steps to add on Ship
- Ship-ready: {YES / NO}

{If issues, list them with ID + description + status}

> **👉 Pick one:**
> - `Ship it` — commit, push, create PR (applies E2E plan preview)
> - `Fix P1-1` — fix specific issue
> - `Fix all P1` — fix all P1 issues
> - `Fix all` — fix all issues (priority order)
> - `Skip P2-1` — accept non-blocking issue
> - `Proceed with errors` — ship with known issues
> - `Demo` — optionally run browser verification before shipping
> - `Edit E2E preview` — change scenario classification before Ship
> - `Show review details` / `Show test plan` / `Show blast radius`
> - `Reject` — needs rework
```

### Issue Resolution Loop

**After ANY action** (fix, skip, show, proceed):
1. Attempt action
2. For fixes: show BEFORE/AFTER diff, re-run affected verification
3. Update `$REVIEW_FILE` — issue status, action taken
4. Show updated issue count
5. **ALWAYS end with `> **👉**` block** showing:
   - If all P0/P1 resolved → `> **👉 Next:** Ship it`
   - If issues remain → updated pick-one options
   - After show commands → re-display current options

---

## Rules

- Full clean build (not per-task build) — this is the final verification gate
- **FILE-READ BUDGET (MANDATORY):** before reading any modified file >300 lines for per-task code review, **grep first** for the specific method/class/block referenced in the Change Manifest or task diff. Then targeted-read only the changed range + ±30 lines of context. Default cap: 100 lines per read. A full-file read (or any read >200 lines) MUST be justified in the Review report: `Full-read: {path} ({lines}L) — reason: {why narrow-read didn't suffice}`. Same rule as Surgeon — Review's per-task diff-and-context reads are the second biggest accumulator after Surgeon's file-before-write reads.
- **OUTPUT TRUNCATION:** every build / test / lint output shown in the Review report is middle-truncated to 20 lines max (first 10 + `... K lines omitted ...` + last 10) when the raw output exceeds that. A 500-line stack trace retained in context is wasted tokens; the diagnostic value is in the first and last ~10 lines.
- **PART 1 ON-DEMAND:** default mode does NOT pre-load `$LLD_FILE` PART 1 (Design rationale). Load it lazily only when a specific cross-task review question requires it (e.g., "does T3's approach match the architecture choice in § 5?"). Typical review doesn't need it — PART 2 Section 23b holds the per-task details, and the Change Manifest holds what Surgeon did. Saves 5–10K per story; slim mode already does this.
- Review every task against its LLD section
- P0 auto-fixes show BEFORE/AFTER diff
- Blast radius + test plan validation are MANDATORY
- Edge case Q1-Q5 are MANDATORY for frontend tasks — each unhandled = P1
- Don't fix pre-existing errors
- All findings tied to specific task IDs
- Never approve unresolved P0/P1 without user consent
- Token measurement is MANDATORY — measure all pipeline files, fill every cell
- **MANDATORY: Update `$EPIC_CONTEXT` with story entry** — CREATED/MODIFIED/CONFIG files, pattern, decision, constraint, reusable. Feeds next story even if Ship deferred.
- **MANDATORY: Update `$PROJECT_MAP` if story created/modified files in shared directories**
- **MANDATORY (if jira.status_map.review_done set): Transition JIRA ticket to "{status_map.review_done}"**
  ```
  POST /rest/api/3/issue/{TICKET_ID}/transitions
  { "transition": { "id": "{jira.status_map.review_done transition ID}" } }
  ```
  Use `jira.on_failure` to handle errors. Do NOT block the review gate on JIRA failure.
- **MANDATORY: Every response ends with `> **👉**` block. No exceptions.**
- After every fix: update review report, show updated issue count
- Support `Fix all` and `Fix all P{severity}` — process in priority order
- Bundle mode is handled by the dedicated `bundle-review.md` agent (which loads `modes/bundle-review-flow.md`). This file refuses to handle bundle context — see `bundle_context_guard (0c)`. Single-story / bug is the only scope of this file.
- **Context pressure** (per `agent-flow.mdc § Context Pressure Detection`): read `{context_pressure}` config at pre-flight; maintain running counter; at every gate (per-task checkpoint, end-of-stage), check pressure zone and render YELLOW/ORANGE/RED variant. ORANGE/RED resume: `Run the review`. Review halts cleanly on RED (no destructive ops) — partial review file flushed atomically before halt.
- **Tool Usage Ledger (MANDATORY):** Before rendering the final `[Step N/5] {agent} — DONE` gate, append your run's block to `$TOOL_USAGE_FILE` per `agent-flow.mdc § Tool Usage Tracking`. Block schema, counting rules, and aggregation are defined there — do NOT duplicate the schema in this file. Applies to all run modes (story / bug / bundle / standalone). Skipped block triggers a post-execution-verification warning.
