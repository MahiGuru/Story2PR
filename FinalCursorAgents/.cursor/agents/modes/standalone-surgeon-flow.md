---
name: standalone-surgeon-flow
description: Surgeon's standalone-mode flows (Standalone Apply / Targeted-Fix / Standalone AC-Driven). Loaded ONLY when surgeon.md detect_invocation_mode (0) sets {mode} == "standalone" or {mode} == "targeted-fix". Pipeline (single-story / bug / bundle) runs never read this file — saves ~19K tokens of cached prefix per pipeline tool-call turn.
---

# Surgeon — Standalone Mode Flows

**Load ONLY when `detect_invocation_mode (0)` in `surgeon.md` sets `{mode}` to one of:**
- `"standalone"` (Apply: / Implement: triggers)
- `"targeted-fix"` (Resume from task / fix-only triggers)
- `"standalone"` with `{sub_mode} == "ac-driven"`

**Pipeline mode (single-story, bug, bundle) NEVER reads this file** — these flows are surgically extracted from `surgeon.md` to keep the cached prefix small on the high-volume pipeline path.

This file contains three sub-flows in order:
1. Standalone Invocation Flow (`Apply:` / `Implement:` standalone triggers)
2. Targeted-Fix Flow (`Resume from task` / scoped re-implement)
3. AC-Driven Flow (`Implement:` with bullet-list ACs, no ticket)

By the time control reaches this file, the calling agent has already resolved `{mode}` and (for AC-Driven) `{sub_mode}`. Each sub-flow's pre-flight handles its own input validation.

---

## Standalone Invocation Flow (runs ONLY when `{mode} == "standalone"`)

*This entire section is skipped in pipeline mode. Pipeline mode continues with the per-task loop above.*

### Step: check_standalone_inputs (standalone mode pre-flight)

Parse the trigger text into a structured spec:

```
FROM "Apply: <spec>" or "Implement: <spec>":
  {spec} = the change description

FROM optional "in <files>" or "Files: <list>":
  {files} = explicit file list

FROM optional "using exploration at <path>":
  {exploration_hint} = path to a standalone-exploration-*.md file
                       (Surgeon reads it as supplementary context)

FROM optional " — reference: <TICKET_ID>":
  {reference_ticket} = the ticket ID to use as a pattern template
                       → triggers resolve_reference (see AC-driven flow,
                         same step runs for Apply sub-mode too)

FROM optional image attachment(s):
  {reference_images} = up to 3 attached images
                       → triggers analyze_image (same step as AC-driven flow)

VALIDATE:
  IF {spec} is empty or < 5 words:
    HALT ⛔
    "Standalone Surgeon needs a real spec. Try:
       @surgeon.md Apply: add null check to handleSubmit in featureCtrl.js"
```

### Step: enforce_standalone_safety_caps (HARD LIMITS)

Standalone mode is for small, targeted changes. Larger work MUST go through the pipeline.

```
IF {files} explicitly given:
  file_count = count({files})
  IF file_count > 5:
    HALT ⛔
    "Standalone Surgeon is capped at 5 files (you specified {file_count}).
     This change is too large for ad-hoc mode.
     Run the pipeline instead:
       @orchestrator.md Work on <TICKET_ID>"

IF {files} NOT given — Surgeon infers files after Step 0a reuse check.
  After inferring:
    IF inferred file count > 5: HALT with same message.

LINE BUDGET (checked AFTER Surgeon drafts the change):
  IF total lines added+modified across all files > 150:
    HALT ⛔
    "Standalone change exceeds 150-line limit (drafted {N} lines).
     This isn't ad-hoc anymore. Run the pipeline for proper planning + review."
```

### Step: load_config (standalone — same as pipeline but skip LLD-specific)

Read these files (treat as one merged config):
- `contexts/config/pipeline.yaml` — core (subagents, runtime)
- `contexts/config/pipeline.{PACK}.skills.yaml` — `skills.layer_map`, `skills.extra_triggers`
- `contexts/config/pipeline.{PACK}.builds.yaml` — `builds.commands`, `builds.lint`
- `contexts/config/pipeline.{PACK}.analyzer.yaml` — `scan_exclusions` (for reuse-check greps)

Use:
- `skills.layer_map` — for Tier 2 skill resolution per file
- `skills.extra_triggers` — orthogonal triggers still apply
- `builds.commands`, `builds.lint` — per-layer build check
- `scan_exclusions` — for reuse-check greps
- SKIP: `subagents.surgeon_pre_task/post_task` (too heavyweight for ad-hoc)
- SKIP: `component_structure` checks (no ticket-level task decomposition)

### Step: standalone_implement

