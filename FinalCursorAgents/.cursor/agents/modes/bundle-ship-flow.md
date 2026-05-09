---
name: bundle-ship-flow
description: Ship's bundle-mode flow — one PR closing all bundled tickets, per-ticket JIRA transitions, $BUNDLE_SUMMARY_FILE generation. Loaded ONLY when ship.md detect_bundle_mode (0d) finds frontmatter.mode == "bundle" in the resolved $CONTEXTS_FILE. Single-story flow never reads this file.
---

# Ship — Bundle Mode Flow

**Load ONLY when `detect_bundle_mode (0d)` in `ship.md` sets `{bundle_mode} = true`.** Single-story and bug flows never read this file.

By the time control reaches this file, the calling agent has already resolved:
- `{BUNDLE_ID}`, `{bundle_tickets}` (from `$CONTEXTS_FILE` frontmatter)
- All `$BUNDLE_*` paths per `agent-flow.mdc § Procedure C`
- `{bundle_state}` (from `$BUNDLE_STATE_FILE`)
- `{context_pressure}` config + `{context_estimated_tokens}` running counter (per `agent-flow.mdc § Context Pressure Detection`)

**⚠ Pressure-aware — EXTRA STRICT for ship (applies to Phase 0 start, verdict gate, publish gate, final gate):**
- YELLOW → prepend banner
- ORANGE → render ORANGE template (resume: `Resume bundle-ship for {BUNDLE_ID}`)
- RED → render RED template + HALT, AND **refuse to invoke ANY git op (commit / push / PR open) or JIRA transition until the user overrides via `Override pressure halt — I accept the risk` AND re-confirms with `Go` at the start-of-stage gate**. Ship is destructive — a degraded-context run that pushes the wrong commit message or fires the wrong JIRA transition is much worse than the cost of handing off to a fresh chat.

The double-confirmation under RED for ship is intentional. Override + Go is two explicit user actions; this prevents an accidental override from immediately triggering destructive ops.

Standard gate templates below assume GREEN — substitute per routing above when zone differs.

---

## Pre-flight (bundle)

```
1. Verify $BUNDLE_STATE_FILE exists. If missing → HALT.
2. Verify stages.review.status == "done". If not:
   ⛔ HALT: "Bundle-review did not complete. Run:
     @bundle-review.md Run the bundle review"
3. Read $BUNDLE_REVIEW_FILE → parse "Per-Ticket AC Compliance" table → {ticket_verdicts}.
4. Read overall verdict from review report.
5. Read $BUNDLE_MANIFEST_FILE → list of all changed files (for diff/commit grouping).
```

## Bundle phase 0 — start-of-stage gate (⛔ MANDATORY HALT)

> 🛑 **THIS GATE IS MANDATORY.** After pre-flight succeeds, render the gate below and **STOP**. Do NOT call `git commit`, do NOT call `git push`, do NOT open a PR, do NOT fire any JIRA transition until the user types `Go`. Ship is the most consequential step in the pipeline; the user must explicitly authorize it. Skipping this gate is a bug — and an unauthorized PR/commit is destructive (see § Executing actions with care).

```
## [Step 5/5] Bundle Ship — ready to ship

**Bundle:**         {BUNDLE_ID}
**Tickets ({N}):**  {comma-list}
**Overall verdict:** {YES | NO | PARTIAL}
**Files in PR:**    {len(manifest_rows)} ({list of paths or "see $BUNDLE_MANIFEST_FILE"})
**Will:**           commit Surgeon's working-tree changes against {bundle_branch}, push to remote, open ONE PR closing all {N} tickets, fire JIRA transition once per ticket, write {BUNDLE_SUMMARY_FILE}.
**Commit grouping:** {flags.each ? "one_per_ticket (auto, --each mode) — one commit per source ticket" : "asked at Phase 2 (default: one_per_task)"}

> 👉 Pick one (REPLY REQUIRED — ship HALTS until you do):
> - `Go` — proceed to verdict gate (Phase 1) and onwards
> - `Show $BUNDLE_REVIEW_FILE` — print review verdict before deciding
> - `Cancel` — halt; nothing committed, nothing pushed, no PR, no JIRA transitions
```

