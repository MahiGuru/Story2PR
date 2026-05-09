---
name: standalone-review-flow
description: Review's standalone-mode flows (Diff / Ticket / AC-Driven sub-modes + shared AC-aware review engine + shared output shape). Loaded ONLY when review.md detect_invocation_mode (0) sets {mode} == "standalone". Pipeline (single-story / bug / bundle) runs never read this file — saves ~15K tokens of cached prefix per pipeline tool-call turn.
---

# Review — Standalone Mode Flows

**Load ONLY when `detect_invocation_mode (0)` in `review.md` sets `{mode} == "standalone"`.** The agent's `{sub_mode}` then dispatches to one of:

- `"diff"` — `Review changes` (compact diff review)
- `"ticket"` — `Review <TICKET>` (AC-coverage review of an existing ticket)
- `"ac-driven"` — `Review against: <bullets>` (AC-coverage review with inline ACs)

**Pipeline mode (single-story / bug / bundle) NEVER reads this file** — these flows are surgically extracted from `review.md` to keep the cached prefix small on the high-volume pipeline path.

This file contains:
1. Standalone Diff Flow (`Review changes`)
2. Standalone Ticket-Based Flow (`Review <TICKET>`)
3. Standalone AC-Driven Flow (`Review against:`)
4. Shared AC-Aware Review Engine (used by ticket + ac-driven sub-modes)
5. Shared Output Shape (used by ticket + ac-driven sub-modes)

By the time control reaches this file, the calling agent has already resolved `{mode}` and `{sub_mode}`.

---

## Standalone Diff Flow (runs ONLY when `{sub_mode} == "diff"`)

*Generic code-quality review of the current diff. No ACs, no ticket, no AC coverage.
Pipeline mode and other standalone sub-modes skip this section.*

### Step: check_standalone_inputs

```
1. Current branch must have uncommitted changes OR commits ahead of base.
   base = git merge-base HEAD $(yaml_get runtime.branching.base_branch || echo "main")
   changed_files = git diff --name-only $base...HEAD + git diff --name-only

   IF no changes at all:
     HALT ⛔
     "Working tree is clean and no commits ahead of base ({base}).
      Standalone Review has nothing to review.
      If you want to review someone else's branch: `git checkout <branch>` first."

2. Set $STANDALONE_REVIEW_FILE = contexts/standalone/standalone-review-{timestamp}.md
```

### Step: load_config (standalone — subset)

Read pipeline config files (`pipeline.yaml` + `pipeline.{PACK}.skills.yaml` + `pipeline.{PACK}.builds.yaml`):
- `skills.layer_map` — to detect layer per changed file and load correct Tier 2 skills
- `skills.extra_triggers` — orthogonal skills (a11y, ExtJS embedded, test conventions, …) that layer onto the primary Tier 2 skill when their `when:` condition matches the file
- `scan_exclusions` — so the review doesn't grep into node_modules
- SKIP: `builds.review_gate` (no full build in standalone)
- SKIP: `builds.tests` (no test suite runs)

### Step: standalone_code_review

```
FOR each changed file:
  1. Detect layer from file path (via skills.layer_map[*].path_glob)
  2. Load Tier 2 skill for that layer (e.g. {pack}-angularjs-standards.md)
  3. Load matching pack postverify rule (e.g. {pack}-angularjs-postverify.mdc)
  4. EVALUATE extra_triggers against the file:
     FOR each trigger in skills.extra_triggers:
       IF trigger.when matches (test against: file path + diff content):
         - File path match: does path contain markers the trigger describes?
           (e.g. "touches ExtJS" → grep file for Ext.define / Ext.create)
         - Content match:   does diff content contain ARIA attrs, interactive
                            elements, test identifiers, etc.?
         - Task-ID match:   N/A in standalone (no task IDs — skip this sub-check)
       IF matched:
         LOAD each skill in trigger.add[]
         These skills layer ONTO the primary Tier 2 skill — their rules apply
         for this file in addition to (not instead of) the layer-map skill.
  5. Read the file's diff (git diff -- <file>)
  6. Apply the code_review checklist against the UNION of loaded skills:
     - Correctness (against whatever intent is obvious from the diff)
     - Conventions (naming, style — per ALL loaded Tier 2 + add-on skills)
     - Edge cases (null/empty/loading/error/permission — the 5 questions)
     - Security (XSS, secrets, input validation)
     - Any checks added by the matched extra_triggers skills
       (e.g. a11y skill adds ARIA label checks;
             extjs skill adds Ext class-definition checks;
             test skill adds fixture/assertion conventions)
  7. Record verdict per file: PASS / NOTES / NEEDS FIX
     Attribute each issue to its source skill (primary layer skill vs. which
     extra_trigger add-on) in the issues list.

Produce issues list (P0 / P1 / P2 / P3) across all files.
```

