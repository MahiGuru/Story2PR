---
name: bundle-surgeon-flow
description: Surgeon's bundle-mode flow. Loaded ONLY when surgeon.md detect_bundle_mode (0b) finds frontmatter.mode == "bundle" in the resolved $CONTEXTS_FILE. Single-story / bug flow never reads this file.
---

# Surgeon — Bundle Mode Flow

**Load ONLY when `detect_bundle_mode (0b)` in `surgeon.md` sets `{bundle_mode} = true`.** Single-story and bug flows never read this file.

By the time control reaches this file, the calling agent has already resolved:
- `{BUNDLE_ID}`, `{bundle_tickets}` (from `$CONTEXTS_FILE` frontmatter)
- All `$BUNDLE_*` paths per `agent-flow.mdc § Procedure C`
- `{bundle_state}` (from `$BUNDLE_STATE_FILE`)
- `{context_pressure}` config + `{context_estimated_tokens}` running counter (per `agent-flow.mdc § Context Pressure Detection`)

**⚠ Pressure-aware (applies to EVERY gate this file emits — Phase 0 start, per-task checkpoint, per-ticket gate under `--each`, error gate, end-of-stage):** before rendering any gate template, compute pressure and route per the contract:
- YELLOW (≥ warn_at) → prepend YELLOW banner
- ORANGE (≥ urgent_at) → render ORANGE template (resume: `Resume bundle-surgeon for {BUNDLE_ID} from T{cursor+1}`). Surgeon mutates the working tree — the ORANGE handoff is especially valuable here because uncommitted changes on a degrading-quality run are costly to untangle
- RED (≥ halt_at) → render RED template + HALT immediately. Surgeon refuses to invoke `implement` for any further task until override. Working-tree changes from completed tasks remain (surgeon never reverts); manifest is flushed atomically before halt.

The standard gate templates below assume GREEN — substitute per routing above when zone differs.

---

## Pre-flight (bundle)

```
1. Verify $BUNDLE_STATE_FILE exists. If missing:
   ⛔ HALT: "No _bundle-state.yaml at {path}. Bundle-orchestrator must run first."

2. Verify stages.explorer.status == "done". If not:
   ⛔ HALT: "Bundle-explorer did not complete. Run:
     @bundle-explorer.md Run the bundle explorer"

3. Read $BUNDLE_LLD_FILE PART 2 task table → {tasks}.
   Each task carries: T#, desc, Sources[], Layer, Depends_On[], Verify_By[],
   Insertion Point, Reuse Match, Explorer Notes (annotations from explorer).

4. Read $BUNDLE_TESTPLAN_FILE PART 4 → {test_tasks} (numbered TT1..TTn).

5. Determine resume cursor:
   IF trigger has "from T<N>": {cursor} = N
   ELIF stages.surgeon.last_task is set: {cursor} = stages.surgeon.last_task + 1
   ELSE: {cursor} = 1

6. Validate dependency graph for cursor:
   FOR every task whose T# >= {cursor}:
     FOR each dep in task.depends_on:
       IF dep < {cursor} AND dep is NOT marked complete in $BUNDLE_MANIFEST_FILE:
         ⛔ HALT: "Resume cursor {cursor} requires T{dep} complete (declared dependency).
           T{dep} is missing/failed in $BUNDLE_MANIFEST_FILE. Resume from T{dep} instead."

7. Update {bundle_state}.stages.surgeon:
     status: in_progress
     started_at: (preserve original on resume)
     total: len({tasks})
   Atomic write of $BUNDLE_STATE_FILE.

8. IF state.flags.each is true:
     Verify state.stages.surgeon.story_boundaries is non-empty (bundle-orchestrator B.3
     must have populated it). If empty:
       ⛔ HALT: "flags.each is true but story_boundaries is empty. Re-run bundle-orchestrator
         with --fresh --each, OR clear flags.each in {BUNDLE_STATE_FILE} to fall back to
         consolidated mode."
     Verify boundaries cover [1..total] contiguously with no gaps. If they don't:
       ⛔ HALT: "story_boundaries is malformed (gap or overlap). Inspect {BUNDLE_STATE_FILE}."
     Render in active-context block:
       Mode: bundle · per-story (--each) · {N} boundaries · resume_from=T{cursor}
   ELSE:
     Render: Mode: bundle · consolidated · resume_from=T{cursor}
```

