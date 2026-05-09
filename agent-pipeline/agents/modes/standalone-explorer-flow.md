---
name: standalone-explorer-flow
description: Explorer's standalone-mode flow (Research / Explore triggers). Loaded ONLY when explorer.md detect_invocation_mode (0) sets {mode} == "standalone". Pipeline (single-story / bug / bundle) runs never read this file.
---

# Explorer — Standalone Mode Flow

**Load ONLY when `detect_invocation_mode (0)` in `explorer.md` sets `{mode} == "standalone"`.** Pipeline mode (story / bug / bundle) NEVER reads this file.

Standalone Explorer is for ad-hoc codebase research and ad-hoc exploration without a JIRA ticket. Triggers:

- `Research: <free-form question>` — research mode (lightweight, output-focused)
- `Explore: <free-form task spec>` — exploration mode (file-discovery focused)

By the time control reaches this file, the calling agent has already resolved `{mode}` and confirmed it's standalone.

---

## Standalone Invocation Flow (runs ONLY when `{mode} == "standalone"`)

*This entire section is skipped in pipeline mode. Pipeline mode continues with the phases above (full_build / incremental / Story Exploration Process).*

### Step: check_standalone_inputs (standalone mode pre-flight)

Parse the trigger text into a structured spec:

```
FOR "Research: <question>":
  {spec} = free-form question
  {intent} = research            (lightweight: grep + targeted reads)

FOR "Explore: <task spec>":
  {spec} = task description
  {intent} = ad-hoc-exploration  (closer to pipeline E.2 but without task IDs)

IF {spec} is empty or < 5 words:
  HALT ⛔
  "Standalone trigger needs a real question/spec, not just 'Research:'.
   Try: @explorer.md Research: how does user authentication work?"

Set $STANDALONE_DIR = contexts/standalone/   (create if missing)
Set $STANDALONE_OUTPUT = $STANDALONE_DIR + "standalone-exploration-" + timestamp() + ".md"
```

### Step: load_config (standalone — same as pipeline, minus ticket bits)

Read `contexts/config/pipeline.yaml` for `explorer_paths`, `scan_exclusions`, `shared_paths` only. Skip `skills.explorer.bug_router` (not needed for standalone).

### Step: standalone_research_or_explore

```
IF {intent} == "research":
  1. Grep $EXCLUDES-filtered across $PROJECT_MAP's paths for keywords from {spec}
  2. Read matching files at targeted ranges (file reading budget rules apply)
  3. Structure findings by area (frontend / backend / config / tests)
  4. NO task annotation, NO insertion points, NO wiring templates

IF {intent} == "ad-hoc-exploration":
  1. Run Step E.0 (reuse_discovery) against the spec — identify existing components
  2. Run Step E.1 (build_scan_plan) based on spec's implied touchpoints
  3. Run Step E.2 (explore_each_task) treating {spec} as a single task T1
  4. Produce Task Annotation Summary for that one virtual task
```

### Step: write_standalone_output

Write to `$STANDALONE_OUTPUT` with this shape:

```markdown
---
mode: standalone
intent: {research | ad-hoc-exploration}
trigger: "{verbatim trigger text}"
created: {ISO-8601 timestamp}
---

# Standalone Exploration — {short summary of spec}

## Query
{verbatim spec}

## Findings
{structured content: research notes OR task annotation summary}

## Referenced Files
{list of files read, with line ranges}

## Hand-off Notes
_This file is a standalone exploration. It does NOT belong to any ticket.
If you want Surgeon to act on these findings, invoke:
    @surgeon.md Apply: <your spec> using exploration at {$STANDALONE_OUTPUT}_
```

### Gate (standalone mode)

```
## Explorer (Standalone) - DONE

**Mode:** standalone ({research | ad-hoc-exploration})
**Output:** $STANDALONE_OUTPUT
**Scope:** {N} files scanned, {M} findings documented

> **👉 Pick one:**
> - `Apply: <spec>` — hand off to Surgeon standalone with these findings
> - `Refine: <more specific question>` — re-run standalone with narrower scope
> - `Promote to pipeline` — start a proper ticket (@orchestrator.md Work on <TICKET>)
> - `Done` — stop here
```

**Rules for standalone mode:**
- NEVER writes to $LLD_FILE or $TESTPLAN_FILE (those are pipeline-only).
- NEVER syncs $CODEBASE_MAP (too expensive; standalone is scoped).
- Output filename always starts with `standalone-` so Procedure B's ticket glob ignores it.
- $STANDALONE_DIR stays separate from per-ticket folders.

---