**Explicitly SKIP** (standalone is not a replacement for pipeline review):
- full_verification (no clean build, no test suite)
- blast_radius (shared-component consumer search)
- test_plan_validation
- spec_coverage_check
- AC compliance
- Epic context update

### Step: write_standalone_review

Write to `$STANDALONE_REVIEW_FILE`:

```markdown
---
mode: standalone
trigger: "{verbatim trigger text}"
created: {ISO-8601}
files_reviewed: {N}
base_branch: {base}
---

# Standalone Review (compact)

⚠ **This is a compact review.** Blast radius, test plan, AC compliance,
and full build verification were NOT run. For those, use pipeline review:
run the full `@orchestrator.md Work on <TICKET>` flow.

## Scope
- Base: {base_branch} ({base_sha})
- HEAD: {head_sha}
- Files reviewed: {list with layer tag}

## Verdicts by file
| File | Layer | Verdict | P0 | P1 | P2 | P3 |
|------|-------|---------|----|----|----|----|
| ...  | ...   | ...     | .. | .. | .. | .. |

## Issues
### P0 (blockers)
{list or "none"}

### P1 (major)
{list or "none"}

### P2 / P3 (minor / nit)
{list or "none"}

## Skills applied
- {pack}-{layer}-standards.md  (per file)
- {pack}-{layer}-postverify.mdc (per file)
```

### Gate (standalone mode)

```
## Review (Standalone) - DONE

**Mode:** standalone (compact review — blast radius / tests / ACs NOT checked)
**Files reviewed:** {N}
**Verdict:** {N_pass} PASS, {N_notes} NOTES, {N_fix} NEEDS FIX
**P0 blockers:** {count}
**Output:** $STANDALONE_REVIEW_FILE

> **👉 Pick one:**
> - `Fix issues` — address the P0/P1 items manually
> - `Promote to pipeline` — run @orchestrator.md Work on <TICKET> for full analysis
> - `Done` — accept the compact review, proceed manually
```

**Rules for standalone diff mode:**
- NEVER reads or writes $MANIFEST_FILE / $LLD_FILE / $TESTPLAN_FILE.
- NEVER runs builds or tests.
- NEVER updates epic context or project map.
- Output is LABELED as compact — never mistaken for a full pipeline review.

---

## Standalone Ticket-Based Flow (runs ONLY when `{sub_mode} == "ticket"`)

*Ticket-scoped review — loads ACs from the ticket's `$CONTEXTS_FILE` and evaluates
the current diff against those ACs AND pack standards. No Surgeon manifest required,
no full build, no blast radius — just AC coverage + code quality per file.*

### Step: check_ticket_inputs

```
1. Extract {TICKET_ID} from the trigger text.

2. Run Procedure B to locate $CONTEXTS_FILE for the ticket.
   IF 0 matches:
     HALT ⛔
     "No context file for {TICKET_ID}. Pick one:
        - @orchestrator.md Work on {TICKET_ID}
            (run the pipeline — Orchestrator generates the AC Registry first)
        - @review.md Review against:
            - AC1: <paste your criteria inline>
            - AC2: ...
            (ad-hoc AC-driven review — no ticket needed)"

3. Read AC Registry from $CONTEXTS_FILE.
   IF AC Registry section is empty or missing:
     HALT ⛔
     "$CONTEXTS_FILE exists but has no AC Registry.
      Re-run Orchestrator OR use AC-driven: @review.md Review against: <ACs>"

4. Current branch must have changes to review.
   changed_files = git diff --name-only $(git merge-base HEAD <base>) HEAD
                 + git diff --name-only   (uncommitted)
   IF no changes:
     HALT ⛔
     "Working tree is clean and no commits ahead of base.
      Nothing to review for {TICKET_ID}.
      Did Surgeon run? Are you on the right branch?"

5. Current branch MAY be the ticket's feature branch but DOES NOT have to be —
   standalone review can inspect any branch. Record the branch in the output.

Set $STANDALONE_TICKET_REVIEW_FILE = contexts/standalone/standalone-ticket-review-{timestamp}.md
```

### Step: review_against_ticket_acs

