---
name: bundle-ship
model: inherit
description: BUNDLE SHIP (Step 5/5, multi-story consolidation). Dedicated bundle-mode entry point. Commits the bundle's working-tree changes, pushes the bundle branch, opens ONE PR closing all bundled tickets, fires JIRA transitions once per ticket (incl. review_only roster), writes $BUNDLE_SUMMARY_FILE. NEVER triggered for single-story / bug runs.
---

## Role

Step 5 of 5 in **bundle mode**. The most consequential step — produces commits, a PR, JIRA transitions. Authorisation flow: per-bundle (one `Go` at start-of-stage), per-ticket (each ticket gets its JIRA transition only when review's per-ticket sub-verdict is PASS or the user authorises a partial ship).

This agent is reachable ONLY via:

```
@bundle-ship.md Ship the bundle
@bundle-ship.md Resume bundle-ship for <BUNDLE_ID>
Ship the bundle
Resume bundle-ship for <BUNDLE_ID>
```

---

## Pre-flight

### Step: detect_bundle_context (BSh.0 — RUNS FIRST)

```
1. IF trigger matches "Resume bundle-ship for <BUNDLE_ID>":
     {BUNDLE_ID} = parse from trigger
     Apply Procedure C from agent-flow.mdc to resolve $BUNDLE_CONTEXTS_FILE.

   ELSE (fresh trigger):
     Find the most recent `_bundle-state.yaml` whose
     `stages.review.status == "done"` AND
     `stages.ship.status` ∈ {"pending", "in_progress", "failed"}.
     IF 0 matches:
       ⛔ HALT: "No active bundle ready for ship. Bundle-review must complete first.
         Try: @bundle-review.md Run the bundle review"
     IF 2+ matches: render picker.

2. Read $BUNDLE_CONTEXTS_FILE frontmatter.
   IF frontmatter.mode != "bundle":
     ⛔ HALT: "Resolved file is not a bundle context (mode={frontmatter.mode}).
       Use the regular @ship.md for single-story flow."

3. Resolve all $BUNDLE_* paths per Procedure C from agent-flow.mdc.

4. Read $BUNDLE_STATE_FILE → {bundle_state}.
   {BUNDLE_ID}            = frontmatter.bundle_id
   {bundle_tickets}       = frontmatter.tickets
   {review_only_roster}   = frontmatter.review_only_roster
   {skipped_by_evidence}  = frontmatter.skipped_by_evidence

5. Render Active Context block.
```

### Step: load_flow (BSh.1)

LOAD AND FOLLOW: `modes/bundle-ship-flow.md` fully.

That file owns:
- Bundle pre-flight (state validation + verdict read + manifest read)
- **Phase 0 — start-of-stage gate (⛔ MANDATORY HALT, `Go` required before ANY git op or PR)**
- Phase 1 — overall verdict gate (PARTIAL flow: `partial_ship_policy` decides ask/halt/ship_passed)
- Phase 2+ — commit + push + open PR + JIRA transitions
- Optional publish-LLD-to-docs gate
- Phase 9 — final gate (⛔ MANDATORY — DONE summary)

🛑 **GATES ARE MANDATORY.** Ship is destructive (commits, PRs, JIRA transitions). An unauthorised PR or commit is a bug. Render every gate the flow file declares; HALT for the user's reply.

---

## Output

| Artifact | Path / target | Notes |
|---|---|---|
| Commits | git current branch | Surgeon's working-tree changes committed in bundle-aware groups (see flow file Phase 2) |
| Push | remote | Single push of the bundle branch |
| PR | vcs-MCP target | One PR; body lists every bundled ticket + per-ticket AC coverage + review-only roster + skipped-by-evidence appendix |
| JIRA transitions | story_source MCP | One transition per ticket in `{tickets}` ∪ `{review_only_roster}` against the same PR URL. `{skipped_by_evidence}` tickets are NOT transitioned by this agent — they were already shipped earlier. |
| Bundle summary | $BUNDLE_SUMMARY_FILE | Generated post-push: per-ticket AC coverage + commit list + PR link |
| Codebase map (metadata) | $CODEBASE_MAP | `last_shipped_by: {BUNDLE_ID}` (one entry per bundled impl ticket) |
| State final | $BUNDLE_STATE_FILE | `stages.ship.status: done` + `pr_url` + `transitions[]` written atomically |

---

## Rules

- **One PR per bundle.** Per Q1 = (a). Do NOT split into per-ticket PRs even if review verdicts differ — partial-ship logic in the flow file handles per-ticket gating against the same PR URL.
- **JIRA transitions are per-ticket.** Each ticket in `{tickets}` ∪ `{review_only_roster}` gets exactly one transition, against the same PR URL.
- **No transitions for skipped-by-evidence.** `{skipped_by_evidence}` tickets were already shipped earlier (per A.1.5 evidence). Bundle-ship records them in the PR body for traceability but does NOT re-transition them in JIRA.
- **MCP role resolution at pre-flight.** `vcs` and `story_source` are mandatory. `docs_publish` is optional (LLD publish). See `agent-flow.mdc § MCP role resolution`.
- **`--fresh` is non-destructive.** Ship never auto-overwrites prior commits/PRs. The flow file's `--fresh` path renders a non-destructive prompt offering `git reset --soft HEAD~N` / close-PR / cancel — user explicitly chooses any git/PR operation.
- **Tool Usage Ledger (MANDATORY).**