## Bundle phase 0 — start-of-stage gate (⛔ MANDATORY HALT)

> 🛑 **THIS GATE IS MANDATORY.** After pre-flight succeeds, render the gate below and **STOP**. Do NOT touch any source files, do NOT begin task T{cursor}, do NOT write to `$BUNDLE_MANIFEST_FILE` until the user types `Go`. Bundle mode is gate-driven (one user `Go` per agent step). Skipping this gate is a bug.

```
## [Step 3/5] Bundle Surgeon — ready to implement

**Bundle:**     {BUNDLE_ID}
**Tickets:**    {N}
**Tasks:**      {total} ({impl_count} impl)
**Resume from:** T{cursor}
**Will:**       implement each task in LLD order, append rows to {BUNDLE_MANIFEST_FILE} with Sources column, build per-task, checkpoint every {checkpoint_every} tasks. NO commits — Ship owns commit/push.

> 👉 Pick one (REPLY REQUIRED — surgeon HALTS until you do):
> - `Go` — start implementation from T{cursor}
> - `Show $BUNDLE_LLD_FILE` — print the consolidated LLD task table before deciding
> - `Cancel` — halt; no files changed, state reset to `pending`
```

On `Go`: proceed to Phase 1. On `Cancel`: revert `stages.surgeon.status` to `pending` (atomic write) and halt.

## Bundle phase 1 — per-task implementation with checkpointing

```
checkpoint_every = pipeline_config.runtime.bundle.checkpoint_every.surgeon  # default 5

FOR i, task in enumerate(tasks_in_LLD_order, start=1):
  IF i < {cursor}:
    continue                                           # already done

  # Run the EXISTING per-task implementation flow from the single-story
  # Surgeon (Steps 0a..5: reuse_verification → load_coding_standards →
  # surgeon_pre_task_hook → pre_implementation_check → complexity_circuit_breaker →
  # implement → post_verification → principles_self_check →
  # surgeon_post_task_hook → track_changes → task_report).
  # Two adjustments for bundle mode:

    a) When reading task.Sources, if 2+ tickets, the per-task build report
       lists ALL source tickets in its frontmatter (`source_tickets: [...]`).
       Bundle-review groups AC compliance by Sources, so this preservation
       is mandatory.

    b) The Change Manifest entry is appended to $BUNDLE_MANIFEST_FILE (NOT a
       per-ticket manifest). Each entry row includes the Sources column:

       | T# | Status | Action | Files | Sources | Layer | Build | Notes |
       |----|--------|--------|-------|---------|-------|-------|-------|

  # Failure handling — different from single-story.
  IF the per-task implementation halts with an error (build fail, contract
  violation, post-verify fail) that the user can't immediately resolve:
    Append i to stages.surgeon.failed[].
    Atomic write of $BUNDLE_STATE_FILE.
    Render the standard Surgeon error gate (existing behavior) PLUS the
    bundle-specific options:
      > 👉 Pick one:
      >   1. `Fix and continue`     — current behavior; resume T{i} after fix
      >   2. `Skip T{i} for now`    — mark failed, continue at T{i+1}
      >   3. `Halt bundle`          — preserve cursor; resume later
    On `Skip`, advance cursor; failed[] retains i.

  # Checkpoint — TWO modes.
  IF state.flags.each is true:
    # PER-STORY MODE: gate fires at story boundaries (NOT every-N tasks).
    # The every-N checkpoint is suppressed entirely under --each.
    boundary = lookup(state.stages.surgeon.story_boundaries, last_t == i)
    IF boundary is not null AND i < total:
      # Just finished the last task of a ticket (or the SHARED prelude).
      # Run a per-ticket lint+typecheck scoped to that ticket's manifest rows.
      ticket_files = manifest_rows where boundary.first_t <= T# <= boundary.last_t
                       → flatten Files column → unique
      per_ticket_build = run_lint_and_typecheck(ticket_files)
                          # NOT a full clean build — that's bundle-review's job.
                          # Just lint/typecheck/fast unit tests for these files.
      Update stages.surgeon.last_task = i.
      Update stages.surgeon.story_progress[boundary.ticket] = "done".
      Atomic write of $BUNDLE_STATE_FILE.
      Render the per-ticket gate (template "PER-TICKET" below) and ⛔ HALT.
    # Else: in the middle of a ticket's tasks — no gate. Continue silently.

  ELSE:
    # CONSOLIDATED MODE (default): every-N-tasks checkpoint as before.
    IF (i - {cursor} + 1) % checkpoint_every == 0 AND i < total:
      Flush $BUNDLE_MANIFEST_FILE (append, fsync).
      Update stages.surgeon.last_task = i.
      Atomic write of $BUNDLE_STATE_FILE.
      Render checkpoint gate (template "CONSOLIDATED" below) and ⛔ HALT.
```