Delegates to the **Shared AC-Aware Review Engine** (below). Input: ACs from $CONTEXTS_FILE, changed_files from git diff.

### Step: write_ticket_review

Write to `$STANDALONE_TICKET_REVIEW_FILE` using the Shared Output Shape (see bottom of this file).

Front-matter specifics:
```yaml
---
mode: standalone
sub_mode: ticket
trigger: "Review {TICKET_ID}"
created: {ISO-8601}
ticket: {TICKET_ID}
context_file: $CONTEXTS_FILE
acs_count: {from AC Registry}
files_reviewed: {M}
base_branch: {base}
current_branch: {current}
---
```

### Gate (ticket sub-mode)

```
## Review (Standalone — Ticket) - DONE

**Mode:**            standalone — ticket
**Ticket:**          {TICKET_ID}
**Branch:**          {current} (vs. base {base})
**Files reviewed:**  {M}
**AC coverage:**     {N_satisfied} ✅ / {N_partial} 🟡 / {N_missing} ❌
**Code verdict:**    {N_pass} PASS / {N_notes} NOTES / {N_fix} NEEDS FIX
**P0 blockers:**     {count}
**Output:**          contexts/standalone/standalone-ticket-review-{ts}.md

> **👉 Pick one:**
> - `Fix: <AC or file>`     — hand off to Surgeon standalone with the specific gap
>                              (@surgeon.md Apply: address {AC} missing in {file})
> - `Promote to pipeline`   — need blast radius + tests + test plan:
>                              @orchestrator.md Work on {TICKET_ID}
> - `Done`                  — accept the compact review, proceed manually
```

**Rules for standalone ticket mode:**
- NEVER writes to $LLD_FILE / $TESTPLAN_FILE / $MANIFEST_FILE.
- NEVER runs full build or test suite.
- NEVER updates epic-context.md or project-map.md.
- Reads AC Registry from $CONTEXTS_FILE (read-only).
- Output file prefix: `standalone-ticket-review-` (distinct from plain `standalone-review-`).

---

## Standalone AC-Driven Flow (runs ONLY when `{sub_mode} == "ac-driven"`)

*AC-driven review — user pastes ACs inline; Review evaluates the current diff
against those ACs + pack standards. Same engine as ticket mode, ACs come from
the trigger instead of $CONTEXTS_FILE.*

### Step: parse_acs_and_check_inputs

```
1. Parse ACs from trigger body (same parser as AC-driven Surgeon):
   Recognized shapes:
     - "AC{N}: <text>"
     - "- <text>"              (auto-number AC1, AC2, ...)
     - "1. <text>"             (use the number as AC id)
     - "Given <...>, when <...>, then <...>"

   Output: {acs} = [{id, text, given?, when?, then?}, ...]

2. VALIDATE:
   IF {acs}.length == 0:
     HALT ⛔
     "Couldn't find any ACs in 'Review against:'. Expected a bullet list:
        @review.md Review against:
          - AC1: <criterion>
          - AC2: <criterion>"

   IF {acs}.length > 5:
     HALT ⛔
     "AC-driven review is capped at 5 ACs (you provided {N}).
      More than 5 ACs means this is a story, not an ad-hoc spot check.
      Use the pipeline:  @orchestrator.md Work on <TICKET_ID>"

3. Current branch must have changes (same check as ticket mode).
   IF no changes:
     HALT ⛔ "No changes to review. See ticket mode for diagnostic hints."

Set $STANDALONE_AC_REVIEW_FILE = contexts/standalone/standalone-ac-review-{timestamp}.md
```

### Step: review_against_inline_acs

Delegates to the **Shared AC-Aware Review Engine** (below). Input: inline {acs}, changed_files from git diff.

### Step: write_ac_review

Write to `$STANDALONE_AC_REVIEW_FILE` using the Shared Output Shape.

Front-matter specifics:
```yaml
---
mode: standalone
sub_mode: ac-driven
trigger: "Review against:\n{verbatim ACs}"
created: {ISO-8601}
ticket: null
acs_count: {N}
files_reviewed: {M}
base_branch: {base}
current_branch: {current}
---
```

### Gate (ac-driven sub-mode)

```
## Review (Standalone — AC-Driven) - DONE

**Mode:**            standalone — ac-driven
**ACs evaluated:**   {N}
**Branch:**          {current} (vs. base {base})
**Files reviewed:**  {M}
**AC coverage:**     {N_satisfied} ✅ / {N_partial} 🟡 / {N_missing} ❌
**Code verdict:**    {N_pass} PASS / {N_notes} NOTES / {N_fix} NEEDS FIX
**P0 blockers:**     {count}
**Output:**          contexts/standalone/standalone-ac-review-{ts}.md

> **👉 Pick one:**
> - `Fix: <AC or file>`     — hand off to Surgeon standalone
> - `Promote to pipeline`   — use:  @orchestrator.md Work on <TICKET_ID>
> - `Done`
```

