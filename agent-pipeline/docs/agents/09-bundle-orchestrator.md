# 09 — Bundle Orchestrator

## Quick Reference

### What this agent does

Bundle Orchestrator replaces the regular Orchestrator (Step 1/5) when the user wants to consolidate **multiple stories** into a single LLD + branch + PR. The single-story flow (`Work on PROJ-1234`) is unaffected and continues to use `orchestrator.md` byte-for-byte.

### Invocation modes

| Mode | Trigger | Outcome |
|------|---------|---------|
| **Explicit list** | `Work on epic stories <ID>, <ID>, <ID>` | Bundle the named tickets; warn if `parent` field disagrees (per `runtime.bundle.cross_epic_policy`). |
| **Status filter** | `Work on epic <EPIC_ID> with status="<S1>","<S2>"` | Discover children of `<EPIC_ID>` matching any of the named statuses. |
| **Status group** | `Work on epic <EPIC_ID> group=<key>` | Use `<key>` from `jira.status_groups` as the filter. |
| **Resume** | (Re-issue the original trigger) OR `Resume bundle-orchestrator for <BUNDLE_ID>` | Pick up at the next pending stage from `_bundle-state.yaml`. |
| **Standalone** | — not supported | (Bundle is a pipeline-only feature.) |

Optional flags: `--deep` (Phase A grep-based overlap analysis), `--max=<N>` (override `runtime.bundle.max_tickets`), `--fresh` (ignore prior state, re-synthesize), `--offline` / `--skip <names>` / `--only <names>` (MCP role overrides — same as single-story flow).

### Example commands

```
Work on epic stories IIQMAH-1234, IIQWIW-2233, IIQDDS-3433
Work on epic IIQMAG-4567 with status="Ready for Dev","In Progress"
Work on epic IIQMAG-4567 group=ready_for_dev
Work on epic IIQMAG-4567 group=ready_for_dev --deep
Work on epic IIQMAG-4567 with status="Ready for Dev" --max=5
Resume bundle-orchestrator for iiqmag-4567-bundle-a3f2
```

### What it reads

| From `pipeline.yaml` | Why |
|---|---|
| `runtime.bundle.*` | Master switch + sizing caps + checkpoint cadence + branch naming + epic-framing toggles |
| `jira.status_groups` / `jira.status_map` | Validate user-supplied status values; resolve `group=<key>` triggers |
| `runtime.branching.base_branch` / `stacking` | Bundle branch derivation |
| `mcp_roles.story_source` / `docs_source` / `vcs` / `docs_publish` | MCP routing per role (epic doc fetch, ticket fetch, optional LLD publish) |
| `skills.orchestrator.{ticket_schema_story,lld_generator,ac_templates_intent_aware}` | Reused per-ticket inside Phase A.3 — same as single-story orchestrator |
| `skills.layer_map` | Layer ordering for `task_ordering: layer_dep` |

### Skills it loads (NEW)

- `bundle-lld-generator.md` — consolidated 3-file LLD shape (Epic Framing, Ticket Roster, cross-ticket AC Registry, Conflicts block)
- `bundle-task-allocator.md` — attribution + `layer_dep` ordering + dependency graph + invariants

### What it writes

| Output | Content |
|---|---|
| `$BUNDLE_CONTEXTS_FILE` (`<epic>/<BUNDLE_ID>.md`) | `mode: bundle` frontmatter + Bundled Requirement Summary + Epic Framing + Ticket Roster + Per-Ticket Summaries + Cross-Ticket Findings + cross-ticket AC Registry + Companion index |
| `$BUNDLE_LLD_FILE` (`<epic>/<BUNDLE_ID>-lld.md`) | PART 1 Cross-Ticket Architecture + Per-Ticket Designs + Shared Assets + PART 2 Consolidated Tasks (every row tagged `Sources: <ticket-list>`) |
| `$BUNDLE_TESTPLAN_FILE` (`<epic>/<BUNDLE_ID>-testplan.md`) | PART 3 per-ticket test plans + Cross-ticket integration tests + PART 4 consolidated test tasks |
| `$BUNDLE_STATE_FILE` (`<epic>/_bundle-state.yaml`) | Resume oracle for every downstream agent |
| `$EPIC_CONTEXT` (`<epic>/epic-context.md`) | Story Roster section appended; HLD/Spike sections seeded if first time |

