# contexts/

**This folder holds everything the pipeline reads or writes at runtime** — project-wide context, per-ticket working documents, machine configuration, and tooling. It's organized into three zones:

- **`contexts/` (top level)** — project-wide context (human + machine generated) AND per-ticket pipeline artifacts.
- **`contexts/config/`** — machine configuration only. Parsed by agents on every run.
- **`contexts/tools/`** — installer, validator, MCP sample generator.

## First-time setup (tech lead / architect ONLY)

After `npm run install-pipeline` finishes and the `.cursor/` (or `.claude/`) and `contexts/` folders land in the target project, **one person on the team — the tech lead or architect — must run the Project Analyzer once before anyone else starts using the pipeline.**

```
Analyze project
```

(Alternative trigger: `Scan project`.)

This runs Step 0 of the pipeline and produces `contexts/project-map.md` — the project's DNA (tech stack, folder structure, shared components, REST endpoints, services, templates, build system, data contracts, consumer graph). **Every downstream agent reads this file on every ticket.** Without it, Orchestrator, Explorer, Surgeon, and Review have no project-wide context.

**Rules of the road:**

- **Run it once per project.** Commit `contexts/project-map.md` (and the analyzer-generated sections of `contexts/config/pipeline.*.yaml`) to the repo. The whole team then shares the same catalog.
- **Only the tech lead / architect runs this.** Other team members do **not** need to — they just pull the committed `project-map.md` and start working tickets (`Work on <TICKET-ID>`).
- **Re-run on drift.** If the codebase changes significantly (new module, new build target, major refactor), the tech lead re-runs `Analyze project` and commits the refreshed map. Day-to-day ticket work does not require a rescan.

If a team member tries to work a ticket before the analyzer has run, the pipeline will fail pre-flight because `contexts/project-map.md` is missing — that's by design.

## What lives where

### `contexts/` (top level) — project + per-ticket

| File | Created by | Purpose | Lifecycle |
|------|------------|---------|-----------|
| `project-map.md` | Project Analyzer (Step 0) | Project-wide catalog — tech stack, shared components, REST endpoints, services, templates, promotion recommendations, rescan guidance. Every downstream agent reads this. | Per project; rescanned on drift |
| `project-context.md` | **You** (hand-written) | Project-wide prose context — team boundaries, active migrations, coding norms, reference implementations. Orchestrator loads this on every run. | Per project; edit as the project evolves |
| `{TICKET_ID}.md` | Orchestrator Phase B / B-Bug / B-SubBug | 4-part working document (LLD or bug context) consumed by every downstream agent | Per ticket |
| `{TICKET_ID}-input.md` | **You** (optional, copied from `contexts/config/ticket-input.template.md`) | Pre-flight context for a specific ticket | Archived by Phase A0 after consumption |
| `{TICKET_ID}-exploration.md` | Explorer (Story Mode only) | Task insertion points + wiring templates for Surgeon | Per ticket |
| `{TICKET_ID}-manifest.md` | Surgeon | Change manifest — files touched per task | Per ticket |
| `{TICKET_ID}-review.md` | Review | AC compliance, blast radius, regressions | Per ticket |
| `{EPIC_ID}-codebase-map.md` | Explorer Mode A (created) / Mode B (synced) | Shared epic-level codebase map — reused across all stories in the epic | Per epic, append-only |
| `archive/{TICKET_ID}-input.md` | Phase A0 | Archived pre-flight files after they're consumed. The `archive/` folder is created on-demand the first time Phase A0 archives a pre-flight file — it does not ship pre-created. | Per ticket |

### `contexts/config/` — machine configuration (commit this)

| File | Purpose |
|------|---------|
| `pipeline.yaml` | Machine config read by every agent at pre-flight. Skills, subagents, builds, runtime knobs, JIRA automation, rescan_hints. Edit when you add a layer, subagent, or build command. |
| `ticket-input.template.md` | Blank template. You copy this to `contexts/{TICKET_ID}-input.md` when a ticket needs extra context. |
| `mcp.sample.json` | Sample MCP server config. Each developer copies to their personal MCP config. |

### `contexts/tools/` — operational scripts

`install.mjs` (re-run for upgrades), `validate.mjs` (pipeline.yaml checks), `mcp-sample-generator.mjs`, `help.mjs`.

## The layering principle

Scope of a file determines where it lives:

| Scope | Location | Example |
|-------|----------|---------|
| Project-wide (one per project) | `contexts/` | `project-map.md`, `project-context.md` |
| Epic-wide (one per epic) | `contexts/` | `{EPIC}-codebase-map.md` |
| Story/ticket-wide (one per ticket) | `contexts/` | `{TICKET}.md`, `{TICKET}-exploration.md` |
| Machine config (parsed by agents) | `contexts/config/` | `pipeline.yaml` |

Project-wide context and configuration live in different subdirectories because they have different lifecycles — `project-map.md` is regenerated by Project Analyzer, while `pipeline.yaml` is hand-edited + partially overwritten by analyzer Phase 8 (only the auto-generated blocks).

## Using pre-flight input files

If you want to give Orchestrator extra context for a specific ticket before running it, copy the template and fill it in:

```bash
cp contexts/config/ticket-input.template.md contexts/PROJ-1234-input.md
# edit contexts/PROJ-1234-input.md with your context
# then, in the pipeline:
#   Work on PROJ-1234
```

Phase A0 auto-loads the file, merges it into the LLD during Phase B, then archives it to `contexts/archive/`.

## .gitignore guidance

Commit project-wide context (map + prose), the `config/` subfolder, and epic codebase maps. Ignore the transient per-ticket artifacts:

```gitignore
# Ignore per-ticket artifacts (working documents, not source of truth)
contexts/*.md

# But keep the project-wide context files — they're team-shared
!contexts/project-map.md
!contexts/project-context.md

# Keep the README
!contexts/README.md

# Keep the epic codebase maps — they're reusable across stories in an epic
!contexts/*-codebase-map.md

# Keep the config subfolder entirely (machine config, templates, MCP samples)
!contexts/config/
!contexts/config/**

# Keep the tools subfolder entirely
!contexts/tools/
!contexts/tools/**

# Ignore per-ticket design asset folders — they're working artifacts, often
# large (PNGs from Figma), and may contain licensed design-system visuals.
# Teams that want design traceability for audit purposes can drop these two
# lines and commit the folders instead; default assumption is don't commit.
contexts/**/*-design/
contexts/*-design/
```

Committing `project-map.md` means the whole team shares the same project catalog — Orchestrator and Explorer on everyone's machine reference the same file. Committing `project-context.md` means standing team knowledge (boundaries, migrations, reference implementations) is version-controlled alongside the code.

## Migration from v14.0–14.2

Pre-v14.3 installs stored both files in `contexts/config/`:

- `contexts/config/project-map.md` → now `contexts/project-map.md`
- `contexts/config/project-context.md` → now `contexts/project-context.md`

The v14.3 installer (`node contexts/tools/install.mjs`) auto-migrates these on first run:

```
→ Checking for v14.0-14.2 paths to migrate
  ✓ migrated project-map.md: contexts/config/ → contexts/ (generated catalog)
  ✓ migrated project-context.md: contexts/config/ → contexts/ (prose context)
  → 2 file(s) migrated. Review + commit with:
    git add -A contexts/ && git commit -m "chore: migrate project-map + project-context to contexts/ root (v14.3)"
```

After migration, update your project's `.gitignore` per the template above. Both files move up one level; their content and format are unchanged.
