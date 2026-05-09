---
name: bundle-lld-generator
description: Consolidated LLD synthesis rules for BUNDLE MODE. Defines the shape of $BUNDLE_CONTEXTS_FILE / $BUNDLE_LLD_FILE / $BUNDLE_TESTPLAN_FILE — per-story Requirement Summary stacked, cross-ticket Architecture section, AC Registry with Source: <ticket> on every row, layer-and-dependency task ordering, conflict surfacing. Loaded only by bundle-orchestrator.md. Single-story flow uses the pack's regular lld_generator skill unchanged.
---

# Bundle LLD Generator

Bundle mode produces ONE consolidated 3-file LLD that covers every selected ticket. This skill defines the exact shape so bundle-orchestrator and downstream bundle-aware agents read/write the same structure.

## Why a separate skill

Bundle mode is structurally different from single-story mode:

- ACs come from N tickets, not one. The registry needs `Source:` provenance.
- Tasks span tickets. Many tasks have one source; some serve multiple via shared assets.
- Test plans are merged but cross-ticket integration tests need their own section.
- Conflicts between tickets must surface in the LLD itself (not just in chat) so downstream agents see them when reading the file fresh.

The pack's regular `lld_generator` skill is preserved untouched and continues to drive single-story flow.

## File 1 — `$BUNDLE_CONTEXTS_FILE` (main entry doc)

Required sections, in order:

```markdown
---
mode: bundle
bundle_id: <BUNDLE_ID>
epic: <EPIC_ID>
tickets: [<sorted ticket IDs>]
base_branch: <name>
created_at: <YYYY-MM-DD>
cross_epic: <true | false>
---

# BUNDLED REQUIREMENT SUMMARY (<N> stories)

# EPIC FRAMING
- Vision (from PRD): ...
- Architecture (from HLD): ...
- Spike Outcomes: ...
- Cross-Story Boundaries:
  - ✅ In scope across the bundle: ...
  - ❌ Out of scope across the bundle: ...
  - ⚠ Inherited constraints (HLD/PRD): ...

# TICKET ROSTER

| Ticket | Title | Status | ACs | Components | Layer Hints |
|---|---|---|---|---|---|

# REQUIREMENT SUMMARIES (per-ticket)

## <TICKET-1> — <title>
{full Requirement Summary, same template as today's single-story $CONTEXTS_FILE}

## <TICKET-2> — <title>
{...}

# CROSS-TICKET FINDINGS

## Shared Assets (proposed)
- <asset name> — for: <AC@ticket>, <AC@ticket>, ...

## Conflicts (must resolve before Surgeon)
- <description> — see <AC@ticket> vs <AC@ticket>

## Reuse Opportunities (from --deep)
- <existing file> matches <AC@ticket> pattern

## Recommended Order (layer-and-dependency)
1. <ticket> (<layer-summary>) — <N> ACs
2. ...

# ENRICHED AC REGISTRY (cross-ticket)

| AC | Source | Intent | Required Coverage | Visual Spec |
|---|---|---|---|---|

# COMPANION FILES
- LLD:        <BUNDLE_LLD_FILE>
- Test Plan:  <BUNDLE_TESTPLAN_FILE>
- State:      <BUNDLE_STATE_FILE>

<!-- TOKEN_USAGE: agent=bundle-orchestrator input=<N> output=<N> total=<N> -->
```

**Required AC Registry columns:** `AC`, `Source`, `Intent`, `Required Coverage`. The `Visual Spec` column is `—` for any AC whose source ticket has no design assets, or a reference like `frame-2.png#button-save` pointing into that ticket's per-ticket design folder.

**AC dedup rule:** When two tickets have semantically-equivalent ACs (same intent verb + same noun phrase), keep BOTH rows in the registry. Mark the second one with `(dedup-candidate of <AC>@<source>)` in the `Required Coverage` column. The decision to actually merge into one task happens in PART 2, not in the registry. Keeping both rows preserves per-ticket AC coverage tracking for Review.

## File 2 — `$BUNDLE_LLD_FILE` (PART 1 + PART 2)

