---
name: bundle-task-allocator
description: Task allocation rules for BUNDLE MODE. Maps generated per-ticket task lists into ONE consolidated task list with `Sources: <ticket-list>` per row, dedups overlapping ACs across tickets, applies layer-and-dependency ordering (the locked default per Q2 = b), and computes intra-bundle Depends-on edges. Used by bundle-orchestrator (LLD synthesis) and bundle-surgeon (resume cursor validation). Never loaded by single-story flow.
---

# Bundle Task Allocator

This skill defines two algorithms:

1. **Attribution** — given N per-ticket task lists, produce ONE consolidated, deduplicated, source-tagged task list.
2. **Ordering** — given the consolidated list, apply layer-and-dependency sort (default `layer_dep`) so tasks execute in an order that respects build/runtime dependencies.

It is loaded by `bundle-orchestrator.md` at Phase B.3 and by `surgeon.md`'s bundle branch at resume-cursor validation. Single-story flow uses the regular pack `lld_generator` task generation unchanged.

## 1. Attribution algorithm

**Input:** A map `{ticket_id → [task]}` where each `task` is a tuple `(description, layer, verify_by, hints)` produced by the regular pack LLD generator.

**Output:** An ordered list of `(T#, description, sources[], layer, verify_by[], hints, depends_on[])`.

### Step 1 — collect

```
all_tasks = []
FOR ticket_id, tasks in input.items():
  FOR task in tasks:
    all_tasks.append({
      sources:   [ticket_id],
      desc:      task.description,
      layer:     task.layer,
      verify_by: task.verify_by,                   # AC@ticket strings
      hints:     task.hints,
    })
```

### Step 2 — dedup overlapping tasks

Two tasks are merge candidates when:

1. Same `layer` AND
2. Same `head_verb` (first verb of description, lemmatized) AND
3. ≥ 60% Jaccard overlap on the noun-phrase set in their descriptions AND
4. Their projected file paths (extracted from `hints` or layer placement rules) overlap on at least one path

When all four hold, merge:

```
merged = {
  sources:   union(a.sources, b.sources),                    # multi-ticket attribution
  desc:      best_descriptor(a.desc, b.desc),                # take the more specific
  layer:     a.layer,
  verify_by: union(a.verify_by, b.verify_by),
  hints:     merge_hints(a.hints, b.hints),                  # keep all unique hints
}
```

`best_descriptor` picks the longer description (more specific is preferred). On ties, keep the first one (lowest source ticket ID after canonical sort).

**Conservative dedup:** when in doubt, DO NOT merge. A false-merge is worse than a duplicate task because surgeon may implement only one ticket's intent and miss the other's.

### Step 3 — promote shared-asset tasks

For each entry in `cross_findings.shared_assets`, find the candidate task that creates the asset and add the consumer tickets to its `sources[]` list:

```
FOR asset in cross_findings.shared_assets:
  creator_task = find_task_creating(asset.path)
  IF creator_task is not None:
    creator_task.sources = union(creator_task.sources, asset.consumer_tickets)
```

This makes downstream review's per-ticket AC compliance work correctly: when T2 creates `dateValidationService.js` consumed by tickets PROJ-1234, PROJ-5533, PROJ-2344, T2's `sources` becomes `[PROJ-1234, PROJ-5533, PROJ-2344]` and T2 contributes to all three tickets' AC coverage.

### Step 4 — compute Depends-on edges

```
FOR each task t in all_tasks:
  t.depends_on = []
  FOR each layer-lower task u in all_tasks where u != t:
    IF t.hints reference u.projected_file
       OR t.verify_by reference any AC that depends on u's deliverable:
      t.depends_on.append(u.id)
```

Dependency direction:
- DB tasks → none
- Backend service tasks → DB tasks they read/write
- REST endpoint tasks → backend service tasks they delegate to
- Frontend service tasks → REST endpoint tasks they call
- Component tasks → frontend service tasks they consume
- Template tasks → component tasks they reference
- Config tasks → none (or whatever components they configure, if any)

