---
name: bundle-explorer-flow
description: Explorer's bundle-mode flow. Loaded ONLY when explorer.md detect_bundle_mode (0b) finds frontmatter.mode == "bundle" in the resolved $CONTEXTS_FILE. Single-story / bug flow never reads this file.
---

# Explorer — Bundle Mode Flow

**Load ONLY when `detect_bundle_mode (0b)` in `explorer.md` sets `{bundle_mode} = true`.** Single-story and bug flows never read this file.

By the time control reaches this file, the calling agent has already resolved:
- `{BUNDLE_ID}`, `{bundle_tickets}` (from `$CONTEXTS_FILE` frontmatter)
- All `$BUNDLE_*` paths per `agent-flow.mdc § Procedure C`
- `{bundle_state}` (from `$BUNDLE_STATE_FILE`)
- `{context_pressure}` config + `{context_estimated_tokens}` running counter (per `agent-flow.mdc § Context Pressure Detection`)

**⚠ Pressure-aware (applies to EVERY gate this file emits — Phase 0 start, per-task checkpoint, end-of-stage):** before rendering any gate template, compute pressure and route per the contract:
- YELLOW (≥ warn_at) → prepend YELLOW banner to the existing gate template
- ORANGE (≥ urgent_at) → render ORANGE template instead (resume command: `Resume bundle-explorer for {BUNDLE_ID} from T{cursor+1}`)
- RED (≥ halt_at) → render RED template + HALT immediately, even mid-task. Update `state.stages.explorer.max_pressure_observed` and `pressure_handoffs` atomically before halt.

The standard gate templates below assume GREEN zone — the LLM running this file substitutes per the routing above when zone is YELLOW/ORANGE/RED.

---

## Pre-flight (bundle)

```
1. Verify $BUNDLE_STATE_FILE exists. If missing:
   ⛔ HALT: "No _bundle-state.yaml found at {path}. Bundle-orchestrator must run first."

2. Verify stages.orchestrator.status == "done". If not:
   ⛔ HALT: "Bundle-orchestrator did not complete. Re-run:
     @bundle-orchestrator.md Resume bundle-orchestrator for {BUNDLE_ID}"

3. Read $BUNDLE_LLD_FILE and parse PART 2 task table.
   {tasks} = list of (T#, desc, sources[], layer, depends_on[], verify_by[])

4. Read $BUNDLE_TESTPLAN_FILE PART 4 task table.
   {test_tasks} = list of (TT#, desc, sources[], layer, verify_by[])

5. Determine resume cursor:
   IF trigger has "from T<N>": {cursor} = N
   ELIF stages.explorer.last_task is set: {cursor} = stages.explorer.last_task + 1
   ELSE: {cursor} = 1

6. Update {bundle_state}.stages.explorer:
     status:     in_progress
     started_at: (new run only — preserve original on resume)
     total:      len({tasks}) + len({test_tasks})
   Atomic write of $BUNDLE_STATE_FILE.
```

## Bundle phase 0 — start-of-stage gate (⛔ MANDATORY HALT)

> 🛑 **THIS GATE IS MANDATORY.** After pre-flight succeeds, render the gate below and **STOP**. Do NOT begin codebase-map sync, do NOT process any tasks, do NOT write to `$BUNDLE_EXPLORATION_FILE` until the user types `Go`. Bundle mode is gate-driven (one user `Go` per agent step). Skipping this gate is a bug.

```
## [Step 2/5] Bundle Explorer — ready to explore

**Bundle:**     {BUNDLE_ID}
**Tickets:**    {N}
**Tasks:**      {len(tasks)} impl + {len(test_tasks)} test = {total} total
**Resume from:** T{cursor}
**Will:**       sync codebase map (once for the bundle), annotate each task with insertion points + reuse matches, append to {BUNDLE_EXPLORATION_FILE}, checkpoint every {checkpoint_every} tasks.

> 👉 Pick one (REPLY REQUIRED — explorer HALTS until you do):
> - `Go` — start exploration from T{cursor}
> - `Show $BUNDLE_LLD_FILE` — print the consolidated LLD before deciding
> - `Cancel` — halt; no files written, state unchanged
```

On `Go`: proceed to Phase 1. On `Cancel`: revert `stages.explorer.status` to `pending` (atomic write) and halt.

## Bundle phase 1 — codebase-map alignment

Same as the existing per-story Explorer Phase 1.5 (`sync_map`), except:
- Run ONCE for the bundle, not per ticket.
- Sync source = `git log {base_branch}..HEAD` (the bundle branch).
- All bundled tickets contribute to `last_synced_by`: write `last_synced_by: {BUNDLE_ID}` (not a single ticket ID) so future runs can attribute the sync.

## Bundle phase 2 — per-task exploration with checkpointing

