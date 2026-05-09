# Agent Documentation — Agent Pipeline

Per-agent walkthroughs. Each doc opens with a **Quick Reference** (invocation modes, commands, config, I/O, examples) and continues into deep mechanics.

---

## Pipeline overview

### Full pipeline (ticket → PR)

```
 User: @orchestrator.md Work on PROJ-1234

   ┌────────────────┐   Requirement Summary + ACs + 3-file LLD
   │  Orchestrator  │──► $CONTEXTS_FILE + $LLD_FILE + $TESTPLAN_FILE
   └───────┬────────┘   Phase C gate (amend / go / cancel)
           │
           ▼  Amender subagent — if user picks Amend
   ┌────────────────┐   Task annotations + insertion points
   │    Explorer    │──► $EXPLORATION_FILE + $CODEBASE_MAP
   └───────┬────────┘
           │
           ▼
   ┌────────────────┐   Code changes + per-task manifest
   │    Surgeon     │──► $MANIFEST_FILE + uncommitted diff
   └───────┬────────┘
           │
           ▼  (optional) AC-E2E-Check — browser AC verification
   ┌────────────────┐   Per-task verdicts + pattern/visual fidelity
   │    Review      │──► $REVIEW_FILE + $EPIC_CONTEXT append
   └───────┬────────┘
           │
           ▼
   ┌────────────────┐   Commits, PR, JIRA transitions
   │     Ship       │──► GitHub PR + codebase map metadata
   └────────────────┘
```

### Standalone — run one agent directly (no ticket required)

```
@explorer.md Research: <question>            → research notes
@explorer.md Explore: <task spec>            → ad-hoc exploration
@surgeon.md Apply: <spec> in <files>         → small direct change (≤5 files, ≤150 lines)
@surgeon.md Implement: <bullet list of ACs>  → AC-driven change
@review.md Review changes                    → code-quality review of git diff
@review.md Review PROJ-1234                  → ticket-scoped review (AC coverage)
@review.md Review against: <ACs>             → ad-hoc AC-driven review
@ac-e2e-check.md Demo <URL>                  → browser walkthrough
```

Outputs land under `contexts/standalone/` with a `standalone-*-{timestamp}.md` filename. They never interfere with pipeline artifacts.

---

## Mode matrix — what each agent supports

| Agent | Pipeline mode | Standalone mode | Enrichment (ref ticket + images + MCP) |
|-------|---------------|-----------------|---------------------------------------|
| [01 Project Analyzer](01-project-analyzer.md) | ✅ one-time + rescans | — | — |
| [02 Orchestrator](02-orchestrator.md) | ✅ start of chain | — | ✅ auto-discovers via Atlassian + Figma + GitHub MCP |
| [03 Explorer](03-explorer.md) | ✅ | ✅ `Research:` / `Explore:` | ✅ consumes enrichment from Orchestrator |
| [04 Surgeon](04-surgeon.md) | ✅ | ✅ `Apply:` / `Implement:` | ✅ `— reference: <TICKET>` + images + MCP |
| [05 AC-E2E-Check](05-ac-e2e-check.md) | ✅ `Demo <TICKET>` | ✅ `Demo <URL>` / `Verify: <scenario>` | — |
| [06 Review](06-review.md) | ✅ | ✅ 3 sub-modes (`diff` / `ticket` / `ac-driven`) | ✅ `against pattern <TICKET>` + design images |
| [07 Ship](07-ship.md) | ✅ | ❌ safety rail — requires Review | — |
| [08 Subagent-Amender](08-subagent-amender.md) | ✅ at Orchestrator gate | — | — |

---

## Index