Surgeon validates this graph at resume — if `last_task` was T7 with `depends_on: [T2, T4]`, surgeon refuses to proceed unless T2 and T4 are present in the manifest with build-PASS.

## 2. Ordering algorithm — `layer_dep` (default)

**Layer priority (lowest first — implemented first):**

```
layer_priority = [
  "db",                           # schema, migrations
  "backend.persistence",          # DAOs, repositories, ORM mappings
  "backend.services",             # business logic
  "backend.utilities",            # cross-cutting helpers
  "backend.rest_endpoints",       # HTTP boundaries
  "frontend.services",            # API clients, state services
  "frontend.ui_elements",         # shared components
  "frontend.templates",           # page-level templates / route components
  "config",                       # i18n keys, feature flags, deployment config
  "tests",                        # if not folded into source layers
]
```

These keys MUST exist in `skills.layer_map` of the active pipeline config. If a task's `layer` is not in `layer_priority`, it sorts last (alphabetically) with a warning logged to chat.

**Sort key:**

```
sort_key(t) = (
  layer_priority.index(t.layer),                     # primary
  min_source_ticket_index(t.sources),                # secondary (deterministic)
  t.original_index,                                  # tertiary (preserve relative order)
)
```

`min_source_ticket_index` looks up the ticket ID in the bundle's `tickets[]` (sorted) array. This makes ordering deterministic: re-running the same bundle gives the same task numbers.

**After sort:** assign T1..Tn in order. Persist task numbers in $BUNDLE_LLD_FILE PART 2.

## 3. Alternative orderings

### `by_story`

```
sort_key(t) = (
  min_source_ticket_index(t.sources),                # primary
  layer_priority.index(t.layer),                     # secondary
  t.original_index,
)
```

All tasks for the first ticket run first (in layer order within that ticket), then all tasks for the second ticket, etc. Friendly for halt-and-ship-partial scenarios — full tickets complete in order. Trade-off: shared-asset tasks may not run early enough for consumers in later tickets, leading to import errors.

### `phase_a`

Use the order specified verbatim in `cross_findings.recommended_order`. This is what bundle-orchestrator A.4 produced. Useful when Phase A's analysis (especially `--deep`) found a non-obvious ordering that beats `layer_dep`.

The chosen ordering is set by `runtime.bundle.task_ordering` in pipeline config. v1 ships `layer_dep` as the default and exposes the others via config (no per-run flag).

## 4. Test-task allocator (PART 4)

Test tasks use the same algorithm with two adjustments:

1. Numbering uses `TT` prefix (`TT1..TTn`) to keep distinct from surgeon's `T#` cursors in `_bundle-state.yaml`.
2. Layer priority uses `tests` keys: `db.tests`, `backend.tests`, `frontend.tests`, `e2e.tests` — fall back to the source-task's layer if a test-specific key is absent.

Cross-ticket integration tests (tests that exercise interactions between bundled tickets) get explicit `Sources: <multi-ticket-list>` and are placed in their own subsection of PART 4.

## 5. Invariants the allocator must preserve

- **No AC dropped.** Sum of `verify_by` across all tasks ⊇ AC Registry. Bundle-orchestrator validates this in B.6 (validation step) before writing files. If an AC has no covering task, halt with: `⛔ AC <id>@<ticket> has no covering task. Generation bug — re-run B.3 with --debug-allocator.`
- **Source preservation.** Every original (per-ticket) task is reachable via `sources[]` of some consolidated task. Validation: `len(union(t.sources for t in consolidated)) == N (count of tickets)`.
- **Determinism.** Same input → same task numbers. The hash short used for `BUNDLE_ID` derives from sorted ticket IDs; combined with deterministic sort, re-running on the same inputs gives the same `T#` assignments. This is what makes resume safe.
- **Cycle-free dependencies.** `depends_on` edges form a DAG. Detect cycles in B.6 and halt with: `⛔ Task dependency cycle detected: T<a> ↔ T<b>. Re-run B.3 with --debug-deps.`