On `Go`: proceed to Phase 1 (overall verdict gate). On `Cancel`: leave state as-is and halt; user can re-trigger ship later.

## Bundle phase 1 — overall verdict gate

```
overall = {ticket_verdicts}.overall  # YES | NO | PARTIAL

IF overall == "NO":
  ⛔ HALT: "Bundle review verdict is NO. Cannot ship.
    Resume surgeon at the failing tasks:
      Resume bundle-surgeon for {BUNDLE_ID} from T<N>
    Then re-run review."

IF overall == "PARTIAL":
  partial_policy = pipeline_config.runtime.bundle.partial_ship_policy  # default: ask

  IF partial_policy == "halt":
    ⛔ HALT: "Per partial_ship_policy=halt: bundle has unmet ACs in {ticket-list}.
      Resolve before shipping."

  IF partial_policy == "ask" (default per Q3):
    Render gate (template below) and wait for user decision.

  IF partial_policy == "ship_passed":
    Auto-decide: passing tickets get JIRA transitions; failing tickets stay in
    pre-bundle state. Their PR body section is marked "(deferred — fix-forward)".

IF overall == "YES":
  Proceed straight to Phase 2.
```

**PARTIAL gate template:**

```
## [Step 5/5] Bundle Ship — Partial verdict

**Bundle:**     {BUNDLE_ID}
**Overall:**    PARTIAL
**Per-ticket:**
  ✓ {ID-1}: YES (all ACs covered)
  ⚠ {ID-2}: PARTIAL (3 of 5 ACs covered)
  ✗ {ID-3}: NO (build failed on T7)

> ⚠ Some tickets did not meet their ACs. Pick one:
> 1. `Halt and fix`
>    → Stop here. Resume surgeon at T<lowest-failing>:
>      `Resume bundle-surgeon for {BUNDLE_ID} from T<N>`
> 2. `Ship passing tickets only`
>    → Create PR closing only the YES tickets. Failing tickets remain in
>      their pre-bundle JIRA state. Requires explicit "Confirm ship-passed".
>    (Note: PR still contains all merged code — the distinction is only
>     in JIRA transitions and PR body labeling.)
> 3. `Ship anyway with gaps`
>    → Create PR closing ALL tickets including PARTIAL/NO ones, but JIRA
>      transitions fire ONLY for YES tickets. PR body flags the gaps as
>      "fix-forward in follow-up commits". Requires "Confirm ship-anyway".
> 4. `Inspect $BUNDLE_REVIEW_FILE` — show per-task review findings.
```

User picks option 1/2/3 explicitly. Default: option 1 (halt) on Enter.

## Bundle phase 2 — show_state + commit strategy

Reuse the existing `show_state (1)` and `ask_commit_strategy (2)` steps with these adjustments:

- The diff shown spans ALL files in $BUNDLE_MANIFEST_FILE.
- Commit strategy adds bundle-specific options:

```
> Pick a commit strategy:
>   a) one_per_ticket  — one commit per source ticket, message prefixed with ticket ID
>   b) one_per_task    — one commit per task, message prefixed with primary source ticket
>   c) one_per_layer   — group commits by layer (DB → backend → frontend → ...)
>   d) one_giant       — single squashed commit for the whole bundle (NOT recommended)
```

Default:
- `flags.each: false` (consolidated) → `one_per_task` (current behavior — preserves git history granularity).
- **`flags.each: true` (per-story) → `one_per_ticket` (forced).** The per-story execution shape demands per-story commit grouping; mixing them makes the PR confusing. The strategy gate is suppressed under `--each` and `one_per_ticket` is auto-selected. To override, the user must clear `flags.each` from state first.