| # | Agent | When it runs | Primary output |
|---|---|---|---|
| 01 | [Project Analyzer](01-project-analyzer.md) | Once + on-demand rescans | `project-map.md` + `pipeline.yaml` auto-blocks |
| 02 | [Orchestrator](02-orchestrator.md) | Per ticket (Step 1/5) | `{TICKET}.md` main + `{TICKET}-lld.md` + `{TICKET}-testplan.md` |
| 03 | [Explorer](03-explorer.md) | Per ticket (Step 2/5) + standalone | `{TICKET}-exploration.md` or `standalone-exploration-*.md` |
| 04 | [Surgeon](04-surgeon.md) | Per ticket (Step 3/5) + standalone | `{TICKET}-manifest.md` or `standalone-*-manifest-*.md` + code |
| 05 | [AC-E2E-Check](05-ac-e2e-check.md) | Optional | Browser verdicts + new tasks if gaps |
| 06 | [Review](06-review.md) | Per ticket (Step 4/5) + standalone | `{TICKET}-review.md` or `standalone-*-review-*.md` |
| 07 | [Ship](07-ship.md) | Per ticket (Step 5/5) | Git commit + PR + JIRA status |
| 08 | [Subagent-Amender](08-subagent-amender.md) | At Orchestrator gate on `Amend:` | Amended 3-file LLD |
| 09 | [Bundle Orchestrator](09-bundle-orchestrator.md) | Multi-story consolidation (Step 1/5, bundle mode) | `<BUNDLE_ID>.md` + `-lld.md` + `-testplan.md` + `_bundle-state.yaml` — replaces single-story orchestrator when triggered with `Work on epic stories ...` or `Work on epic <ID> with status=...` |

---

## Configuration source of truth

Every agent reads `contexts/config/pipeline.yaml`. No agent hardcodes paths, skills, or build commands. Each agent's Quick Reference lists the yaml keys it consumes.

| Config key | Read by |
|-----------|---------|
| `skills.layer_map` | Orchestrator, Explorer, Surgeon, Review, Project-Analyzer |
| `skills.orchestrator.*` (ticket_schema, lld_generator, ac_templates) | Orchestrator |
| `skills.explorer.*` (bug_router, bug_frontend, bug_backend) | Explorer bug-mode |
| `skills.extra_triggers` | Surgeon, Review |
| `shared_paths.*` | Orchestrator, Explorer, Surgeon, Review |
| `operation_patterns` | Orchestrator, Explorer, Surgeon |
| `component_naming.prefix` | Orchestrator, Explorer, Project-Analyzer |
| `scan_exclusions` | All agents (for grep safety) |
| `builds.*` | Surgeon (per-task build), Review (review_gate) |
| `builds.forbidden` | Surgeon, Review |
| `jira.*` (auth, project_key, labels, transitions, reference_link_types) | Orchestrator, Ship |
| `runtime.contexts_layout` | All agents (for path resolution) |
| `runtime.branching` | Orchestrator, Ship |
| `mcp_servers` (atlassian, github, figma) | Orchestrator, Review, Ship, (Explorer if multi-repo) |
| `demo.*` | AC-E2E-Check |
| `i18n.*` | Surgeon (reuse check) |
| `rescan_hints.*` | Project-Analyzer, Orchestrator (freshness_check) |
| `subagents.*` | Orchestrator, Surgeon, Review |

---

## Context files (output layout)

### Pipeline mode (nested by epic — default)

```
contexts/
└── <epic-lower>/                        e.g. proj-epic-42/
    ├── codebase-map.md                  Explorer maintains; Ship updates metadata
    ├── epic-context.md                  Compact epic knowledge; Review appends per story
    ├── PROJ-1234.md                     $CONTEXTS_FILE — Requirement Summary + ACs + index
    ├── PROJ-1234-lld.md                 $LLD_FILE — PART 1 Design + PART 2 Tasks
    ├── PROJ-1234-testplan.md            $TESTPLAN_FILE — PART 3 Test Plan + PART 4 Test Tasks
    ├── PROJ-1234-exploration.md         $EXPLORATION_FILE — Explorer's task annotation summary
    ├── PROJ-1234-manifest.md            $MANIFEST_FILE — Surgeon's per-task change rows
    └── PROJ-1234-review.md              $REVIEW_FILE — Review's verdict + epic-context update
```

