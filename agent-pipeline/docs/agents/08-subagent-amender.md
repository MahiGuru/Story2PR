# 08 — Subagent-Amender

## Quick Reference

### Invocation modes

| Mode | Trigger | Outcome |
|------|---------|---------|
| **Subagent — invoked by Orchestrator** | User types `Amend: <request>` at Orchestrator's Phase C gate | Targeted edits to the 3-file LLD split |
| **Standalone** | ❌ Not supported | Amender only runs under Orchestrator's Phase C loop |

### Example user interactions (at Phase C gate)

```
# After Orchestrator shows LLD summary:

Amend: add AC4 — user sees confirmation toast on save success
Amend: Reset button should be secondary variant, not primary
Amend: drop the async polling — it's a synchronous call
Amend: T3 should MODIFY userCtrl.js, not CREATE a new file
Amend: add constraint — page must load in <2s
```

### What it reads

| From `pipeline.yaml` | Why |
|---------------------|-----|
| `runtime.contexts_layout` | Path resolution (Procedure B) for the 3 companion files |
| `subagents.orchestrator_amend_request` | Self-registration — confirms Amender is the wired extension |
| (No other pipeline.yaml keys) | Amender operates on LLD structure, not stack specifics |

### What it reads from contexts/

- `$CONTEXTS_FILE` — Requirement Summary + AC Registry (may edit)
- `$LLD_FILE` — PART 1 Design + PART 2 Tasks (may edit)
- `$TESTPLAN_FILE` — PART 3 Test Plan + PART 4 Test Tasks (may edit)
- **Pre-flight check:** refuses if `$EXPLORATION_FILE` / `$MANIFEST_FILE` / `$REVIEW_FILE` already exist — amendments must happen pre-Explorer

### What it writes

Routes edits to the correct file based on section:

| Section edited | Target file |
|---------------|-------------|
| Requirement Summary | `$CONTEXTS_FILE` |
| Enriched AC Registry | `$CONTEXTS_FILE` |
| Companion Files index | `$CONTEXTS_FILE` |
| PART 1 — Design (UseCases, Implementation/*, Constraints, Amendment Log) | `$LLD_FILE` |
| PART 2 — LLD Tasks (tasks, AC-Matrix, Dependency Graph) | `$LLD_FILE` |
| PART 3 — Test Plan | `$TESTPLAN_FILE` |
| PART 4 — Test Tasks | `$TESTPLAN_FILE` |
| Bug mode — Bug Context | `$CONTEXTS_FILE` |
| Bug mode — PART 2 Fix Tasks | `$LLD_FILE` |
| Bug mode — PART 3 Hypotheses + PART 4 Regression | `$TESTPLAN_FILE` |

**Version stamps bumped in both `$LLD_FILE` and `$TESTPLAN_FILE`** — Surgeon's resume-drift check uses these to detect changes.

### Phase overview

```
1  classify_amendment       — categorize into 7 types (functional addition,
                              AC addition, AC modification, design change,
                              constraint addition, scope reduction, clarification)
2  build_section_impact_map — per-file, per-section ADD/MODIFY/DELETE/UNCHANGED
3  generate_change_plan     — render to user, wait for approval
4  apply_amendment          — targeted edits; bump version; append to Amendment Log;
                              revalidate cross-refs (AC→Task, Task→TestTask, deps)
5  return_control           — back to Orchestrator's Phase C gate
```

### Enrichment support

Not applicable in the request-level sense. Amender respects enrichment ALREADY in the LLD — if the user amends an AC that was confirmed by a visual element, Amender updates the visual-confirmation metadata too. No new enrichment triggers at amend time.

### Typical scenarios

| Situation | Amend request |
|-----------|---------------|
| Missing AC | `Amend: add AC — user sees success toast on save` |
| AC text wrong | `Amend: AC2 should say "disabled when no filters" not "hidden"` |
| Want to reduce scope | `Amend: remove the bulk action — out of scope for this story` |
| Pattern reference wrong | `Amend: ignore the PROJ-100 reference — different domain` |
| Design change | `Amend: use modal instead of inline form` |
| Constraint added | `Amend: page must render in <2s P95` |

### Cannot do

- Edit after Explorer has produced `$EXPLORATION_FILE` → refuses with halt
- Edit after Surgeon has produced `$MANIFEST_FILE` → refuses with halt
- Edit after Review has produced `$REVIEW_FILE` → refuses with halt
- Change the pack / branching config (that's `pipeline.yaml` territory, not LLD)
- Run standalone — it's an Orchestrator extension point only

---

## Purpose

Targeted LLD amendment subagent. Invoked by Orchestrator at `gate_for_approval (C)` when user wants to add context, change design, add acceptance criteria, or adjust scope before Explorer runs. Makes precise section-level edits to `contexts/{TICKET_ID}.md` without regenerating untouched sections. About 6x cheaper than re-running Orchestrator.

## When it runs

- **Only inside Orchestrator's gate_for_approval (C) phase**
- **Triggered by user text:** `Amend: <what to change>`
- **Returns control to gate** — Orchestrator re-displays updated LLD summary after Amender completes

## Trigger commands

- `Amend: <text>` at Orchestrator's Phase C gate
- Not directly invokable — always goes through Orchestrator

## Phase overview

```
classify_amendment (Phase 1)
    ↓
preserve_v15_markers (Phase 1.5)            [v15.1+ MANDATORY awareness]
    ↓
build_impact_map (Phase 2)                  [which sections change]
    ↓
generate_change_plan (Phase 3)              [human-readable preview]
    ↓ user: "Proceed" / "Cancel"
apply_amendment (Phase 4)
    ├── make_targeted_edits (1)
    ├── bump_version (2)
    ├── append_to_amendment_log (3)
    ├── revalidate_crossrefs (4)
    ├── save_and_report (5)
    └── return_control (6 — to Orchestrator)
```

## Phase-by-phase

### classify_amendment (Phase 1)

Reads user's `Amend: <text>` and classifies the amendment type:

**Pre-v15 classifications:**
- **Context addition** — "Add that dates must be UTC"
- **Design change** — "Use ComponentX instead of ComponentY"
- **AC addition** — "Add an AC for permission check"
- **Task decomposition** — "Split T3 into T3a and T3b"
- **Scope adjustment** — "Remove T5, out of scope"
- **Wording fix** — "Rename 'user' to 'identity' in PART 1"

**v15.1 marker-aware classifications (four new):**
- **Intent re-classification** — "Revoke should be async-action, not destructive-confirm"
- **Contract confidence change** — "Treat /rest/ui/bulk as NONE, contract is wrong"
- **Promotion recommendation override** — "Don't auto-promote dateRangePicker"
- **Intent template override** — "Skip the audit AC for this internal-only button"

### preserve_v15_markers (Phase 1.5, v15.1 MANDATORY)

Before touching anything, catalog v15 machine-readable markers in the current LLD:
- Every task's `contract_confidence:`, `contract_source:`, request/response schemas
- Every task's `button_intent:`, `intent_source:`
- § Button Intents table
- Cross-refs to project-map (`§ 3b`, `§ 6`, `§ 9`, `§ 10c`)

These markers are SACRED (Rule #9). Any amendment that would corrupt them aborts.

Rules:
- Don't delete markers without explicit amendment intent
- Don't change marker values without explicit amendment (e.g. `HIGH → MEDIUM` only if user amendment is "change contract confidence for T4")
- Preserve cross-refs even when renaming sections
- v15 classifications (the four new types) must go through this phase's awareness, not generic "design change"

### build_impact_map (Phase 2)

Internal planning step. Produces a Section Impact Map like:

```yaml
impact_map:
  sections_changing:
    - PART 2/T3 (design change: UseComponentX → UseComponentY)
    - PART 2/T3/wiring_template (template refresh)
  sections_unchanged:
    - PART 1 (Requirement Summary)
    - PART 2/T1 (no impact)
    - PART 2/T2 (no impact)
    - PART 4 (test plan — no impact)
    - All v15 markers
  new_sections:
    - (none)
  removed_sections:
    - (none)
  amendment_log_entry:
    "v0 → v1: Changed T3 component from X to Y (design-change)"
```

Used internally to drive `generate_change_plan`.

### generate_change_plan (Phase 3) — human-readable

Shows user what's about to change:

```
## Amendment Plan

Amendment: "Use ComponentX instead of ComponentY in T3"
Type: Design change
Version: 0 → 1

Changes:
  ✎ PART 2 / T3 / Action — updated reference from ComponentY to ComponentX
  ✎ PART 2 / T3 / Wiring template — refreshed with ComponentX pattern

Preserved (unchanged):
  ✓ PART 1 Requirement Summary
  ✓ PART 2 T1, T2, T4 (unchanged)
  ✓ PART 4 Test Plan
  ✓ All v15 markers (contract_confidence, button_intent, cross-refs)

> 👉 Pick one:
>   - Proceed    — apply this amendment
>   - Cancel     — return to gate without changes
```

### apply_amendment (Phase 4) — the actual write

Six sub-steps:

**make_targeted_edits (1):** Perform the section-level edits per the impact map. Only touch what's in `sections_changing`.

**bump_version (2):** Increment amendment version in LLD metadata (`Amendment version: 0 → 1`).

**append_to_amendment_log (3):** Add to `## Amendment Log` section at end of LLD:
```markdown
- v0 → v1 (2026-04-19): Design change — T3 component ComponentY → ComponentX
```

**revalidate_crossrefs (4):** After edits, re-check all `§ 3b`, `§ 6`, `§ 10c` cross-references still resolve. If an amendment broke a cross-ref, surface error — user may need to amend further or cancel.

**save_and_report (5):** Write `contexts/{TICKET_ID}.md`. Emit success confirmation with change count.

**return_control (6):** Exit Amender, return to Orchestrator's `gate_for_approval (C)` gate with updated LLD summary. User can then: amend again, Go, or Cancel.

## Hard rules (Phase 4 invariants)

1. Never regenerate unchanged sections
2. Always preserve byte-identical unchanged content
3. Always bump version + log
4. Always revalidate cross-refs
5. Never touch amendment log beyond appending
6. Never silently delete content — deletions go through explicit scope-adjustment amendment
7. Never corrupt v15 markers (Rule #9 from Phase 1.5)
8. Error surface on revalidate failure — don't save corrupted LLD
9. **v15 markers sacred (v15.1)** — corrupting them aborts the amendment
10. **New v15 classifications** must go through `preserve_v15_markers (Phase 1.5)` awareness, not generic "design change" (v15.1)

## Inputs

| Source | What's read | Phase |
|---|---|---|
| `contexts/{TICKET_ID}.md` | current LLD (must exist) | Phase 1 (classify) |
| User amendment text | `Amend: <text>` from gate_for_approval (C) | Phase 1 |
| `contexts/project-map.md` | for v15 marker validation (cross-refs) | preserve_v15_markers + revalidate_crossrefs |
| `contexts/config/pipeline.yaml` | amender config (version format, log location) | throughout |

## Outputs

Updated `contexts/{TICKET_ID}.md` with:
- Amended sections
- Bumped version
- Appended amendment log entry
- All other sections byte-identical

Exit status: `amended` / `cancelled` / `unchanged`. Passed to Orchestrator for gate re-display.

## Hand-off contract

Amender always returns to Orchestrator's `gate_for_approval (C)` — either with success (updated LLD) or cancelled (LLD unchanged). Orchestrator re-displays gate with new counts if updated.

Amender is never a terminal step — always exits back to Orchestrator.

## Dependencies

- **Orchestrator's LLD must exist** — Amender only amends, doesn't create
- **pipeline.yaml.subagents.amender** configured
- **v15 markers present** (if v15+ LLD) — Phase 1.5 catalogs them

## Token economics

~6x cheaper than re-running Orchestrator:

| Operation | Orchestrator | Amender |
|---|---|---|
| Full LLD regeneration | ~15k | — |
| Section-level amendment | — | ~3k |
| AC registry rebuild | ~4k | — |
| AC single addition | — | ~500 |

This is why Amender exists — many amendments are tiny (fix a word, add one AC, change a component reference). Re-running Orchestrator would rebuild 95% of the LLD unchanged.

## Common failure modes

- **Ambiguous amendment text** — "Change T3" is too vague. Amender asks for clarification at Phase 1.
- **Amendment would corrupt v15 markers** — Rule #9 halt. User refines amendment scope.
- **Amendment violates LLD structure** — e.g. "Delete PART 1" — Amender refuses (PART 1 is structural, not amendable).
- **Cross-reference breaks after amendment** — revalidate_crossrefs (step 4) catches. Amender either auto-fixes (if trivial like renamed section) or surfaces error.
- **User keeps amending without converging** — no hard limit, but amendment_log tracks count. Team norm is usually "3 amendments → regenerate from scratch."
- **Amendment touches sections outside its declared scope** — Amender halts (hard rule 1). User refines.

## Configuration knobs

```yaml
subagents:
  amender: "subagent-amender.md"       # required

runtime:
  amender:
    max_amendments: null                # null = unlimited; integer caps
    warn_at: 3                          # warn when this many amendments
    preserve_byte_identical: true       # strict unchanged-section preservation
```

## Cross-agent awareness

- **Lives inside Orchestrator's Phase C** — only invocation point
- **Preserves Orchestrator's v15 markers** — Phase 1.5 + hard rules 9-10
- **Returns to Orchestrator** — never terminates pipeline on its own
- **Respected by Ship's integrity check** — Amender bumps version, Ship validates final markers before commit

## Version history

- Pre-v14 — core classify/impact/plan/apply flow established
- v14+ — hard rules formalized
- v15.1 — Phase 1.5 v15 marker awareness added; 4 new classifications (intent re-classify, contract confidence change, promotion override, intent template override); hard rules 9-10 added
- v21.0 — semantic phase names