## Bundle phase 3 — execute_commits

Behavior depends on the chosen strategy.

### Strategy: `one_per_task` (default for consolidated)

Loop $BUNDLE_MANIFEST_FILE rows in T# order. For each:

```
files = manifest_row.files
sources = manifest_row.sources                 # list of source tickets
primary_source = sources[0]                    # canonical first ticket

git add {files...}
git commit -m "[{primary_source}] {manifest_row.desc}

{If len(sources) > 1: also-relates-to: {sources[1:]}}
{Bundle: {BUNDLE_ID}}
"
```

The `also-relates-to:` trailer makes shared-task commits queryable for any of the bundled tickets.

### Strategy: `one_per_ticket` (default + forced under `--each`)

Loop story_boundaries from `state.stages.surgeon.story_boundaries` in order. For each boundary:

```
boundary_rows = manifest_rows where boundary.first_t <= T# <= boundary.last_t
files         = unique(flatten(row.files for row in boundary_rows))
ticket        = boundary.ticket           # may be SHARED for the prelude

IF ticket == "SHARED":
  commit_subject = "feat(shared): {N} bundle-shared tasks for {bundle_tickets-list}"
  primary_trailer_lines = [
    "Bundle: {BUNDLE_ID}",
    "Shared-by: {comma-list of tickets that consume these tasks}",
  ]
ELSE:
  commit_subject = "feat({ticket}): {one-line summary derived from boundary_rows}"
  primary_trailer_lines = [
    "Bundle: {BUNDLE_ID}",
    "Tasks: T{boundary.first_t}..T{boundary.last_t} ({boundary.last_t - boundary.first_t + 1} tasks)",
  ]

# Per-task list goes in the body, not the subject
body = render_task_list(boundary_rows)        # markdown bulleted list, T#: desc per line

git add {files...}
git commit -m "{commit_subject}

{body}

{primary_trailer_lines, joined with newlines}
"
```

Result: the bundle branch ends up with `len(story_boundaries)` commits, each one a coherent ticket-sized unit. `git log --grep="^feat(PROJ-1234):"` finds a single commit covering everything done for that ticket.

**One PR invariant holds.** All commits are pushed to the same branch (`{bundle_branch}`); Phase 5 opens ONE PR for the whole branch — Phase 3 just shapes the commit history inside it. The PR body's per-ticket sections (Phase 5 template) align with the per-ticket commits when `--each` is set.

## Bundle phase 4 — pre-push checklist

Reuse the existing pre-push checklist (Step 4 in single-story flow) with bundle additions:
- Show ALL bundled tickets and their per-ticket sub-verdict from review.
- Show the bundle branch name + base.
- Show the proposed PR title (one line listing primary tickets).
- Wait for explicit "Push" confirmation.

## Bundle phase 5 — push + create one PR

```
git push -u origin {branch}

# PR body — concatenated per-ticket sections:
pr_title = "[Bundle] {primary-ticket} + {N-1} more — {epic-title}"
# OR if list_form branch: "[Bundle] {ID-1}, {ID-2}, {ID-3} — {epic-title}"

pr_body = render("""
# Bundled story PR

**Bundle ID:** {BUNDLE_ID}
**Epic:** {EPIC_ID}
**Tickets ({N}):**
- ✅ {ID-1} — {title} (all ACs covered)
- ⚠ {ID-2} — {title} (3 of 5 ACs covered — see review)
- ✗ {ID-3} — {title} (deferred — fix-forward)

## Verification
- Build: {verdict}
- Tests: {pass}/{total}
- Per-task review: see $BUNDLE_REVIEW_FILE in repo

## Per-Ticket AC Compliance
{table from $BUNDLE_REVIEW_FILE}

## Files Changed ({N})
{file list, grouped by layer}

## Test Plan
{summary from $BUNDLE_TESTPLAN_FILE PART 3}

Closes {ID-1}
{If shipping all: } Closes {ID-2}, {ID-3}, ...
{If ship_passed/ship_anyway: only Closes for YES tickets}

🤖 Generated by bundle-ship pipeline
""")

# Use vcs MCP (resolved per mcp_roles.vcs) for PR creation; fall back to gh CLI.
```