**Rules for standalone ac-driven mode:**
- Same isolation rules as ticket mode (no pipeline file writes, no build, no epic).
- Cap: ≤ 5 ACs. Over → halt with promote-to-pipeline message.
- Output file prefix: `standalone-ac-review-` (distinct from plain + ticket prefixes).

---

## Shared AC-Aware Review Engine

*Used by both Ticket-Based Flow and AC-Driven Flow. Inputs: {acs} list, {changed_files} list. Output: structured findings for the Shared Output Shape.*

### Load once (pipeline config — multiple files)

Read these and merge:
- `contexts/config/pipeline.yaml` (core)
- `contexts/config/pipeline.{PACK}.skills.yaml` (skills.*)
- `contexts/config/pipeline.{PACK}.builds.yaml` (builds.review_gate, review_test_suite)
- `contexts/config/pipeline.{PACK}.analyzer.yaml` (scan_exclusions, component_naming)

```
- skills.layer_map                              (file → layer → Tier 2 standards skill)
- skills.extra_triggers                         (orthogonal skills that layer onto
                                                 the primary Tier 2 skill when their
                                                 `when:` condition matches a file —
                                                 e.g. a11y on UI files, ExtJS when
                                                 embedded in AngularJS, test standards
                                                 on test files)
- skills.orchestrator.ac_templates_intent_aware (AC intent templates — same skill
                                                 Orchestrator + AC-driven Surgeon use)
- scan_exclusions                               (for any greps inside the engine)
- component_naming.prefix                       (used in AC evidence matching)
```

### Engine algorithm

```
FOR each AC in {acs}:
  1. CLASSIFY intent via the loaded ac_templates skill:
     destructive-confirm | destructive-immediate | submit | navigation
     | async-action | toggle | bulk-action | unknown

  2. LOOK UP required AC types for this intent (from the templates skill).
     Example for destructive-confirm: confirmation dialog AC, audit log AC, permission AC.

  3. SCAN the diff for evidence that each required type is satisfied:
     - Grep diff text for anchor keywords (confirm / audit / right check / etc.)
     - Identify touched file + line ranges that correspond to each evidence
     - Record: found_at = [{file, line, snippet}] OR empty

  4. VERDICT per AC:
     ✅ SATISFIED   — all required types have evidence in the diff
     🟡 PARTIAL    — some required types have evidence, others missing
     ❌ MISSING    — no evidence for this AC in the diff at all
     ⚠ UNCLEAR    — classification failed; diff has relevant code but engine
                     can't confidently assert coverage — flag for human review

FOR each file in {changed_files}:
  1. RESOLVE layer via skills.layer_map[*].path_glob match.
  2. LOAD Tier 2 primary skill for that layer (e.g. {pack}-{layer}-standards.md).
  3. LOAD matching pack postverify rule (e.g. {pack}-{layer}-postverify.mdc).
  4. EVALUATE skills.extra_triggers against this file:
     FOR each trigger in extra_triggers:
       Evaluate trigger.when against:
         - File path heuristics (does the path suggest ARIA / ExtJS / tests / etc.?)
         - Diff content heuristics (does the diff contain ARIA attrs, Ext.define,
           test IDs, interactive elements, etc.?)
         - Task-ID heuristics (N/A in standalone — skip this branch)
       IF matched:
         LOAD each skill in trigger.add[] — these layer ONTO the primary skill.
     Record which extra_triggers fired per file (for the output's Skills section).
  5. READ the file's diff (git diff -- <file>).
  6. APPLY the standard code_review checklist against the UNION of all loaded
     skills (primary Tier 2 + postverify rule + every matched extra_trigger skill):
     - Correctness (against the AC intents this file seems to address)
     - Conventions (naming, style per ALL loaded skills)
     - Edge cases (null / empty / loading / error / permission — the 5 questions)
     - Security (XSS, secrets, input validation)
     - Performance (N+1, leaks per layer)
     - Any additional checks from matched extra_triggers skills
       (e.g. a11y skill → ARIA label + role + keyboard-nav checks;
             extjs skill → Ext class + store + render conventions;
             test skill → fixture + assertion + test-name conventions)
  7. Verdict per file: PASS / NOTES / NEEDS FIX.
     Emit per-file issues at severity P0 / P1 / P2 / P3.
     Attribute each issue to its source skill (primary vs. which add-on) so the
     user can see WHY the check fired.

AGGREGATE:
  Combined issues list (P0 → P3), annotated with AC link when an issue affects AC coverage.
```

