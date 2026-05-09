---
name: explorer-bug
description: Bug Mode (Mode C) and Sub-Bug Mode (Mode C-SubBug) extensions for Explorer. Loaded ONLY when context file has mode=bug.
---

# Explorer — Bug Mode Extensions

**Load ONLY when Step 1 detects `mode: bug` in context file.** Story flow never reads this.

---

## Mode C: Bug Mode (standalone bug fixes)

Focused, single-purpose flow. Receives bug report from `$CONTEXTS_FILE` (PART 2/3/4 are placeholders in `$LLD_FILE` + `$TESTPLAN_FILE` companion files) and produces root-cause hypothesis + fix task list across the three files.

**Bug Mode has NO standalone invocation.** Bug localization depends on the
structured Bug Context (path, trigger, observed, expected, error signals) that
Orchestrator synthesizes from the JIRA bug ticket. Without that structure,
Explorer-bug has no reliable starting signal. If you want ad-hoc bug research
without a ticket, use Explorer's Research standalone mode instead:

```
@explorer.md Research: <your bug question, e.g. "why does handleSubmit throw null">
```

That returns research notes you can either act on manually or use as input for
a proper bug ticket + pipeline run.

No codebase map. No epic sync. No story-shaped exploration.

### Pre-flight

Explicit prerequisite contract. Each check has a HALT message telling the user exactly what to run next.

```
1. $CONTEXTS_FILE must exist (resolve via agent-flow.mdc § Procedure B).
   IF missing:
     HALT ⛔
     "No context file found for {TICKET_ID}.
      Run Orchestrator in Bug Mode first:
        @orchestrator.md Work on {TICKET_ID}   (issuetype: Bug)"

2. $CONTEXTS_FILE metadata must have `mode: bug` OR `mode: sub-bug`.
   IF metadata says `mode: story`:
     HALT ⛔
     "Ticket mode is 'story' but Explorer invoked in Bug Mode.
      Either:
        - Run Explorer story flow: @explorer.md Explore {TICKET_ID}
        - OR re-run Orchestrator if this ticket is actually a bug."

3. $LLD_FILE must exist with '# PART 2 — Fix Tasks' placeholder section.
   IF missing:
     HALT ⛔
     "LLD companion file missing: {path}.
      Re-run: @orchestrator.md Work on {TICKET_ID}"

4. $TESTPLAN_FILE must exist with '# PART 3 — Root Cause Hypotheses' and
   '# PART 4 — Regression Test Tasks' placeholders.
   IF missing:
     HALT ⛔
     "Test plan companion file missing: {path}. Re-run Orchestrator."

5. Bug Context section in $CONTEXTS_FILE must have non-empty path, trigger,
   observed, expected fields.
   IF any are empty/missing:
     HALT ⛔
     "Bug Context is incomplete (missing {which fields}).
      Update the JIRA ticket with these fields and re-run Orchestrator."

6. Current branch should match `fix/{TICKET_ID}-*`.
   IF not:
     WARN: "⚠ Not on a fix/* branch. Proceeding, but Surgeon will halt
            if you are not on the branch Orchestrator created."
```

If ALL checks pass, load the bug router skill and continue.

**Load bug localization router:** `Read: skills/{bug_router_skill}`
(from `skills.explorer.bug_router` in pipeline config). Small file (~80 lines). Do NOT load sub-skills yet.

If `{bug_router_skill}` is `<none>`, proceed with generic grep only.

### Phase 1: Layer Detection

Run Step 0 from the router skill. Classify: Frontend / Backend / Cross-stack. Document reasoning.

### Phase 2: Load Sub-Skill

Based on classification:
- Frontend → `Read: skills/{bug_frontend_skill}`
- Backend → `Read: skills/{bug_backend_skill}`
- Cross-stack → load both, start with frontend

Sub-skills contain: strategies (F1-F4 or B1-B6), decision tree, file-pairing tables, bug archetypes, pack-specific grep targets, regression test locations.

### Phase 2b: Shared Component Check (BEFORE writing fix tasks)

**This runs before any fix strategy.** If the bug is in a shared component, the fix scope and regression requirements change fundamentally.

```bash
# Is the bug file in a shared directory?
BUG_FILE="{file identified in Phase 2 as the likely bug location}"

# Check against shared_paths in pipeline.yaml
SHARED_DIRS=$(yaml_get shared_paths.frontend.ui_elements[*].path \
              shared_paths.frontend.services[*].path \
              shared_paths.backend.services[*].path \
              shared_paths.backend.rest_endpoints[*].path)

IS_SHARED=false
for dir in $SHARED_DIRS; do
  if [[ "$BUG_FILE" == "$dir"* ]]; then
    IS_SHARED=true
    break
  fi
done
```