## Bundle phase 6 — JIRA transitions + label re-apply (per ticket)

For every ticket in {bundle_tickets} ∪ {review_only_roster}, do BOTH the status transition AND the label re-apply (idempotent).

```
# 6a — JIRA status transition (existing behavior)
ticket_subverdict = {ticket_verdicts}[ticket]

IF ticket_subverdict == "YES":
  story_source.transition(ticket, jira.status_map.ship_done)
  story_source.add_comment(ticket, "PR: {pr_url} (bundled with {others})")

ELIF ticket_subverdict == "PARTIAL" AND user_chose == "ship_anyway":
  # Don't transition; add comment only.
  story_source.add_comment(ticket, "Bundle PR: {pr_url} contains partial work for this ticket. Fix-forward expected.")

ELIF ticket_subverdict == "NO" OR (PARTIAL AND ship_passed):
  # No transition; ticket stays in pre-bundle status.
  # Optional: post a "deferred" comment.
  IF user_chose == "ship_passed":
    story_source.add_comment(ticket, "Excluded from bundle PR {pr_url}; deferred for follow-up.")

# 6b — JIRA label re-apply (NEW; idempotent — runs even if C.4.5 already applied)
# Skip if jira_labels_config.enabled == false.
# Skip if jira_labels_config.apply_at == "orchestrator_c4" (early-only, no ship retry).
IF jira_labels_config.enabled AND jira_labels_config.apply_at IN ("ship_phase6", "both"):
  intended_labels = compute_label_set_for(ticket, jira_labels_config, {bundle_tickets},
                                           {review_only_roster}, {skipped_by_evidence}, BUNDLE_ID)
                    # same logic as bundle-orchestrator C.4.5 — extracted to a helper below

  TRY:
    story_source.update_issue(ticket, update={"labels": [{"add": L} for L in intended_labels]})
    Record in state.stages.ship.labels_applied[ticket] = intended_labels
  EXCEPT (mcp_error, network_error):
    Record in state.stages.ship.label_apply_failures.append({ticket, labels: intended_labels, reason})
    Continue — do NOT block the ship gate on label failure.

  # Reconciliation: if state.stages.orchestrator.label_apply_failures had entries for
  # this ticket, mark them resolved here when the ship retry succeeds.
  IF this ticket previously failed at C.4.5:
    Remove from state.stages.orchestrator.label_apply_failures.

# Honor jira.on_failure. Do NOT block the ship gate on JIRA failure (transition or label).
```

**Helper — `compute_label_set_for(ticket, config, tickets, review_only, skipped, BUNDLE_ID)`:**

```
prefix = config.prefix
mode   = config.mode
targets = tickets
IF config.include_review_only:           targets += review_only
IF config.include_skipped_by_evidence:   targets += skipped

SWITCH mode:
  CASE "all_tickets":   return [ "{prefix}{t}" for t in targets ]
  CASE "siblings":      return [ "{prefix}{t}" for t in targets if t != ticket ]
  CASE "bundle_id":     return [ "{prefix}{BUNDLE_ID upper}" ]
  CASE "both":          return [ "{prefix}{BUNDLE_ID upper}" ] + [ "{prefix}{t}" for t in targets ]
```

Same helper used by bundle-orchestrator C.4.5; defined here to keep the spec close to where it's used. The two callers must produce identical output for any (ticket, bundle composition) pair — that's what makes the apply idempotent.

## Bundle phase 7 — write $BUNDLE_SUMMARY_FILE

The "what got addressed" doc. Path: `$BUNDLE_CONTEXT_DIR + {BUNDLE_ID} + "-summary.md"`.