```markdown
# PART 1 — CONSOLIDATED LLD DESIGN

## Cross-Ticket Architecture
{2–4 paragraphs: bundle-level design narrative, dependency direction, shared asset
 boundaries, NFR honoring map. THIS IS WHAT THE EXISTING `epic-context.md` Story
 Roster references.}

## Per-Ticket Designs

### <TICKET-1> — <title>
{Per-ticket design — same template as today's PART 1 in single-story mode}

### <TICKET-2> — <title>
{...}

## Shared Assets (concrete decisions)
- <asset 1> at <projected file path>
  - Created by: <task ID-1>
  - Consumed by: <task ID-2>, <task ID-3>
  - Owning ticket (for review attribution): <ticket>
- ...

# PART 2 — CONSOLIDATED LLD TASKS

| T# | Description | Sources | Layer | Depends On | Verify By |
|---|---|---|---|---|---|

## Per-Task Detail

### T1 — <description>
- Sources: <ticket> [, <ticket>, ...]
- Layer: <layer-key>
- Depends on: <T# list or —>
- Verify by: <AC@ticket list>
- Insertion Point: (filled by Explorer)
- Reuse Match: (filled by Explorer)
- Explorer Notes: (filled by Explorer)
- Implementation hints: ...
```

**Task numbering invariant:** T1..Tn, no gaps, no renumbering on amend. If a task is dropped via amend, its slot is left blank in PART 2 ("T<N> — DROPPED at amend <hash>"); subsequent tasks keep their numbers. This protects bundle-state.yaml's `last_task` cursor across amendments.

**Sources field:** comma-separated ticket IDs in canonical sort order. Single-source tasks get one ID; shared tasks (per `Shared Assets` decisions) get the full list. Bundle-review groups AC compliance findings using this column.

**Layer field:** must be one of the keys in `skills.layer_map`. Used by surgeon's per-task skill loader and by the bundle task ordering algorithm.

**Depends on field:** explicit task-level dependencies. `T7` depends on `T2, T4` means surgeon must complete T2 and T4 before T7. Empty (`—`) means no intra-bundle dependencies. Used by surgeon's resume logic to validate cursor advancement.

## File 3 — `$BUNDLE_TESTPLAN_FILE` (PART 3 + PART 4)

```markdown
# PART 3 — CONSOLIDATED TEST PLAN

## Per-Ticket Test Plans

### <TICKET-1>
{Test plan — same template as today's PART 3 single-story}

### <TICKET-2>
{...}

## Cross-Ticket Integration Tests
- {test scenario covering shared asset usage across N tickets}
- ...

# PART 4 — CONSOLIDATED TEST TASKS

| TT# | Description | Sources | Layer | Verify By |
|---|---|---|---|---|

## Per-Test-Task Detail

### TT1 — <description>
- Sources: <ticket [, ticket]>
- Layer: <test-layer-key>
- Verify by: <AC@ticket list>
- Test framework: <e.g. Jasmine, JUnit>
```

Test tasks use the `TT` prefix (vs surgeon's `T`) to avoid cursor collisions in `_bundle-state.yaml`.

## Cross-ticket synthesis algorithm (B.2 of bundle-orchestrator)

The "Cross-Ticket Architecture" paragraph is generated by:

1. Extract layer hits per ticket (from per-ticket Requirement Summary).
2. Compute the union of layers across the bundle.
3. For each layer present, identify whether it's a producer (creating new shared code) or a consumer (using existing or bundle-created code).
4. Compose 2–4 paragraphs:
   - Paragraph 1: bundle goal in one sentence; layer scope.
   - Paragraph 2: shared asset story (what's created, who consumes).
   - Paragraph 3: NFR/HLD honoring (which constraints apply to which tickets).
   - Paragraph 4 (optional): rollout / staging guidance for shared assets.

## Conflict surfacing rules

A conflict is detected when:

1. Two ACs across different tickets share the same `Intent` template AND the same `noun head` (lemmatized noun phrase) AND have **incompatible** `Required Coverage` values.
2. Two tickets target the same shared asset path with different signatures or behaviors.
3. Two tickets declare the same `Out of scope` item in one and `In scope` in another.

Each conflict gets a row in `## Conflicts` with:
- One-line description.
- Pointer: `<AC@ticket-A>` vs `<AC@ticket-B>` (or shared-asset path).
- Suggested resolution path: `Amend: <ticket>` to align, or `Drop <ticket>` to remove from bundle.

Conflicts MUST block Phase C until resolved. Bundle-orchestrator refuses `Go` while `## Conflicts` has at least one row.