```
1. REUSE CHECK (Step 0a still runs — prevents duplication):
   - Classify {spec} via the same taxonomy used in pipeline mode
   - Grep shared_paths for existing components matching the spec
   - If match found → HALT with reuse suggestion, let user pick:
     `Reuse {component}` | `Force CREATE anyway` | `Cancel`

2. RESOLVE LAYERS (from {files} or inferred):
   - For each file, look up skills.layer_map[layer].skills
   - Load Tier 2 skills for each resolved layer
   - Evaluate skills.extra_triggers (accessibility, tests, etc.)

3. APPLY THE CHANGE:
   - Minimal edits anchored to existing code
   - NO new architectural patterns without user OK
   - Follow loaded Tier 2 skills rigorously

4. POST-VERIFY (per layer that was touched):
   - Run lint for each touched layer (builds.lint.*) — wrapped via builds.runner
   - Run pack post-verify rules matching each layer
   - Run ONE final build at the end (builds.review_gate) — wrapped via builds.runner
   - If the final build fails, HALT and report error — do NOT continue
   - (Per-task builds are intentionally skipped to keep tool-result tokens small —
     same rule as pipeline-mode Surgeon. Standalone is already narrow-scope.)

5. WRITE MINIMAL MANIFEST to $CONTEXT_DIR/standalone/standalone-manifest-{timestamp}.md:
```

**Minimal manifest format (standalone):**

```markdown
---
mode: standalone
trigger: "{verbatim trigger text}"
created: {ISO-8601}
files_changed: {N}
lines_changed: {M}
---

# Standalone Surgery — {one-line summary}

## Spec
{verbatim spec from trigger}

## Files Changed
| File | Layer | Lines | Action |
|------|-------|-------|--------|
| {path} | {resolved layer} | +{add} -{del} | MODIFY |

## Skills Applied
- {pack}-{layer}-standards.md
- {pack}-{layer}-postverify.mdc

## Build Status
- {layer}: PASS | FAIL ({error if any})

## Reuse Check Result
- {matched | no match found — proceeded with CREATE}

## Hand-off Notes
_This was a standalone ad-hoc change. No LLD, no review, no PR.
Commit manually or run @review.md Review changes for a compact review.
For larger work, use the pipeline: @orchestrator.md Work on <TICKET>._
```

### Gate (standalone mode)

```
## Surgeon (Standalone) - DONE

**Mode:** standalone
**Files changed:** {N}
**Lines changed:** {M}
**Build:** {PASS | FAIL}
**Manifest:** $CONTEXT_DIR/standalone/standalone-manifest-{timestamp}.md

> **👉 Pick one:**
> - `Review changes` — run standalone Review on the uncommitted diff
> - `Commit` — guidance on `git add && git commit` (Surgeon does NOT auto-commit)
> - `Revert` — `git checkout .` to undo
> - `Done` — stop here, handle manually
```

**Rules for standalone mode:**
- NEVER reads or writes $LLD_FILE / $TESTPLAN_FILE (pipeline-only).
- NEVER runs the resume-drift check (no manifest version to compare against).
- NEVER updates $EPIC_CONTEXT or $CODEBASE_MAP.
- NEVER auto-commits — user's manual responsibility.
- ALWAYS runs reuse check (Step 0a) to prevent duplication.
- ALWAYS enforces file + line caps; refuses gracefully over limit.

---

## Targeted-Fix Flow (runs ONLY when `{mode} == "targeted-fix"`)

Invoked by slim Review's `Fix all` / `Fix task <T-ID>` gate. Re-runs a subset of tasks that failed in a previous full Surgeon run. Fast path — reuses all prior planning.

### Triggers

```
@surgeon.md Fix tasks: T3, T5, T7     (multiple tasks, comma-separated)
@surgeon.md Fix task T5                (single task)
```

Parse: `{target_tasks} = [T3, T5, T7]`.

### Step: check_targeted_fix_prerequisites

```
1. $CONTEXTS_FILE must exist (Orchestrator Phase A ran previously)
   IF missing: HALT — "Targeted fix requires a completed Orchestrator run."

2. $LLD_FILE must exist with PART 2 Tasks
   IF missing: HALT — "Targeted fix requires an existing LLD."

3. $EXPLORATION_FILE must exist (Explorer ran previously)
   IF missing: HALT — "Targeted fix requires prior Explorer run. Run @explorer.md Run the explorer first."

4. $MANIFEST_FILE must exist with at least one prior task result
   IF missing: HALT — "No prior Surgeon run detected. Use 'Run the surgeon' for full pipeline mode."

5. Verify every target task ID exists in $LLD_FILE PART 2
   FOR each T-ID in {target_tasks}:
     IF not found in PART 2: HALT — "Task {T-ID} not in LLD. Valid IDs: {list}"

6. Verify branch matches $LLD_FILE metadata base_branch + ticket slug
   IF mismatch: HALT (same as pipeline mode)
```

### Step: load_context (targeted — minimal)

Load ONLY what's needed to re-execute the target tasks:

- `pipeline.<pack>.yaml` core + `pipeline.<pack>.skills.yaml` + `pipeline.<pack>.builds.yaml` (same as pipeline mode)
- `$LLD_FILE` PART 2 — filter to the target tasks only (~1-2K of PART 2 content per task)
- `$EXPLORATION_FILE` — filter to annotations for target tasks only (~1-2K)
- `$MANIFEST_FILE` — read fully to know what already passed (skip those), ~3-5K
- Skip: `$CONTEXTS_FILE` full body (~5K), LLD PART 1 (design rationale ~7K), `$TESTPLAN_FILE` PART 3 (test plan narrative)

Targeted-fix input budget: ~35-50K (vs ~95K for full Surgeon run).

### Step: render_active_context (targeted)