```markdown
# Bundle Summary — {BUNDLE_ID}

**Epic:** {EPIC_ID}
**Tickets:** {N}
**Branch:** {branch}
**PR:** {pr_url}
**Shipped at:** {ISO8601}

## Per-Ticket Status

| Ticket | Title | Verdict | ACs | PR | JIRA Status | JIRA Labels |
|---|---|---|---|---|---|---|
| {ID-1} | {title} | YES | {N}/{N} | {pr_url} | {status_map.ship_done} | {comma-list of labels_applied[ID-1]} |
| {ID-2} | {title} | PARTIAL | 3/5 | {pr_url} | (unchanged — deferred) | {labels} |
| {ID-3} | {title} | NO | 0/3 | — | (unchanged) | {labels} |

{If state.stages.ship.label_apply_failures is non-empty, render this section:}

## ⚠ Label apply failures (manual fix-up needed)
| Ticket | Labels that failed | Reason | Manual fix command |
|---|---|---|---|
| {id} | {label-list} | {error} | Apply via JIRA UI: `Settings → Labels → add: {labels}` |

## Files Changed (consolidated)
{file list, grouped by layer, with originating tickets}

## Tests Added
- Unit: {N}
- Integration: {N}
- E2E: {N}
- Cross-ticket: {N}

## Shared Assets Created
- {asset 1} at {path} — used by tickets {list}
- ...

## Token Cost (this bundle)
{aggregate from <!-- TOKEN_USAGE: --> comments across all bundle artifacts}

## Resume Audit
- Orchestrator: {duration}
- Explorer: {duration}, {checkpoints} checkpoints
- Surgeon: {duration}, {checkpoints} checkpoints, {failed_count} failed tasks
- Review: {duration}, {checkpoints} checkpoints
- Ship: {duration}
```

If `mcp_roles.docs_publish` is configured, publish $BUNDLE_SUMMARY_FILE the same way C.5b publishes the LLD.

## Bundle phase 8 — update $CODEBASE_MAP + $BUNDLE_STATE_FILE

For each ticket whose subverdict is YES:
- Append `STORY_SHIPPED` to `$CODEBASE_MAP` story_log with the ticket ID.
- Increment `stories_completed`.

Update `$BUNDLE_STATE_FILE`:

```yaml
stages:
  ship:
    status: done
    completed_at: {ISO8601}
    pr_url: {pr_url}
    commits: [<sha1>, <sha2>, ...]
    transitioned_tickets: [<list of YES tickets only>]
    deferred_tickets:     [<list of PARTIAL/NO tickets>]
last_activity_at: {ISO8601}
```

## Bundle phase 9 — final gate

```
## [Step 5/5] Bundle Ship — DONE ✅

**PR:** {pr_url}
**Branch:** `{branch}`
**Commits:** {N}
**Bundled tickets:** {N} ({yes_count} closed, {partial_count} partial, {no_count} deferred)

✅ Bundle pipeline complete.

> **👉 Suggested next steps:**
> - Share PR with team for review
> - {If partial/deferred:} Plan a follow-up bundle/single-story for: {deferred-ticket-list}
> - {If summary published:} See published summary at {url}
```

## Rules — Bundle mode (Ship)

- **One PR per bundle, regardless of ticket count.** No per-ticket branching, no per-ticket PR.
- **JIRA transitions are per-ticket** but route through the same `vcs` MCP for the PR. Failed JIRA transitions are non-fatal (existing `jira.on_failure` policy applies).
- **Codebase-map increments per shipped ticket.** A bundle that shipped 3 of 5 tickets increments `stories_completed` by 3.
- **The summary doc is mandatory in bundle mode** (unlike single-story where post-ship summary is optional). It's the cross-ticket audit artifact.
- **Single-story flow is unreachable from bundle mode.** The `{bundle_mode} = true` flag in `ship.md` is the sole entry point that triggers loading this file.