**If IS_SHARED = false (feature-local bug):** Continue normally to Phase 3. Standard fix scope.

**If IS_SHARED = true (shared component bug):** STOP and assess impact FIRST:

```bash
# Count all consumers of this shared component
COMPONENT_NAME=$(basename "$BUG_FILE" .js)  # e.g., spReviewerSelector

# How many pages use this component?
# $EXCLUDES was built in parent Explorer's load_config (Step 0) from scan_exclusions.
# Keeps consumer count out of node_modules / jspm_packages / build output.
CONSUMERS=$(grep -rln $EXCLUDES "$COMPONENT_NAME" web/ui/ --include="*.html" \
            --include="*.xhtml" --include="*.js" --include="*.ts" \
            | grep -v "$BUG_FILE" | grep -v "Spec.js")

CONSUMER_COUNT=$(echo "$CONSUMERS" | wc -l)
CONSUMER_LIST=$(echo "$CONSUMERS" | head -10)  # show first 10
```

**Show the blast scope to user:**

```
⚠ BUG IS IN SHARED COMPONENT

  File: {BUG_FILE}
  Consumers: {CONSUMER_COUNT} pages/features use this component

  Top consumers:
  {CONSUMER_LIST}
  {if > 10: "...and {N-10} more"}

  Impact: Any fix to this component AFFECTS ALL {CONSUMER_COUNT} consumers.
  Risk:   A surgical fix that works for the bug ticket may break other consumers.

  Fix strategy enforced:
  1. Minimal, surgical change — do NOT refactor or extend while fixing
  2. Fix must be backwards-compatible (no new required props, no removed props)
  3. Regression tests REQUIRED for: the bug's consumer + {min(3, CONSUMER_COUNT)} other consumers
  4. Consumer list appended to PART 2 fix tasks as verification scope

  Proceed with fix analysis → Phase 3
```

**Append consumer list to the fix task (PART 2) so Review knows what to regression-test:**

```markdown
## T1 — Fix {bug description}
...
**Regression scope (shared component — verify these consumers):**
  - {consumer 1} — verify: {what to check}
  - {consumer 2} — verify: {what to check}
  - {consumer 3} — verify: {what to check}
  (total: {N} consumers exist — test at least 3 explicitly)
```

### Phase 3: Run Strategies

Follow decision tree from sub-skill. Stop when ≤3 high-confidence candidates. Log exact grep commands and result counts as evidence.

### Phase 4: Cross-Stack Pairing

Use pairing table from sub-skill. For every candidate, add paired files to candidate set. **Hard cap: 5 files after pairing.** If can't narrow below 5: recheck layer classification or ask user for more info.

### Phase 5: Write Hypotheses (PART 3 → `$TESTPLAN_FILE`)

Replace the placeholder PART 3 section in `$TESTPLAN_FILE` with the filled hypothesis list:

```markdown
# PART 3 — Root Cause Hypotheses

## Hypothesis H1 — {one-line}
**Confidence:** High / Medium / Low
**Archetype:** {from sub-skill or "novel"}
**Files:** `path/to/file.ext` (lines ~NNN-MMM, function)
**Evidence:** Strategy {Fx}: ran `{grep command}`, found {N} matches. {2-3 sentences linking evidence to hypothesis}
**Risk if wrong:** {what else might break}
```

### Phase 6: Write Fix Tasks (PART 2 → `$LLD_FILE`)