```
checkpoint_every = pipeline_config.runtime.bundle.checkpoint_every.explorer  # default 5

FOR i, task in enumerate(tasks_and_test_tasks_in_lld_order, start=1):
  IF i < {cursor}:
    continue                                           # already done in prior run

  Process the task using the SAME logic as single-story Explorer's
  per-task annotation flow (reuse_check → insertion_point → pattern_match
  → annotate LLD/testplan in place). Two adjustments for bundle mode:

    a) Annotation rows in $BUNDLE_LLD_FILE PART 2 / $BUNDLE_TESTPLAN_FILE PART 4
       carry the existing Sources: <ticket-list> column unchanged.
       Explorer adds Insertion Point / Reuse Match / Explorer Notes per row;
       it does NOT modify Sources or Depends On (those are bundle-orchestrator's outputs).

    b) When a task's Sources includes 2+ tickets, Explorer's Reuse Match
       search MUST consider components owned by ANY of those tickets'
       feature folders, not just one. Use the union of feature-paths.

  Append per-task entry to $BUNDLE_EXPLORATION_FILE under the heading
  `## T{N} — {desc} (Sources: {ticket-list})`.

  Update {bundle_state}.stages.explorer.last_task = i.
  IF the task hit an unrecoverable error (file unreadable, scan failed):
    Append i to stages.explorer.failed[].
    Continue to next task — do NOT halt the whole stage on a single task failure.
    Surface failed tasks at the end-of-stage gate.

  IF (i - {cursor} + 1) % checkpoint_every == 0:
    # Checkpoint reached — flush + emit fresh-chat resume gate.
    Flush $BUNDLE_EXPLORATION_FILE (append mode, fsync).
    Atomic write of $BUNDLE_STATE_FILE.
    Render checkpoint gate (template below) and ⛔ HALT (MANDATORY — do NOT auto-continue).
    The user clicks the deeplink → fresh chat → re-enters Bundle Flow at "Pre-flight".
```

**Checkpoint gate template (mid-stage):**

```
## [Step 2/5] Bundle Explorer — checkpoint at T{i}/{total}

**Bundle:**     {BUNDLE_ID}
**Tickets:**    {N}
**Progress:**   T{cursor}..T{i} done · {total - i} remaining
**Failed:**     {state.stages.explorer.failed or "none"}

> **👉 Resume in a fresh chat to keep prompt cache warm:**
> - `Resume bundle-explorer for {BUNDLE_ID} from T{i+1}` &nbsp; [▶ Open in new chat](cursor://anysphere.cursor-deeplink/prompt?text=Resume%20bundle-explorer%20for%20{BUNDLE_ID}%20from%20T{i+1})
> - `Inspect state` — print _bundle-state.yaml (stays in current chat)
> - `Halt bundle` — leave artifacts; resume later via the original trigger
```

## Bundle phase 3 — end-of-stage gate

Reached when `i == total`:

```
1. Update {bundle_state}.stages.explorer:
     status: done
     completed_at: {ISO8601}
     last_task: {total}
     # failed[] preserved as-is for audit
   Atomic write.

2. Render end-of-stage gate:

## [Step 2/5] Bundle Explorer — DONE

**Exploration saved:** $BUNDLE_EXPLORATION_FILE
**Codebase map:** synced ({N} updated, {M} added)

**Summary:**
- Bundle:           {BUNDLE_ID}
- Tickets covered:  {N}
- Tasks explored:   {total} ({impl_count} impl + {test_count} test)
- Reuse hits:       {N}
- Conflicts:        {none | list of cross-ticket annotation conflicts}
- Failed tasks:     {state.stages.explorer.failed or "none"}

{If state.stages.explorer.failed is non-empty:
 ⚠ {len(failed)} task(s) failed during exploration. Listed in $BUNDLE_EXPLORATION_FILE.
 Surgeon will skip these unless you Amend or Resume from a specific T<N>.}

> **👉 Pick one:**
> - `Run the bundle surgeon` &nbsp; [▶ Run Bundle Surgeon in new chat](cursor://anysphere.cursor-deeplink/prompt?text=%40bundle-surgeon.md%20Run%20the%20bundle%20surgeon) — start consolidated implementation
> - `Show $BUNDLE_EXPLORATION_FILE` — print full exploration report
> - `Resume bundle-explorer for {BUNDLE_ID} from T<N>` — re-explore a specific task
> - `Modify: <change>` — adjust findings (re-runs annotation for affected tasks only)
```

## Rules — Bundle mode

- **No new logic — reuses every existing per-task primitive.** Bundle mode walks the consolidated task list using the SAME per-task annotation/reuse-check/insertion-point logic as single-story Explorer. The only deltas: looping over a longer list, source-aware reuse search, checkpointed resume.
- **Single-story flow is unreachable from bundle mode.** The `{bundle_mode} = true` flag in `explorer.md` is the sole entry point that triggers loading this file.
- **Cursor invariant.** `stages.explorer.last_task` reflects the highest task index whose annotation was successfully appended to $BUNDLE_EXPLORATION_FILE. On resume, `cursor = last_task + 1` (or the user-specified `from T<N>`, whichever is provided).
- **Failed tasks do not halt the stage.** Bundle mode prefers forward progress — failures are recorded in `failed[]` for downstream agents to handle. Halt only on infrastructure errors (e.g., $BUNDLE_LLD_FILE missing).
- **Codebase-map sync runs once.** Single-story Phase 1.5 (sync_map) runs once at the start of the bundle, not per task. All bundled tickets share the same `last_synced_by`.