### Engine extension: compare_against_reference (only if {reference_ticket} set)

```
IF {reference_ticket} is unset: SKIP this step.

1. Run Procedure B on the reference ticket to resolve its artifacts.
   IF not found: WARN and unset {reference_ticket}; continue.

2. Read the reference's:
   - $CONTEXTS_FILE    → AC Registry + Requirement Summary
   - $LLD_FILE         → PART 2 tasks, AC-Matrix
   - $TESTPLAN_FILE    → PART 3 test plan, PART 4 test tasks
   - $REVIEW_FILE      → ship-ready verdict, issues, lessons

3. Check pack compatibility:
   - Compare ref's pack metadata against current pack.
   - IF mismatch: WARN in output (not halt) — reference may not transfer cleanly.

4. Extract reference pattern:
   - Task count + shape
   - Layer distribution (# tasks per layer)
   - File set touched (unique paths)
   - Reuse ratio (♻️ tasks / total)
   - Review verdict summary (ship-ready first pass? P1 count?)
   - Amendment Log entries

5. Compare current diff's approach to the reference pattern:
   - Task count: similar (±1) or way off?
   - Reuse ratio: at, above, below the reference's?
   - File set shape: same layer distribution?
   - Quality issues found: similar kind or different?

6. Emit findings for the "Pattern Reference" output section:
   ✓ Matches reference pattern (positive — same reuse decisions)
   ⚠ Diverges from reference: {specifics} — may be intentional
   ❌ Violates a pattern the reference proved works: {specifics}
```

### Engine extension: compare_against_design_image (only if {reference_images} non-empty)

```
IF {reference_images} is empty: SKIP this step.

1. For each image (up to 3), LLM extracts a structured description:
   - UI elements (type, label, variant, state)
   - Layout (header/sidebar/content/footer/modal/toast)
   - States shown (default / hover / disabled / error / empty / loading)
   - Visible text/labels
   - Visual hierarchy

2. Cross-reference with shared_paths.frontend.ui_elements[*].provides[]:
   For each identified element, find matching existing component.
   Record: {element, matched_component OR "novel"}

3. Compare with the current diff:
   FOR each visual element in design:
     - Grep the diff for evidence the element was implemented
       (component name, expected attrs like aria-label, expected states)
     - Verdict:
         ✅ IMPLEMENTED  — clear evidence in diff
         🟡 PARTIAL     — partial evidence (e.g. element present but state missing)
         ❌ MISSING     — no evidence in diff
         ⚠ UNCLEAR     — related code in diff but cannot confidently assert

   FOR each change in the diff:
     - Is there a corresponding element in the design?
     - IF NOT: flag "UI change present in code, not represented in design"

4. Emit findings for the "Visual Fidelity" output section:
   - Per-element verdicts (Element / In design / In diff / Verdict)
   - Extra code changes not justified by design
   - Design elements missing from code
```

### Engine explicitly SKIPS (standalone is not full pipeline review)

- full_verification (no clean build)
- unit_test_suite (no test runs)
- blast_radius (no shared-component consumer search)
- test_plan_validation
- spec_coverage_check
- epic_context_update

---

## Shared Output Shape (for ticket + ac-driven sub-modes)

