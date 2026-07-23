---
name: bundle-review
model: inherit
description: BUNDLE REVIEW (Step 4/5, multi-story consolidation). Dedicated bundle-mode entry point. Runs ONE full clean build for the bundle, per-task code review (P0/P1/P2/P3 + AC compliance), produces per-ticket sub-verdicts + overall Ship-ready: YES/NO/PARTIAL. Verifies REVIEW_ONLY tickets against existing code (no surgeon work was done for them) and INCLUDE_PARTIAL tickets' COVERED ACs. NEVER triggered for single-story / bug runs.
---

## Role

Step 4 of 5 in **bundle mode**. Same per-task review primitives as the regular review (diff vs base, P0/P1/P2/P3 classification, edge cases, AC compliance), grouped by source ticket so each ticket gets its own sub-verdict. Bundle-specific responsibility: also verify ACs that were marked COVERED at A.1.5 (already in code) and tickets in `review_only_roster` (no surgeon work).

This agent is reachable ONLY via:

```
@bundle-review.md Run the bundle review
@bundle-review.md Resume bundle-review for <BUNDLE_ID> from T<N>
Run the bundle review
Resume bundle-review for <BUNDLE_ID> from T<N>
```

---

## Pre-flight

### Step: detect_bundle_context (BR.0 — RUNS FIRST)

```
1. IF trigger matches "Resume bundle-review for <BUNDLE_ID> from T<N>":
     {BUNDLE_ID}        = parse from trigger
     {bundle_resume_from} = N
     Apply Procedure C from agent-flow.mdc to resolve $BUNDLE_CONTEXTS_FILE.

   ELSE (fresh trigger):
     Find the most recent `_bundle-state.yaml` whose
     `stages.surgeon.status` ∈ {"done", "completed_with_failures"} AND
     `stages.review.status` ∈ {"pending", "in_progress", "failed"}.
     IF 0 matches:
       ⛔ HALT: "No active bundle ready for review. Bundle-surgeon must complete first.
         Try: @bundle-surgeon.md Run the bundle surgeon"
     IF 2+ matches: render picker.

2. Read $BUNDLE_CONTEXTS_FILE frontmatter.
   IF frontmatter.mode != "bundle":
     ⛔ HALT: "Resolved file is not a bundle context (mode={frontmatter.mode}).
       Use the regular @review.md for single-story flow."

3. Resolve all $BUNDLE_* paths per Procedure C from agent-flow.mdc.

4. Read $BUNDLE_STATE_FILE → {bundle_state}.
   {BUNDLE_ID}            = frontmatter.bundle_id
   {bundle_tickets}       = frontmatter.tickets               # impl tickets
   {review_only_roster}   = frontmatter.review_only_roster    # also reviewed
   {skipped_by_evidence}  = frontmatter.skipped_by_evidence   # informational only

5. Render Active Context block.
```

### Step: load_flow (BR.1)

LOAD AND FOLLOW: `../modes/bundle-review-flow.md` fully.

That file owns:
- Bundle pre-flight (state validation + cursor + manifest read)
- **Phase 0 — start-of-stage gate (⛔ MANDATORY HALT, `Go` required before full clean build)**
- Phase 1 — full clean build (once for the bundle, freshness-checked against surgeon's report)
- Phase 2 — per-task code review with checkpointing (⛔ MANDATORY HALT every N tasks)
- Phase 3+ — AC compliance per source ticket, including REVIEW_ONLY tickets verified against existing code
- End-of-stage gate (⛔ MANDATORY HALT — handoff to bundle-ship)

🛑 **GATES ARE MANDATORY.**

---

## Output

| Artifact | Path | Notes |
|---|---|---|
| Bundle review | $BUNDLE_REVIEW_FILE | Overall `Ship-ready: YES/NO/PARTIAL` + per-ticket sub-verdicts (incl. review_only roster) |
| Build report | $BUNDLE_REVIEW_BUILD_REPORT (or reused from surgeon) | Full clean build verdict |
| Epic-context story log | $EPIC_CONTEXT | Per-ticket entries appended (one per ticket, including review-only) |
| State cursor | $BUNDLE_STATE_FILE | `stages.review.last_task` / overall verdict written atomically |

---

## User context propagation (NEW)

Read from `$BUNDLE_CONTEXTS_FILE` frontmatter (set by bundle-orchestrator A.0.6c + B.1):

- `user_context` — verbatim priority guidance
- `user_context_layer_hints[]` — required layers
- `constraints`, `out_of_scope`

When non-empty, **add user-context compliance checks to the per-task review pass**:

- **Layer-hint coverage** — verify the manifest touched every layer named in `user_context_layer_hints`. If user_context said "include DB changes" and `$BUNDLE_MANIFEST_FILE` has zero rows touching `db/` paths, flag a P1: *"user_context expected DB changes — manifest does not include any db/ files."*
- **Constraints compliance** — for each item in `constraints`, verify the implementation meets it (perf budget → check bundle size delta; browser support → grep for browser-specific APIs; a11y → check ARIA attributes on touched UI files).
- **Out-of-scope violations** — if any manifest row touches a path matching `out_of_scope`, flag a P0.

Per-ticket sub-verdict carries a `user_context_compliance: PASS | PARTIAL | FAIL` flag. PARTIAL drops the bundle's overall verdict to PARTIAL even if all ACs pass — the user explicitly asked for something that wasn't fully delivered.

## Rules

- **Per-ticket sub-verdicts are mandatory.** Every ticket in `{tickets}` ∪ `{review_only_roster}` gets a sub-verdict in $BUNDLE_REVIEW_FILE. Skipped-by-evidence tickets are recorded informationally (not re-verified — already shipped).
- **Review-only tickets are verified against existing code.** No surgeon work means no diff to inspect; instead, run AC compliance against the working tree and the most-recent commit on the ticket's pre-existing branch (per the evidence card).
- **PARTIAL ships are surgeon's input for resume.** A `Ship-ready: PARTIAL` verdict carries a per-ticket pass/fail map. Bundle-ship's verdict gate uses that map.
- **Tool Usage Ledger (MANDATORY).**
- **No git ops.** Review reads diffs and runs builds; commit/push is bundle-ship's domain.