**Checkpoint gate template (CONSOLIDATED mid-stage — `flags.each: false`):**

```
## [Step 3/5] Bundle Surgeon — checkpoint at T{i}/{total}

**Bundle:**     {BUNDLE_ID}
**Tickets:**    {N}
**Progress:**   T{cursor}..T{i} done · {total - i} remaining
**Failed:**     {state.stages.surgeon.failed or "none"}
**Last build:** {verdict from latest per-task build report}

> **👉 Resume in a fresh chat to keep prompt cache warm:**
> - `Resume bundle-surgeon for {BUNDLE_ID} from T{i+1}` &nbsp; [▶ Open in new chat](cursor://anysphere.cursor-deeplink/prompt?text=Resume%20bundle-surgeon%20for%20{BUNDLE_ID}%20from%20T{i+1})
> - `Inspect state` — print _bundle-state.yaml (stays in current chat)
> - `Halt bundle` — leave artifacts; resume later via the original trigger
```

**Per-ticket gate template (PER-STORY mid-stage — `flags.each: true`):**

```
## [Step 3/5] Bundle Surgeon — ticket complete: {boundary.ticket}

**Bundle:**         {BUNDLE_ID}
**Just finished:**  {boundary.ticket} ({boundary.last_t - boundary.first_t + 1} tasks: T{boundary.first_t}..T{boundary.last_t})
**Files touched:**  {N} ({comma-list, truncated to 5 + "...{rest}"})
**Per-ticket build:** {PASS | FAIL — {first failing check}}
**Bundle progress:** {n_done_boundaries}/{n_total_boundaries} tickets done · {total - i} tasks remaining

{Next ticket preview, if any:}
**Next:** {next_boundary.ticket} ({next_boundary.last_t - next_boundary.first_t + 1} tasks: T{next_boundary.first_t}..T{next_boundary.last_t})

> 👉 Pick one (REPLY REQUIRED — surgeon HALTS until you do):
> - `Go`                 — proceed to next ticket ({next_boundary.ticket})
> - `Pause`              — halt; resume later via:
>                          `Resume bundle-surgeon for {BUNDLE_ID} from T{i+1}`
> - `Show diff`          — print git diff for {boundary.ticket}'s files (stays in current chat)
> - `Show manifest`      — print this ticket's manifest rows from {BUNDLE_MANIFEST_FILE}
> - `Amend T<N>`         — re-implement a specific task in {boundary.ticket}
>                          (must satisfy boundary.first_t <= N <= boundary.last_t)
> - `Skip remaining`     — mark all unfinished tickets as skipped; jump to end-of-stage
>                          (use only if you want to ship just what's done so far)
```