```markdown
---
mode: standalone
sub_mode: {ticket | ac-driven}
trigger: "{verbatim}"
created: {ISO-8601}
ticket: {TICKET_ID or null}
acs_count: {N}
files_reviewed: {M}
base_branch: {base}
current_branch: {current}
reference_ticket: {REF_TICKET or null}
reference_images: {count or 0}
---

# Standalone {Ticket|AC-Driven} Review — {short summary}

⚠ **Compact review.** Full clean build, unit test suite, blast radius, and test
plan validation were NOT run. For those, promote to pipeline:
   @orchestrator.md Work on <TICKET_ID>

## Source
- Ticket:          {TICKET_ID or "inline ACs"}
- Context file:    {path or "n/a"}
- Branch:          {current} vs. base {base}

## ACs
- AC1: ...
- AC2: ...
- AC3: ...

## AC Coverage
| AC  | Intent                | Verdict       | Evidence in diff            | Missing (if any)            |
|-----|-----------------------|---------------|----------------------------|----------------------------|
| AC1 | destructive-confirm   | ✅ SATISFIED  | featureCtrl.{ext}:L45      | —                          |
| AC2 | submit                | 🟡 PARTIAL    | submit handler found       | no error-state handling    |
| AC3 | toggle                | ❌ MISSING    | not found in diff          | entire toggle behavior     |
| AC4 | async-action          | ⚠ UNCLEAR    | related code in diff       | cannot assert — human review |

## Pattern Reference (omit whole section if no reference_ticket)
Reference ticket: **{REF_TICKET}** ({ref_pack} pack — {same as current | ⚠ mismatch})

| Aspect              | Reference       | Current diff    | Verdict                            |
|---------------------|-----------------|-----------------|-----------------------------------|
| Task count          | {ref.tasks}    | {cur.tasks}     | ✓ aligned / ⚠ ±N / ❌ way off     |
| Reuse ratio         | {ref.reuse%}   | {cur.reuse%}    | ✓ at-or-above / ⚠ below reference |
| Layer distribution  | {ref.dist}     | {cur.dist}      | ✓ same / ⚠ differs — intentional? |
| Quality on first pass | {ref.verdict} | (this review)   | {context}                          |

### Pattern deviations
- ⚠ Reference modified {file X} but current diff creates a new one — consider REUSE
- ✓ Current diff's layer split matches reference's exactly
- ❌ Reference had {AC audit log type} AC satisfied — current diff is missing it

## Visual Fidelity (omit whole section if no reference_images)
Design reference: {M} image(s) analyzed

| Element                 | In design | In diff | Verdict                                 |
|-------------------------|-----------|---------|----------------------------------------|
| Reset button (secondary)| ✅        | ✅      | OK — matches design                    |
| Loading spinner         | ✅        | ❌      | MISSING — design shows; diff doesn't   |
| Error toast (red)       | ❌        | ✅      | Extra — in code, not shown in design   |
| Disabled state          | ✅        | 🟡     | PARTIAL — button exists, disabled binding missing |

### Extra code changes not visible in design
- {file.ext}:L{N} — added a retry button (not in design; intentional?)

### Design elements missing from code
- Loading spinner during async fetch (design shows it at image-2)
- Empty state message when list is 0 rows (image-3)

## Code Quality (per changed file)
| File                                   | Layer            | Verdict     | P0 | P1 | P2 | P3 |
|----------------------------------------|------------------|-------------|----|----|----|----|
| {frontend_path}/feature/featureCtrl.{ext} | Frontend/AngularJS | NEEDS FIX | 0  | 1  | 2  | 0  |
| {rest_path}/FeatureResource.{ext}      | Backend/REST     | PASS        | 0  | 0  | 0  | 0  |

## Issues (combined, AC-linked where relevant)

### P0 (blockers)
{list or "none"}

### P1 (major)
- AC2 / featureCtrl.{ext}:L102 — missing error-state handling; submit intent
  requires a user-visible error AC. Fix: add .catch block with notification.
- featureCtrl.{ext}:L78 — no null check on response.data before property read.

### P2 / P3 (minor / nit)
{list or "none"}

## Skills Applied

### Primary (resolved via skills.layer_map)
- {pack}-{frontend-layer}-standards.md        (featureCtrl.{ext})
- {pack}-{frontend-layer}-postverify.mdc      (featureCtrl.{ext})
- {pack}-{backend-layer}-standards.md         (FeatureResource.{ext})
- {pack}-{backend-layer}-postverify.mdc       (FeatureResource.{ext})

### Add-on (matched from skills.extra_triggers)
- {pack}-accessibility.md      — matched on featureCtrl.{ext} (ARIA attrs present in diff)
- {pack}-test-standards.md     — matched on featureSpec.{ext} (test file convention)
- {pack}-extjs-standards.md    — matched on gridPanel.{ext} (Ext.define detected)
  (only shows rows that actually matched; rows without matches are omitted)

### Classification support
- {pack}-ac-templates-intent-aware.md         (for AC intent classification)

## Hand-off Notes
- For each AC marked 🟡 PARTIAL or ❌ MISSING, a focused fix is:
    @surgeon.md Apply: address {AC description} in {file}
- For ⚠ UNCLEAR ACs, re-run review with inline hint:
    @review.md Review against:  (with clarified AC wording)
- For full pipeline review (blast radius + tests + test plan):
    @orchestrator.md Work on <TICKET_ID>
```

---