### Phase overview

```
BR.0   detect_bundle_resume — read prior _bundle-state.yaml; emit Resume gate if found
BR.0a  detect_fresh_flag    — same semantics as single-story --fresh
BR.1   load_config          — verify runtime.bundle.enabled; load bundle settings + skills
BR.2   resolve_mcp_roles    — same ladder as single-story orchestrator
BR.3   render_active_context

A.0    fetch_epic_docs      — PRD + HLD + Spike → epic_framing_block (NEW)
A.1    resolve_tickets      — explicit-list OR status-filter form
A.2    compute_bundle_id    — deterministic hash from sorted ticket IDs
A.3    per_ticket_parse     — schema-driven full parse per ticket; Source-tag every AC
A.4    cross_ticket_findings — shared-asset / conflict / reuse / order
A.5    checkpoint_synthesis — print compact snapshot; user confirms or amends

B.0    load_skills          — bundle-lld-generator + bundle-task-allocator
B.1    write $BUNDLE_CONTEXTS_FILE
B.2    write $BUNDLE_LLD_FILE PART 1
B.3    write $BUNDLE_LLD_FILE PART 2 — apply task_ordering (layer_dep default)
B.4    write $BUNDLE_TESTPLAN_FILE PART 3
B.5    write $BUNDLE_TESTPLAN_FILE PART 4
B.6    initialize $BUNDLE_STATE_FILE
B.7    update $EPIC_CONTEXT Story Roster

C.1    derive_branch_name   — list form for ≤3 tickets, hash form for ≥4
C.2    detect_base_branch   — same stacking logic as single-story
C.3    show_gate            — Conflicts + Warn-size are blocking items
C.4    create_branch        — on Go: git checkout -b
C.5    handle_response      — Go / Amend / Drop / Show / Cancel
C.5b   publish_lld          — optional, via mcp_roles.docs_publish
```

### Resume gate

When BR.0 finds an existing `_bundle-state.yaml`, the agent renders:

```
🔄 Bundle <BUNDLE_ID> already in progress.

State (as of <last_activity_at>):
  ✓ Orchestrator — done
  ✓ Explorer     — done
  ⚙ Surgeon      — paused at T42/53 (1 failed: T39)
  · Review       — pending
  · Ship         — pending

> 👉 Pick one:
>   1. Resume              — pick up at next pending stage (recommended)
>   2. Resume from T<N>    — retry a specific failed task
>   3. Resume --fresh      — reset cursors, re-synthesize, branch stays
>   4. Inspect state       — print full _bundle-state.yaml
>   5. Abandon bundle      — leave artifacts; halt cleanly
```

If `last_activity_at` is older than 7 days, a stale-bundle warning is prepended recommending `git pull` + rebase before resume.

### Branch naming

| Tickets | Branch form | Example |
|---|---|---|
| 1 | (rejected — use single-story trigger) | — |
| 2–3 (`runtime.bundle.branch_naming.list_threshold`) | `feature/<ID-1>_<ID-2>_<ID-3>` (sorted) | `feature/PROJ-1234_PROJ-2344_PROJ-5533` |
| ≥4 | `feature/<EPIC_LOWER>-bundle-<HASH4>` | `feature/iiqmag-4567-bundle-a3f2` |

Hash is the first 4 hex chars of `sha1(comma_join(sorted_ticket_ids))`. Configurable: `runtime.bundle.branch_naming.{hash_algo,hash_chars}`.

### Failure & resume model

`_bundle-state.yaml` is the single source of truth. Every bundle-aware agent (orchestrator, explorer, surgeon, review, ship) reads it at pre-flight and writes it atomically at every checkpoint AND every stage transition. Re-issuing the original trigger is the canonical resume command — bundle-orchestrator's BR.0 step routes it.

| Catastrophic-stop scenario | Recovery |
|---|---|
| Machine reboot mid-Surgeon | Re-trigger → BR.0 → pick `Resume` → opens fresh chat at next pending task |
| MCP token expired during Phase A | Re-trigger after fixing MCP → BR.0 sees `stages.orchestrator.status: in_progress` → picks up |
| User left for a week | Stale-bundle warning fires; recommend `Resume --fresh` after `git pull` |
| Build env broken | Stage-level halt; user fixes; `Resume bundle-surgeon for <ID> from T<N>` |
| Mid-batch task failure | Stage continues with `failed[]` recorded; surfaced at end-of-stage gate |