```
┌─ Active Context — Surgeon (TARGETED FIX) ──────────────────────┐
│ Ticket:    {TICKET_ID}                                         │
│ Mode:      targeted-fix — re-running {N} tasks                 │
│ Tasks:     {T3, T5, T7}                                        │
│ Skipped:   {list of already-passed tasks from manifest}        │
│ Layer skills: loaded per-task as needed (same as pipeline)     │
└────────────────────────────────────────────────────────────────┘
```

### Step: execute_target_tasks

Run the task loop for target tasks ONLY, in dependency order (respecting the original LLD ordering):

```
FOR T-ID in {target_tasks}, in LLD dependency order:
  1. Load layer skills for this task (per task.Layer)
  2. Read the task description + Files + Verify By from $LLD_FILE PART 2
  3. Read Explorer's annotation for this task from $EXPLORATION_FILE
  4. Re-run the per-task loop:
     a. Pre-write read (Step 0c)
     b. Reuse verification (Step 0a)
     c. Implement the task
     d. Per-task build check
     e. Verify By check
     f. Edge-case Q1-Q5 decisions
  5. Update $MANIFEST_FILE:
     - REPLACE the prior entry for this task
     - Preserve ALL entries for non-target tasks (don't overwrite)
  6. On failure, use standard Surgeon error-handling (fix-and-re-run, or halt with error gate)
```

### Step: final_verification (targeted)

Run the same final verification as pipeline mode: clean build + lint + target-layer tests. Ensures target-task changes don't break the overall project.

### Step: gate (targeted)

```
## [Step 3/5] Surgeon (TARGETED FIX) — DONE

Re-ran {N} tasks: {T3, T5, T7}
- T3: {PASS | FAIL}
- T5: {PASS | FAIL}
- T7: {PASS | FAIL}

Final build: {PASS | FAIL}
Preserved: {M} non-target tasks in manifest (untouched).

{If any task still failing: show per-task error summary}

> **👉 Pick one:**
> - `Run the review`          ← RECOMMENDED
>                              Full ship-readiness gate (~$0.56, ~110-140K input). Runs build + tests +
>                              per-task code review + AC compliance matrix + blast radius + pattern +
>                              visual + epic-context + project-map updates. REQUIRED before Ship.
>                              Default next step after a targeted fix — confirms the fix didn't break
>                              anything deeper AND prepares ship-ready verdict.
>
> - `Run the review --slim`   (OPT-IN — pick this deliberately)
>                              Fast spot-check only (~$0.26, ~55-70K input). Runs build + tests + task/
>                              test presence. Skips per-task review, AC matrix, blast radius, etc.
>                              NOT ship-ready; one-shot. Use only if you expect more Surgeon cycles
>                              before ship and want the cheaper integration signal.
>
> - `Show T5 details`         — inspect what Surgeon did for a specific task
> - `Fix T5 again`            — re-run this one task (if Surgeon still couldn't fix it)
> - `Cancel`
```