Replace the placeholder PART 2 section in `$LLD_FILE` with fix tasks. Same shape as LLD tasks (Surgeon's loop works unchanged):

```markdown
# PART 2 — Fix Tasks

## T1 — {description}
- **Layer:** {canonical layer}
- **Files:** `path/to/file.ext`
- **Change:** {1-2 sentences — contract level, not code}
- **Verify By:** {how to confirm fix worked}
- **Depends On:** {none or T-prior}
- **Hypothesis:** {H1/H2/H3}   ← references hypothesis in $TESTPLAN_FILE PART 3
```

Rules: Single-file tasks preferred. Cap at 3 fix tasks. Layer field mandatory.

### Phase 7: Write Regression Tests (PART 4 → `$TESTPLAN_FILE`)

Append after PART 3 in `$TESTPLAN_FILE`. One test task per fix task using sub-skill's test location table:

```markdown
# PART 4 — Regression Test Tasks

## T-TC1 — Regression test for T1
- **Layer:** {same as T1}
- **File:** {test file path}
- **Test:** {what the test asserts}
- **Verify By:** Passes on fix branch, fails when reverted
- **Depends On:** T1   ← references fix task in $LLD_FILE PART 2
```

If no test framework for that layer, mark as manual QA.

### Gate (Mode C)

```
## [Step 2/5] Explorer (Mode C - Bug) - DONE

Bug localized. Companion files updated:
- $LLD_FILE       → PART 2: {M} fix tasks
- $TESTPLAN_FILE  → PART 3: {N} hypotheses (top: {H1 desc}, confidence: {level})
                  → PART 4: {M} regression tasks ({K} automated, {L} manual)

Top candidate files: {list}
Layer: {Frontend | Backend | Cross-stack}

> **👉 Pick one:**
> - `Run the surgeon` — start fix implementation
> - `Investigate {H2/H3}` — explore alternate hypothesis
> - `I disagree` — redirect localization
> - `Cancel`
```

---

## Mode C-SubBug: Sub-Bug Mode

For bugs with "Parent Story Context" in `$CONTEXTS_FILE`.

### Pre-flight

All Mode C checks above, PLUS:

```
7. Extract parent_ticket_id and epic_id from $CONTEXTS_FILE.
   IF parent_ticket_id missing from Bug Context:
     HALT ⛔
     "Sub-Bug Mode requires 'Parent Story Context' in $CONTEXTS_FILE.
      This ticket's JIRA field 'Parent Story' must be populated.
      Update the ticket and re-run Orchestrator."

8. Parent's main context file must exist at $CONTEXT_DIR{PARENT_TICKET_ID}.md.
   IF missing:
     HALT ⛔
     "Parent ticket's context file not found:
        expected at $CONTEXT_DIR{PARENT_TICKET_ID}.md
      Either:
        - The parent ticket was never processed through Orchestrator
          → run Orchestrator on parent first
        - OR it was archived
          → restore from contexts/archive/ or accept degraded mode"

9. Parent's $LLD_FILE must exist at $CONTEXT_DIR{PARENT_TICKET_ID}-lld.md
   (Phase 0 cross-references the parent's PART 2 tasks).
   IF missing:
     WARN (don't halt):
     "⚠ Parent's LLD file is missing. Phase 0 Parent Task Cross-Reference
       will be skipped. Localization will fall through to normal Mode C flow."
```

Read parent context (READ-ONLY — parent has its own 3-file split):
```bash
cat $CONTEXT_DIR{PARENT_TICKET_ID}.md            # parent's Requirement Summary + ACs
cat $CONTEXT_DIR{PARENT_TICKET_ID}-lld.md        # parent's PART 1 + PART 2
cat $CODEBASE_MAP                                 # epic map — DO NOT SYNC
```
Then load bug router skill (same as Mode C).

### Phase 0: Parent Task Cross-Reference (RUN FIRST)

Before any other strategy:

1. Extract file paths from parent's PART 2 tasks (in `{PARENT_TICKET_ID}-lld.md`)
2. Compare against bug signals from `$CONTEXTS_FILE` Bug Context:
   - Bug URL → parent task touching that URL's file?
   - Message key → parent task touching that key's file?
   - Affected area → parent task in that area?
   - Stack trace → parent task touching a file in trace?
3. If match → high-confidence hypothesis. Write hypothesis (Phase 5), SKIP Phases 1-4.
4. If no match → fall through to normal Mode C flow (Phases 1-7).

**Why this works:** Most sub-bugs are "the feature we just built broke in an edge case." The parent's PART 2 is a pre-computed "what we just changed" list.

### Phases 1-7: Same as Mode C

With additions: epic codebase map available as read-only reference for URL→file and shared-component lookups.

### Gate (Mode C-SubBug)

```
## [Step 2/5] Explorer (Mode C-SubBug) - DONE

Parent: {PARENT_TICKET_ID}
Strategy 0 hit: {YES — T{N} touches {path} / NO — fell through to Mode C}

Companion files updated:
- $LLD_FILE       → PART 2: {M} fix tasks
- $TESTPLAN_FILE  → PART 3: {N} hypotheses
                  → PART 4: {M} regression tasks

> **👉 Pick one:**
> - `Run the surgeon`
> - `Investigate {H2/H3}`
> - `Cancel`
```

---

## Rules (Bug Modes)

- Bug modes do NOT sync the codebase map
- Sub-Bug reads map as reference only — never modifies
- Cap candidate files at 5 after pairing
- Bug mode never modifies code — read-only
- Hypotheses must cite grep evidence (exact commands + results)
- Sub-Bug always runs Strategy 0 first
- Sub-skills loaded on-demand (frontend bugs skip backend skill, vice versa)