### Differences from single-story Orchestrator

| Aspect | Single-story | Bundle |
|---|---|---|
| Triggers | `Work on <TICKET>` | `Work on epic stories ...` / `Work on epic <ID> with status=...` |
| Tickets | 1 | 2–10 (configurable cap) |
| LLD files | `<TICKET>.md` + `-lld.md` + `-testplan.md` | `<BUNDLE_ID>.md` + `-lld.md` + `-testplan.md` |
| AC Registry | implicit single-source | every row tagged `Source: <ticket>` |
| Tasks | flat T1..Tn | T1..Tn with `Sources: <ticket-list>` and `Depends_On: <T#-list>` |
| Branch | `feature/<TICKET>-...` | `feature/<list>` or `feature/<epic>-bundle-<hash>` |
| Epic Framing | optional (HLD only) | mandatory by default (PRD + HLD + Spike, gated by `runtime.bundle.epic_framing.*`) |
| Shared assets | implicit (caught by review) | explicit (declared in PART 1, attributed in PART 2) |
| Resume | per-ticket (re-issue trigger) | per-bundle (single state file) |

### When to use bundle vs single-story

Use **bundle** when:
- 2–7 tickets share code (same components, same services, overlapping ACs)
- All tickets are in the same sprint and ready for dev
- Reviewer prefers one PR over many for the related work
- You want cross-story design dedup at LLD time, not after-the-fact refactor

Use **single-story** when:
- Tickets are loosely related or span sprints
- A ticket needs Bug Mode (bundle does not support Bug tickets)
- Sprint metrics need per-ticket cycle time
- Production rollback must be ticket-level granular

### Cost expectation (real API-billing numbers)

Per-agent cost on Sonnet 4.5 is **$3–6 in practice** (dominated by cache reads — every tool call re-reads the cached system prompt). For a 10-story bundle running through all 5 agents with checkpointed sub-runs, expect **$80–180 total** on Sonnet, **$50–110** on Haiku.

That's roughly equal to **10 single-story runs executed warm-cache back-to-back** (also $80–180 on Sonnet). Bundle's wins are NOT primarily token-based:

- **Wall-clock**: ~30–40% faster end-to-end (fewer chat handoffs, fewer build cycles)
- **Code dedup at design time**: cross-story shared assets identified in Phase A, not after the fact
- **PR consolidation**: one PR vs N — saves human reviewer time, which dominates real-world cost
- **Cache windows align with design**: bundle agents naturally run back-to-back, hitting cache-warm naturally

Bundle DOES beat **cold sequential** (10 single stories spread across days, no cache benefit) by ~50% — $80–180 bundle vs $150–300 cold sequential. If your team batches stories sequentially in one session, the token saving shrinks to ~10–20%.

For N=2–3, bundle setup overhead can eat the savings — single-story is fine. See [`agent-pipeline/docs/cost-optimization.md`](../cost-optimization.md) for per-agent optimization opportunities (parallel tool calls, Haiku candidates).

### Known limitations (v1)

- **No raw JQL** in the trigger — `with status="A","B"` only. Future: `--jql='<expr>'`.
- **No partial-ticket merge** — bundle either ships all or some are deferred; per-ticket cherry-picking from a bundle PR is a manual git operation.
- **No mid-bundle ticket addition** — once Phase A completes, you cannot add another ticket without re-running with `--fresh` (which discards prior synthesis).
- **Bug tickets refused** — bundle is Story/Task/Spike only. A bundle containing a Bug halts at A.1.

### See also

- `bundle-orchestrator.md` (this agent's prompt)
- `agent-flow.mdc § Auto-start (BUNDLE MODE)` — trigger grammar
- `agent-flow.mdc § Procedure C` — bundle path resolution
- `bundle-lld-generator.md` — consolidated LLD shape
- `bundle-task-allocator.md` — task attribution + ordering algorithms
- `runtime.bundle.*` block in `pipeline.iiq.yaml` — full config reference