**Default next step: `Run the review` (full).** After a targeted fix, the ship gate is usually the next logical step — the fix either resolved the issue (full PASSes) or revealed something deeper (full's per-task review + AC matrix find it). Slim and full are both **one-shot manual invocations** — no auto-loop between Surgeon and slim Review.

### Rules — Targeted-Fix Mode

- NEVER re-plan (skip Orchestrator's task decomposition)
- NEVER re-explore (skip Explorer's codebase scan)
- NEVER overwrite non-target tasks' manifest entries
- NEVER update $EPIC_CONTEXT (that's full Review's job at the end)
- ALWAYS preserve prior manifest entries for non-target tasks
- ALWAYS run final clean build (don't ship partial fixes uncompiled)
- ALWAYS end the gate suggesting `Run slim review` for loop continuation
- If a target task's ID isn't in the LLD, HALT — don't silently skip

---

## AC-Driven Flow (runs ONLY when `{mode} == "standalone"` AND `{sub_mode} == "ac-driven"`)

*This section replaces the plain Standalone Flow for AC-driven invocations. User pastes ACs; Surgeon parses, classifies, locates files, proposes a plan, gates for approval, then executes — all inline, without Orchestrator or Explorer.*

### Step: parse_acs

```
Parse the trigger body into a list of structured ACs:

  Recognized shapes:
    1. "AC{N}: <text>"         → {id: AC1, text: "..."}
    2. "- <text>"              → auto-number AC1, AC2, ...
    3. "1. <text>" (numbered)  → use the number as AC id
    4. "Given <...>, when <...>, then <...>"
                               → parse as AC with structured given/when/then

  Output: {acs} = [{id, text, given?, when?, then?}, ...]

VALIDATE:
  IF {acs}.length == 0:
    HALT ⛔
    "Couldn't find any ACs in the trigger. Expected a bullet list, e.g.:
       @surgeon.md Implement:
         - AC1: User can click Reset on the filter panel
         - AC2: Reset clears state and re-fetches the list"

  IF {acs}.length > 5:
    HALT ⛔
    "AC-driven mode is capped at 5 ACs (you provided {N}).
     More than 5 ACs means this is a story, not an ad-hoc change.
     Use the pipeline instead:
       @orchestrator.md Work on <TICKET_ID>
     (paste the same ACs into the JIRA ticket — Orchestrator will synthesize
      a full LLD with task decomposition, test plan, and review gates)."
```

### Step: load_config_ac_driven

Read pipeline config files (`pipeline.yaml` + `pipeline.{PACK}.skills.yaml` + `pipeline.{PACK}.builds.yaml` + `pipeline.{PACK}.analyzer.yaml`) — same sections standalone Apply uses PLUS the AC-classification skill:

```
Load once:
  - skills.layer_map                            (file → layer)
  - skills.extra_triggers                       (orthogonal skill triggers)
  - skills.orchestrator.ac_templates_intent_aware  (AC intent → required templates)
  - shared_paths.frontend.*                     (UI element + service lookup)
  - shared_paths.backend.*                      (service + REST + persistence lookup)
  - operation_patterns                          (fetch/create/update/delete templates)
  - component_naming.prefix                     (filter to pack-prefixed components)
  - scan_exclusions                             (reuse-check grep exclusions)
  - builds.commands                             (per-layer build for post-verify)
  - builds.forbidden                            (never run these)

READ the AC templates skill file (e.g. {pack}-ac-templates-intent-aware.md)
— this is what Orchestrator uses for AC enrichment. Surgeon uses it here to
classify each AC's intent consistently with how Orchestrator would.
```

### Step: resolve_reference (only if {reference_ticket} was set)

```
IF {reference_ticket} is unset: SKIP this step.

1. Run agent-flow.mdc § Procedure B on the reference ticket to resolve paths:
     {ref_contexts}  = contexts/<epic>/<REF_TICKET>.md           (or flat layout)
     {ref_lld}       = contexts/<epic>/<REF_TICKET>-lld.md
     {ref_testplan}  = contexts/<epic>/<REF_TICKET>-testplan.md
     {ref_review}    = contexts/<epic>/<REF_TICKET>-review.md    (optional)

2. IF {ref_contexts} not found:
     WARN (do not halt):
     "⚠ Reference ticket {REF_TICKET} has no context file.
        Proceeding without reference enrichment."
     Unset {reference_ticket} and continue.

3. Check pack compatibility:
     - Read ref_contexts front-matter `pack:` if present
     - Compare to the current project's pack name
     - IF mismatch: WARN
       "⚠ Reference {REF_TICKET} is from pack '{ref_pack}', current pack is
        '{cur_pack}'. Pattern may not transfer cleanly. Review carefully."

4. Read reference artifacts and extract {reference_pattern}:
     - Task count + shape (single-file / multi-file; UI-only / full-stack;
       backend-only)
     - Layer distribution (count per Frontend/*, Backend/*, Test)
     - File set touched — list unique paths
     - Reuse ratio (count of ♻️ REUSE tasks / total tasks)
     - Skills loaded per task (primary + extra_triggers from manifest if any)
     - Amendment Log entries (if ref_lld has an Amendment Log section)
     - Review verdict summary (if ref_review exists):
         was it "ship-ready: YES" on first pass? any P1 issues?

5. Store {reference_pattern} for use by classify_and_locate and plan_gate.
```

### Step: analyze_image (only if {reference_images} is non-empty)

```
IF {reference_images} is empty: SKIP this step.

1. For each image (up to 3) in {reference_images}:

   The LLM analyzes the image natively. Extract a structured description:
     - UI elements visible:
         [{type: button, label: "Reset", variant: secondary, state: default},
          {type: select, label: "Role", options_visible: 3, state: default},
          {type: form, fields: 4, required_markers: [1, 3]},
          {type: modal, title: "Confirm delete", buttons: ["Cancel","Delete"]},
          ...]
     - Layout: header / sidebar / content / footer / modal overlay / toast
     - States shown (infer from styling):
         default / hover / active / disabled / error / empty / loading / success
     - Visible text/labels (OCR-style): list of strings
     - Visual hierarchy (what's primary/secondary/tertiary visually)

2. For each identified UI element:
     Match against shared_paths.frontend.ui_elements[*].provides[]:
       - "button" → find entry where provides contains "button"
                    → existing component name from config
       - "multi-select" → ui_elements entry with provides: [...,"multi-select"]
       - "modal" → ui_elements entry with provides: [...,"modal"]
     If matched: record {element, matched_component, source: "shared_paths"}
     If NO match: flag as "novel element — may require new component OR
                          promote an existing feature-local one"

3. Cross-reference images with {acs} (if AC-driven):
     FOR each AC:
       FOR each element in the image set:
         IF the element's label/purpose matches the AC's language:
           Record "AC{N} confirmed by visual in image {which}"
     FOR each element in images NOT covered by any AC:
       Record "Visual element in image not represented in ACs: {element}"
     FOR each AC NOT confirmed by any image element:
       Record "AC{N} not visually represented — may be backend-only or
               missing from the design"

4. Store {visual_plan} = {elements, component_matches, novel_elements,
                         ac_visual_coverage} for use by classify_and_locate
   and plan_gate.

Size limit: if the cumulative element count across all images exceeds
~30 elements, WARN: "Image set is very dense. Agent may miss details.
Consider splitting into focused sub-screens."
```

### Step: classify_and_locate (inline mini-Explorer)

```
FOR each AC in {acs}:

  1. CLASSIFY intent (using the loaded ac_templates skill):
     - destructive-confirm | destructive-immediate
     - submit | navigation | async-action
     - toggle | bulk-action | unknown

  2. DETECT primary concern:
     - UI element type?     (button / select / modal / grid / form / list / picker)
     - Data operation?      (fetch-list / fetch-detail / create / update / delete / bulk)
     - Permission gate?     (authz check / role-based)
     - Validation / state?  (form rules / state transitions)

  2b. ENRICH with {visual_plan} (if image(s) provided):
      - If the AC's UI-element type matches an element found in an image,
        lift the element's matched_component from {visual_plan} as a strong
        reuse hint (overrides a generic grep search).
      - If an image showed states (error/loading/disabled), feed those into
        the AC's required-coverage list so classify_and_locate does not miss
        an implied-but-not-written AC (e.g. "Reset disabled when empty"
        may be visible in design but absent from ACs — flag it).

  2c. ENRICH with {reference_pattern} (if reference ticket provided):
      - Compare the AC's inferred layer distribution to the reference's.
        If reference used (1 FE + 1 BE) for a similar AC, prefer the same
        layer split here.
      - Prefer REUSE candidates that the reference also reused (cross-check
        against reference_pattern.file_set).

  3. LOOKUP in pipeline.yaml:
     - UI: match shared_paths.frontend.ui_elements[*].provides against AC's UI element
     - Data: consult operation_patterns for the matched op
     - Layer: use skills.layer_map to know the target file extension + path_glob

  4. GREP the matched paths:
     grep -rln $EXCLUDES "{component-hint|entity-hint}" \
              $(yaml_get <matched path_glob from layer_map>) \
              --include="*.{ext_for_layer}"

  5. For each file match, decide: MODIFY existing or CREATE new?
     (Default: MODIFY if match found at ≥1 existing consumer; CREATE only if no match.)
     (If {reference_pattern} exists, bias toward MODIFY when reference also
      modified a similar file — this preserves reuse ratio.)

  6. Record the outcome per AC:
     {
       ac_id,
       intent,
       layer,
       files: [{path, action: MODIFY|CREATE, insertion_hint}],
       skills_to_load: [...],   # Tier 2 skills for each file's layer
       reuse_candidate: <component path if found>,
       visual_match: <element from image(s), if AC was visually confirmed>,
       reference_hint: <"follows PROJ-100 T2 pattern" if reference was used>
     }

  IF any AC is UNCLASSIFIABLE (grep returned 0 matches AND intent is unclear):
    HALT ⛔
    "AC{N}: '{text}' — couldn't determine:
       - Intent:  {inferred or 'unknown'}
       - Layer:   {inferred or 'unclear'}
       - Files:   {count} candidates (too many OR zero)
     Pick one:
       `Hint: <your guidance>`   — give Surgeon more context and re-try
       `Skip AC{N}`              — drop this AC, proceed with rest (if ≥1 still covered)
       `Promote to pipeline`     — this AC needs proper analysis; use:
                                     @orchestrator.md Work on <TICKET_ID>
       `Cancel`"
```

### Step: build_inline_plan

```
Aggregate the per-AC classifications into a task list:

  Tasks:
    T1 → covers AC{a}, AC{b} (may merge if same file)
    T2 → covers AC{c}
    ...

  Merge rule: ACs touching the same file with compatible actions collapse into
  one task. Keep AC-to-task traceability in the output.

  Count:
    total_files = unique files across all tasks
    estimated_lines = sum of per-task line estimates (coarse, based on action type)

  ENFORCE CAPS:
    IF total_files > 5:
      HALT ⛔ "{N} files exceed the 5-file cap for standalone. Use pipeline."
    IF estimated_lines > 150:
      HALT ⛔ "~{N} lines exceeds the 150-line cap. Use pipeline."
```

### Step: plan_gate (MANDATORY — user must approve)

Render the plan and WAIT for user input. AC-driven inference can be wrong; the gate is not skippable.

```
┌─ AC-Driven Plan ───────────────────────────────────────────────┐
│ Mode:       standalone — ac-driven                             │
│ ACs parsed: {N}                                                │
│ References: {reference_ticket if any} · {M} image(s) attached  │
│                                                                │
│ {IF reference_ticket:}                                         │
│ Pattern reference ({REF_TICKET}):                              │
│   - Task count: {ref.tasks}  ·  Reuse ratio: {ref.reuse_ratio} │
│   - Layer split: {ref.layer_dist}                              │
│   - Ship-ready on first review? {yes|no+reason}                │
│                                                                │
│ {IF reference_images:}                                         │
│ Visual analysis:                                               │
│   - Elements identified: {count} across {M} images             │
│   - Component matches (from shared_paths):                     │
│     · "Reset button" → {pack}-button (variant: secondary)      │
│     · "Role select"  → {pack}-multi-select                     │
│   - Novel elements (no shared match): {list or "none"}         │
│   - States in design: {default/hover/error/empty/loading list} │
│   - ACs visually confirmed: {ac ids}                           │
│   - ⚠ In design but not in ACs: {list — user should review}    │
│                                                                │
│ Proposed tasks:                                                │
│                                                                │
│ T1 (AC{a}, AC{b}): {one-line summary}                          │
│   Layer:        {resolved layer}                               │
│   Files:        {file paths, max 2 shown + "+M more"}          │
│   Skills:       {Tier 2 skills that will load}                 │
│   Action:       {MODIFY line N | CREATE new file | EXTEND at N}│
│   Reuse:        {component path used, or "no reuse — new code"}│
│   Visual:       {image-N element this task implements, if any} │
│   Reference:    {"follows {REF_TICKET} T2 pattern" if any}     │
│                                                                │
│ T2 (AC{c}): ...                                                │
│ ...                                                            │
│                                                                │
│ Budget:     {F} files, ~{L} lines  (caps: ≤5 files, ≤150 lines)│
│ Skipped:    {ACs skipped, if any}                              │
│ Warnings:   {pack mismatch, truncated images, etc.}            │
└────────────────────────────────────────────────────────────────┘

> **👉 Pick one:**
> - `Go`                        — execute the plan as shown
> - `Revise: <what's wrong>`    — re-plan with your correction (re-runs classify_and_locate)
> - `Promote to pipeline`       — this is bigger than expected; use:
>                                    @orchestrator.md Work on <TICKET_ID>
> - `Cancel`
```

Surgeon MUST stop here. Do not proceed to execution until user explicitly says `Go`.

### Step: execute_ac_driven

On `Go`, execute each task with the same rigor as pipeline Surgeon:

```
FOR each task T{N}:
  1. Load Tier 2 skills for the resolved layer(s)
  2. Evaluate extra_triggers (a11y, test, etc.) against the AC + files
  3. RE-RUN REUSE CHECK (Step 0a semantics) with the final spec — this is a safety
     net in case classify_and_locate missed a newer reuse candidate
  4. Apply the change (respecting the ac_templates skill's required AC types —
     e.g. if AC is destructive-confirm, ensure the confirmation dialog AC is
     satisfied even if the user only listed the main AC)
  5. Run lint for the touched layer (builds.lint.*) — wrapped via builds.runner.
     Per-file build is SKIPPED; one final build (builds.review_gate) runs after
     all tasks complete. Same token-cost rationale as pipeline-mode Surgeon.
  6. If the final build fails: HALT, report error, do NOT continue
     (standalone does not auto-retry; user decides what to do)

IF post-verify (rules for loaded Tier 2 skills) flags ANY P0/P1: HALT with report.
```

### Step: write_ac_manifest

Write to `contexts/standalone/standalone-ac-manifest-{timestamp}.md`:

```markdown
---
mode: standalone
sub_mode: ac-driven
trigger: "Implement:\n{verbatim ACs pasted by user}"
created: {ISO-8601}
acs_count: {N}
files_changed: {M}
lines_changed: {L}
reference_ticket: {REF_TICKET or null}
reference_images: {count or 0}
---

# Standalone AC-Driven Surgery — {one-line summary}

## ACs (verbatim from trigger)
- AC1: {text}
- AC2: {text}
- AC3: {text}

## References used (omit whole section if none)

### Pattern reference: {REF_TICKET}
- Ref tasks:        {ref.task_count}  ·  Reuse ratio: {ref.reuse_ratio}
- Layer split:      {ref.layer_dist}
- Ship-ready on first review? {yes|no — {reason}}
- Amendments the ref went through: {summary or "none"}

### Visual analysis
- Images analyzed:  {M}  ({filenames or "attached inline"})
- Elements identified:
  · image 1: {element list}
  · image 2: {element list}
- Component matches (from shared_paths):
  · "Reset button" → {pack}-button (variant: secondary)
  · "Role select"  → {pack}-multi-select
- Novel elements (no shared match): {list or "none"}
- States in design: {default / hover / error / empty / loading — list}
- ACs visually confirmed: {AC ids}
- ⚠ In design but not in ACs: {elements visible but no matching AC}
- ⚠ In ACs but not in design: {ACs not shown visually}

## AC → Task mapping
| AC  | Task | Verdict | Files touched | Visual match? | Reference hint? |
|-----|------|---------|---------------|---------------|-----------------|
| AC1 | T1   | ✅ satisfied | {file1.ext}:43 | image-1 Reset btn | follows {REF_TICKET} T2 |
| AC2 | T2   | ✅ satisfied | {file2.ext}:87 | — | — |
| AC3 | T1+T2| ✅ satisfied | {file1.ext}:52, {file2.ext}:95 | image-1 disabled state | — |

## Files Changed
| File | Layer | Lines | Action |
|------|-------|-------|--------|
| {path} | {layer} | +{add} -{del} | MODIFY |

## Skills Applied
- {pack}-{layer}-standards.md        (per file)
- {pack}-{layer}-postverify.mdc      (per file)
- {pack}-ac-templates-intent-aware.md (for AC classification)

## Reuse Check Result
- {component path reused — satisfies AC{n}}
- (or "no match found — created new at {path}")

## Build Status
- {layer}: PASS | FAIL (error detail if any)

## Plan vs. Actual
{If the user revised the plan at the gate (via `Revise:`), show both the
 original inferred plan and the final revised plan for full auditability.
 If the user said `Go` immediately, show "Plan accepted as-is."}

## Hand-off Notes
_AC-driven standalone run. Changes are uncommitted — commit manually, or run
`@review.md Review changes` for a compact review before committing. No PR was
created, no epic context was updated. For ACs beyond 5 or larger changes, use:
   @orchestrator.md Work on <TICKET_ID>_
```

### Gate (AC-driven mode)

```
## Surgeon (Standalone — AC-Driven) - DONE

**Mode:**           standalone — ac-driven
**ACs implemented:** {N} / {original N}  (skipped: {list if any})
**Files changed:**   {M}
**Lines changed:**   {L}
**Build:**           {PASS | FAIL}
**Manifest:**        contexts/standalone/standalone-ac-manifest-{timestamp}.md

> **👉 Pick one:**
> - `Review changes`   — compact review of the diff
> - `Commit`           — guidance on `git add && git commit` (Surgeon does NOT auto-commit)
> - `Revert`           — `git checkout .` to undo
> - `Done`             — stop here, handle manually
```

**Rules for AC-driven mode:**
- **ALWAYS** gates at `plan_gate` — user must explicitly say `Go` before any code change.
- **NEVER** writes $LLD_FILE or $TESTPLAN_FILE.
- **ENFORCES**: ≤5 ACs, ≤5 files, ≤150 lines. Over any cap → halt with "use pipeline".
- **RUNS** reuse check (Step 0a) a second time inside execute_ac_driven as safety net.
- **LOADS** the pack's `ac_templates_intent_aware` skill to classify AC intent consistently with how Orchestrator would.
- **DOES NOT** auto-commit, auto-review, or update epic context.
- Output ALWAYS lives at `contexts/standalone/standalone-ac-manifest-{timestamp}.md`.

---

## Handling Edge Cases

- **Already done (✅):** Verify matches LLD → skip with evidence
- **Needs modification (🔧):** Minimal changes, preserve existing functionality
- **LLD deviation required:** STOP, explain why, wait for approval
- **Optional task:** Only implement if user approved at gate
- **Pre-existing errors:** Log, don't fix

---

## Step: final_build_check (4 — all tasks complete)

After all tasks are done, run the full clean build from `builds.review_gate` — same command Review will run. **This is the FIRST AND ONLY full build in the Surgeon phase** — per-task builds were removed (see Step 3 above). All compile-time errors from T1…T{N} surface here at once.

**Use `builds.runner.template_with_report` and write `$SURGEON_BUILD_REPORT`.** The report is what Review reads in its freshness check — if this build passes and Review runs before any further file edits, Review will skip its own `ant clean build` and reuse Surgeon's verdict (saves ~2–5 min + one full build's token cost). See the "Build report contract" section in `agent-pipeline/rules/agent-flow.mdc` for the report schema.

```bash
# Read from pipeline.yaml
FINAL_BUILD_CMD=$(yaml_get builds.review_gate)                 # e.g. "ant clean build"
RUNNER_TPL=$(yaml_get builds.runner.template_with_report)      # the file-only runner
LOG=$(yaml_get builds.runner.log_path)

echo "→ Final build: $FINAL_BUILD_CMD  (log: $LOG, report: $SURGEON_BUILD_REPORT)"

# Compose the wrapped command — substitute all four placeholders before eval:
WRAPPED=$(echo "$RUNNER_TPL" | sed \
  -e "s|{cmd}|$FINAL_BUILD_CMD|g" \
  -e "s|{log}|$LOG|g" \
  -e "s|{report}|$SURGEON_BUILD_REPORT|g" \
  -e "s|{agent}|surgeon|g" \
  -e "s|{phase}|final_build_check|g")
eval "$WRAPPED"
# Tool result is literally `exit=N` — no 30-line tail inlined into context.

FINAL_BUILD_STATUS=$?
```

**On failure, read `$SURGEON_BUILD_REPORT` on demand** (not automatically — the tail only costs context when you actually need to reason about the fix):

```bash
IF FINAL_BUILD_STATUS != 0:
  # Only read the report when entering the fix loop
  Read($SURGEON_BUILD_REPORT) → parse .tail_30 for the error
```

**Because per-task builds were skipped, this final run may surface multiple task-level errors simultaneously.** Apply the build-failure gate if `FINAL_BUILD_STATUS ≠ 0`. Use the same 5-attempt auto-fix loop defined for Step 2 — but against the aggregate final-build failure, not per task. After each fix attempt, re-run the wrapped command; each re-run overwrites `$SURGEON_BUILD_REPORT` with the latest verdict.

**Manifest entry:** After the final build (PASS or FAIL), append to `$MANIFEST_FILE`:
```
Final build: {PASS|FAIL} (exit $FINAL_BUILD_STATUS, {duration_s}s) — see $SURGEON_BUILD_REPORT
```
This lets Review discover the report path without having to derive it.

**This determines which gate opens — build state is the deciding factor.**

- `FINAL_BUILD_STATUS = 0` → **Gate A (clean)** — proceed normally
- `FINAL_BUILD_STATUS ≠ 0` → **Gate B (build failed)** — must fix, no Demo, no Review

---

## Gate (BUILD-STATE-AWARE)

### Gate A: Build PASS — all tasks done

**Demo option only appears here — never when build is broken.**

```
## [Step 3/5] Surgeon - DONE ✅

**Manifest:** `$MANIFEST_FILE`
- Tasks:      {X}/{N} implementation + {Y}/{M} test tasks ✅
- Files:      {count} ({new} new, {modified} modified)
- Build:      PASS  ({FINAL_BUILD_CMD})
- Post-verify: Lint PASS | Compile PASS | Unit tests PASS
- Deviations: {none | list}

⚠️ Changes NOT committed.

> **👉 Pick one (review options explained below the menu):**
>
> REVIEW:
> - `Run the review`          ← RECOMMENDED (default ship-path)
>                              Full ship-readiness gate (~$0.56, ~110-140K input). Runs:
>                                • full clean build + all unit tests
>                                • per-task code review (correctness/conventions/edge cases/security)
>                                • AC compliance matrix (intent-aware evidence check)
>                                • blast radius (who else consumes changed files)
>                                • pattern reference comparison (if reference ticket was declared)
>                                • visual fidelity (if design images were analyzed)
>                                • updates epic-context.md (required for next story)
>                                • updates project-map.md (if shared resources changed)
>                              REQUIRED before Ship.
>
> - `Run the review --slim`   (OPT-IN — pick this deliberately, not by default)
>                              Fast spot-check only (~$0.26, ~55-70K input). Runs:
>                                • full build + tests + task/test presence
>                              Skips everything else (per-task review, AC matrix, blast radius,
>                                pattern, visual, epic-context, project-map).
>                              NOT ship-ready. One-shot — does NOT auto-retry.
>                              Use only when: you want a fast integration confirmation before
>                                committing to the full review, OR you already know you'll need
>                                at least one Surgeon fix cycle and don't want to pay full for
>                                a failed review.
>
> OTHER:
> - `Demo`                    — optional: verify ACs in a real browser, find task gaps
> - `Show diff`               — display all changes
> - `Undo task: {T-ID}`       — revert a specific task

**Rule of thumb:**
- **Default path: `Run the review`** — it's the ship-required gate anyway; slim is pure overhead on a happy-path story. If you trust Surgeon's per-task work and the story looks complete, skip slim and go straight to full.
- **Only add `--slim` deliberately** when you expect multiple iterations (slim's $0.26 beats full's $0.56 for the failure-iteration loop) OR when you specifically want the 2-3 min faster feedback before committing to the full ship gate.
- **Unsure → pick `Run the review` (full).** Slim is an optimization for specific workflows, not a default.
```

### Gate B: Build FAILED — Demo and Review are BLOCKED

**Build must be fixed before anything else. Do not offer Demo or Review when code doesn't compile.**

```
## [Step 3/5] Surgeon - BUILD FAILED ⛔

Build command:   {FINAL_BUILD_CMD}
Build status:    FAILED ({N} errors, {M} warnings)

**Errors:**
  E1: {file}:{line} — {error message}
  E2: {file}:{line} — {error message}
  ...

These errors must be resolved before Demo or Review can run.
Running Demo on broken code produces meaningless results.

> **👉 Pick one:**
> - `Fix E1` — re-attempt this specific error
> - `Fix all` — re-attempt all build errors (in dependency order)
> - `Show full build output` — display complete compiler output
> - `I fixed it manually` — re-run build to verify
> - `Undo task: {T-ID}` — revert task that introduced the errors
```

**Fix loop:** After every fix attempt → re-run `FINAL_BUILD_CMD` → if PASS present Gate A, if FAIL present Gate B with updated error list.

**Demo and Review do NOT appear until build passes.** No exceptions.

### Gate B-Partial: Some tasks failed, some passed

When individual task post-verifications failed but Surgeon reached end of task list:

```
## [Step 3/5] Surgeon - DONE WITH TASK ERRORS ⚠

Tasks: {X}/{N} completed | Build: {PASS|FAIL}

**Task errors (unresolved):**
  T{N}: [{type}] {file}:{line} — {message}. Attempted {K}/5. Likely: {cause}

{IF Build FAIL:}
> **👉 Fix task errors first:**
> - `Fix T{N}` | `Fix all` | `I fixed it manually` | `Undo task: T{N}`

{IF Build PASS despite task errors:}
> **👉 Pick one:**
> - `Fix T{N}`                  — resolve remaining task error
> - `Skip T{N}`                 — accept error (documents as KNOWN_ISSUE)
> - `Proceed with errors (full)` ← RECOMMENDED — go to full Review (~$0.56, required before Ship)
> - `Proceed with errors (slim)` — opt-in: fast spot-check only (~$0.26, still needs full before Ship)
> - `Demo`                      — optional browser verify (build passed, task error is minor)

**When to pick full vs slim here:**
- **Default: pick full.** You're about to ship (maybe with KNOWN_ISSUES logged); full has the ship-gate checks (epic-context update, AC matrix, blast radius) you'll need anyway.
- Pick slim only if: you're still iterating on the remaining task error and want a fast build+test confirmation before paying for full. You'll still need full before Ship.
```

### Gate A-Resume: Re-entry after AC-E2E-Check adds tasks

```
## [Step 3/5] Surgeon - RESUMING (AC-E2E-Check found gaps)

New tasks from AC-E2E-Check:
  T8 [DEMO-ADDED]: {description}
  T9 [DEMO-ADDED]: {description}

Prior tasks T1–T7: ✅ DONE (in manifest — will not re-run)
Resuming from T8.

> **👉** `Go` — implement T8, T9
>          `Show T8` — review task before implementing
>          `Skip T8` — defer this task
```

**After T8, T9 done → re-runs final build check → Gate A or Gate B.**

**After ANY fix/skip/re-verify action:** update error list, update manifest, re-present correct gate. **Always end with `> **👉**` block.**

---