### Standalone mode

```
contexts/
└── standalone/                          ad-hoc artifacts; ignored by Procedure B's glob
    ├── standalone-exploration-{ts}.md
    ├── standalone-manifest-{ts}.md          (plain Apply:)
    ├── standalone-ac-manifest-{ts}.md       (AC-driven Implement:)
    ├── standalone-review-{ts}.md            (Review changes)
    ├── standalone-ticket-review-{ts}.md     (Review <TICKET>)
    ├── standalone-ac-review-{ts}.md         (Review against:)
    └── standalone-demo-{ts}.md              (Demo <URL>)
```

### Project-level (shared across all epics)

```
contexts/
├── config/
│   └── pipeline.iiq.yaml                configuration, pack-specific
├── project-map.md                       Project Analyzer output — shared globally
└── archive/                             shipped tickets moved here (optional)
```

---

## Common patterns

**Path resolution** — every non-Orchestrator agent uses `agent-flow.mdc § Procedure B`: glob `contexts/**/{TICKET}.md`, parent directory becomes `$CONTEXT_DIR`, derive companion paths from there.

**Prerequisite contracts** — each agent's pre-flight has explicit `check_prerequisites` step with halt messages naming the next command to run. No silent failures.

**Mode detection** — agents supporting standalone mode run `detect_invocation_mode (0)` before prerequisites. Pipeline triggers run full pre-flight; standalone triggers branch to a reduced flow.

**Active Context block** — every agent renders a visible summary at pre-flight end: mode, skills loaded, hooks, MCPs available, config status. You see exactly what's driving the run.

**Enrichment (reference + images + MCP)** — Orchestrator's `resolve_enrichments (A0.6)` auto-discovers via Atlassian (linked issues, attachments), Figma (frames), GitHub (reference PR). Standalone Surgeon + Review accept `— reference: <TICKET>` and image attachments explicitly. All enrichment is additive — no MCPs / no references = standard pipeline unchanged.

**Reuse first** — Orchestrator's AC enrichment + Explorer's E.0 reuse discovery + Surgeon's Step 0a reuse verification all collaborate to prevent duplicate components. Surgeon always re-verifies even if upstream claimed reuse.

**Three-file LLD split** — Orchestrator writes 3 companion files per ticket. `$CONTEXTS_FILE` is the main entry point (Requirement Summary + ACs + index). `$LLD_FILE` holds PART 1 Design + PART 2 Tasks. `$TESTPLAN_FILE` holds PART 3 Test Plan + PART 4 Test Tasks. Amender routes edits to the correct file per section.

---

## How to navigate a specific question

- **"What does this agent read?"** → Quick Reference → Config read + Context read per doc
- **"What does this agent write?"** → Quick Reference → Context written per doc
- **"How do I run this standalone?"** → Quick Reference → Invocation modes per doc
- **"How do I debug a phase?"** → Phase walkthrough + common failure modes per doc
- **"How does enrichment work here?"** → Quick Reference → Enrichment support per doc
- **"What happens if I run this without upstream?"** → Quick Reference → Prerequisites per doc

---

## Related docs

- [`HOW-TO-USE.md`](../../../HOW-TO-USE.md) — user-facing setup + story walkthrough + standalone/pipeline cheatsheet
- [`CHANGELOG.md`](../../../CHANGELOG.md) — release history
- [`VALIDATION-CHECKLIST.md`](../../../VALIDATION-CHECKLIST.md) — manual validation for real projects
- Agent prompts: `agent-pipeline/agents/*.md` (installed to `.cursor/agents/`)
- Path resolution + companion files contract: `agent-pipeline/rules/agent-flow.mdc`

---

## Updating these docs

When an agent prompt changes materially (new phase, new rule, new config knob), update the corresponding doc's **Quick Reference** block first so the top-of-page always reflects current behavior. Mechanics sections can lag by one minor release.