**Effects of user reply at per-ticket gate:**

- `Go`: advance cursor to `next_boundary.first_t` and continue Phase 1 loop.
- `Pause`: leave state as-is; print the resume command; halt cleanly.
- `Show diff`: `git diff -- {ticket_files}` (stays in current chat); re-render gate.
- `Show manifest`: print manifest rows where `boundary.first_t <= T# <= boundary.last_t`; re-render gate.
- `Amend T<N>`: re-run the per-task implementation flow for T<N>, then re-render the per-ticket gate. Manifest row for T<N> is rewritten.
- `Skip remaining`: set `cursor = total + 1`; mark every remaining boundary's tickets as `stages.surgeon.story_progress[ticket] = "skipped_by_user"`; jump to Phase 2 (final build check) for whatever IS done.

**Per-ticket build failure policy:** If `per_ticket_build` reports FAIL at a per-ticket gate, the gate template adds a blocking warning and replaces `Go` with `Fix and re-test` / `Pause` / `Show errors`. The user must explicitly `Override and continue` to advance with a failing ticket-build (recorded in `stages.surgeon.failed_builds[]` and surfaced at the end-of-stage gate).

## Bundle phase 2 — final build check

After the last task in {tasks}: run the existing `final_build_check` (Step 4) ONCE for the entire bundle. Reuse `builds.review_gate` command from pipeline config. Write a single `$SURGEON_BUILD_REPORT` for the bundle (path: `$BUNDLE_CONTEXT_DIR + {BUNDLE_ID} + "-surgeon-build.md"`).

## Bundle phase 3 — end-of-stage gate

```
1. Update {bundle_state}.stages.surgeon:
     status: done (or "completed_with_failures" if state.stages.surgeon.failed is non-empty)
     completed_at: {ISO8601}
     last_task: {total}
   Atomic write.

2. Render gate:

## [Step 3/5] Bundle Surgeon — DONE

**Bundle:**     {BUNDLE_ID}
**Tickets:**    {N}
**Tasks:**      {total} ({done_count} ✓, {failed_count} ✗)
**Files:**      {N} created, {M} modified
**Final build:** {verdict}

{If failed[] non-empty:
 ⚠ {failed_count} task(s) failed: {list}.
 Bundle-review will surface these as per-ticket coverage gaps.}

> **👉 Pick one:**
> - `Run the bundle review` &nbsp; [▶ Run Bundle Review in new chat](cursor://anysphere.cursor-deeplink/prompt?text=%40bundle-review.md%20Run%20the%20bundle%20review)
> - `Show $BUNDLE_MANIFEST_FILE` — print full manifest
> - `Resume bundle-surgeon for {BUNDLE_ID} from T<N>` — re-run a specific task
> - `Halt bundle` — leave for later
```

## Rules — Bundle mode (Surgeon)

- **No new implementation logic — reuses every existing per-task primitive.** Bundle mode walks the consolidated task list with the exact same per-task flow (reuse → standards → implement → post-verify → manifest). The only changes: source tagging on manifest rows, checkpoint cadence, and the `failed[] + skip` option in the error gate.
- **Cursor invariant.** `stages.surgeon.last_task` reflects the highest task index whose Change Manifest entry is durably written AND whose post-verify passed. On `--fresh`, this resets to 0; on resume, the next task is `last_task + 1` unless overridden.
- **Manifest is consolidated.** All bundle tasks share `$BUNDLE_MANIFEST_FILE`. Per-task build reports may be split per task (`{BUNDLE_ID}-T<N>-build.md`) but the manifest table is one file.
- **Skip semantics.** A user-skipped task adds to `failed[]` and advances the cursor. Bundle-review surfaces skipped tasks as AC coverage gaps for their source tickets — those tickets may be flagged "PARTIAL" in the per-ticket sub-verdict.
- **Single-story flow is unreachable from bundle mode.** The `{bundle_mode} = true` flag in `surgeon.md` is the sole entry point that triggers loading this file.
