---
name: epic-context-strategy
description: How epic-level knowledge flows between stories. The epic-context.md file is the compact knowledge companion to the codebase map. It replaces expensive sibling LLD lookups with an incrementally-built summary.
---

# Epic Context Strategy

## The Problem

When story 6 in an epic starts, the Orchestrator needs to know what stories 1-5 decided, built, and established. The old approach:

```
EXPENSIVE (v11): Fetch 5 sibling LLDs from Confluence
  LLD-1: ~3000 tokens
  LLD-2: ~3000 tokens
  LLD-3: ~3000 tokens
  LLD-4: ~3000 tokens
  LLD-5: ~3000 tokens
  Total: ~15,000 tokens just for sibling context
  + may fail if Confluence MCP is unavailable
```

## The Solution: `epic-context.md`

One file per epic, incrementally built, always local, always current.

```
EFFICIENT (v13): Read one file
  epic-context.md: ~500 base + (150 × 5 stories) = ~1,250 tokens
  Savings: 91% fewer tokens
  + always available (local file, no Confluence dependency)
```

## File Location

```
contexts/
├── iiqmag-4567/                    # nested layout (recommended)
│   ├── epic-context.md             ← NEW: knowledge summary
│   ├── codebase-map.md             ← existing: file-level map
│   ├── PROJ-1234.md             ← story 1 LLD (full, for reference)
│   ├── PROJ-1234-exploration.md
│   ├── PROJ-2345.md             ← story 2 LLD
│   └── ...
```

Variable: `$EPIC_CONTEXT = $CONTEXT_DIR + "epic-context.md"`

## Two Companion Files

| File | Tracks | Updated by | Used by |
|------|--------|-----------|---------|
| `codebase-map.md` | **FILES** — what files exist, methods, line numbers | Explorer (every run) | Explorer, Surgeon |
| `epic-context.md` | **KNOWLEDGE** — decisions, patterns, HLD summary, story outcomes | Orchestrator (create), Ship (append) | Orchestrator, Explorer |

Explorer doesn't need to read both for every task — it reads the codebase map for file-level detail and epic-context for "what was decided."

## Lifecycle

### Story 1 (first in epic): Orchestrator CREATES

```yaml
---
epic: PROJ-EPIC-42
epic_title: "Certification Workflow Redesign"
created_by: PROJ-1234
created_at: 2025-03-15
stories_shipped: 0
---

## HLD Summary
{2-3 sentences from the epic's HLD — architecture approach, key tech decisions}
Source: {Confluence link}

## Spike Findings
{If any spikes were done under this epic — key findings, POC results}
{If no spikes: "No spikes found for this epic."}

## Architecture Decisions
- {decision 1 from HLD — e.g., "Use AngularJS for cert pages, Angular 18 for admin"}
- {decision 2 — e.g., "Shared date validation service in common/"}

## Story Log
(populated by Ship after each story completes)
```

### Review Agent (after each story): APPENDS

After PART 4 (test plan validation), Review extracts a compact summary from the Change Manifest + LLD + review findings and appends to epic-context.md:

```yaml
### PROJ-1234 — "Date picker for Certifications" (reviewed 2025-03-20)

**Files:**
  CREATED:
    - {frontend_path}/common/directive/datePicker.js (date picker directive)
    - {frontend_path}/common/service/dateValidationService.js (shared validation)
  MODIFIED:
    - {frontend_path}/identity/certListCtrl.js (added date filter support)
    - {backend_path}/web/rest/CertificationResource.java (added date param)
  CONFIG:
    - {frontend_path}/common/module.js (registered datePicker directive)

**Pattern:** AngularJS directive + shared service + REST filter param
**Decision:** Date validation centralized in dateValidationService.js (reuse for all date stories)
**Constraint:** flatpickr conflicts with air-datepicker — must remove air-datepicker first
**Reusable:** dateValidationService.js, datePicker directive (config-driven)
```

**~200 tokens per story.** Review extracts this from:
- Change Manifest (from Surgeon) — CREATED vs MODIFIED file lists
- LLD PART 1 (design decisions) → key decisions
- Review findings → constraints discovered during implementation

**Why Review does this (not Ship):** Ship is optional — user may defer pushing, park the branch, or ship later. But Review ALWAYS runs. By updating epic-context at Review time, the next story has full context even if Ship hasn't run yet.

### Story 2+ (subsequent): Orchestrator READS

Instead of fetching sibling LLDs from Confluence:

```
1. Read $EPIC_CONTEXT (epic-context.md)
   → HLD summary (what the epic is about)
   → Architecture decisions (what was decided)
   → Story log (what each prior story built + decided + discovered)

2. Read $CODEBASE_MAP metadata + conventions (what patterns were established)

3. DO NOT fetch individual sibling LLDs from Confluence
   → The epic-context.md already has their key decisions
   → If more detail is needed for a specific story, the full LLD is local: $CONTEXT_DIR/{TICKET_ID}.md
```

### When MORE detail is needed

Sometimes the Orchestrator needs more than the compact summary (e.g., story 6 is closely related to story 2's design). In that case:

```
1. Read epic-context.md → see story 2 summary
2. The summary mentions specific files and decisions
3. If that's enough → proceed
4. If not enough → read the FULL local LLD: $CONTEXT_DIR/PROJ-2345.md
   (it's local, no Confluence fetch needed)
5. Only read the SPECIFIC PART needed (PART 1 for design, PART 2 for tasks)
   → don't read the whole 4-part LLD
```

## What Each Agent Reads

| Agent | Reads from epic-context.md | Reads from codebase-map.md |
|-------|---------------------------|---------------------------|
| **Orchestrator** | HLD summary, architecture decisions, story log (what patterns, files, decisions, constraints) | Metadata + conventions only (not file entries) |
| **Explorer** | Story log (which stories created/modified which files — cross-reference) | Full map (file entries, methods, line numbers) |
| **Surgeon** | Nothing (reads exploration report instead) | Nothing (reads exploration report instead) |
| **Review** | Reads format, then APPENDS new story entry (CREATED/MODIFIED/CONFIG files + patterns + decisions) | Nothing directly |
| **Ship** | Nothing (epic-context already updated by Review) | Updates metadata (stories_completed after push) |

## Token Budget

| Epic maturity | epic-context.md size | vs fetching all LLDs |
|---------------|---------------------|---------------------|
| 1 story done | ~500 tokens (HLD + 1 story) | vs ~3,000 (1 LLD) |
| 3 stories done | ~950 tokens | vs ~9,000 (3 LLDs) |
| 5 stories done | ~1,250 tokens | vs ~15,000 (5 LLDs) |
| 10 stories done | ~2,000 tokens | vs ~30,000 (10 LLDs) |

The epic-context.md grows linearly at ~150 tokens/story. Even at 10 stories, it's cheaper than fetching ONE full LLD from Confluence.

## Fallback: No epic-context.md

If this is the first story AND the file doesn't exist yet:
1. Orchestrator creates it (from HLD + spikes)
2. If no HLD found → creates with minimal header, story log will build over time

If the file exists but seems stale (last story shipped weeks ago):
1. Check `stories_shipped` count vs codebase-map's `stories_completed`
2. If they match → file is current
3. If map has more → some stories shipped without updating epic-context (manual recovery needed)
