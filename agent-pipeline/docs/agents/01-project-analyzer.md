# 01 — Project Analyzer

## Quick Reference

### Invocation modes

| Mode | Trigger | When to use |
|------|---------|-------------|
| **Pipeline — first scan** | `Analyze project` | Run once per project at setup |
| **Pipeline — scoped rescan** | `Rescan <stack>` or `Rescan <stack>/<section>` | After adding new framework, files, or when map feels stale |
| **Standalone** | — not applicable | (Project Analyzer is already ad-hoc — user-triggered each time) |

### Example commands

```
Analyze project                      # full scan: 12 phases, all folders
Rescan Java                          # Java stack only
Rescan Java/Services                 # Java backend services section only
Rescan AngularJS/UI                  # AngularJS UI components section only
Reconsider ignored                   # show what was previously ignored + re-propose
Show low-confidence detections       # surface near-matches for manual review
```

### What it reads

| From `pipeline.yaml` | Why |
|---------------------|-----|
| `scan_exclusions` | Directories to skip (node_modules, build output, etc.) |
| `component_naming.prefix` | For Signal 1b — pack-prefixed component detection |
| `skills.layer_map[*].path_glob` + `aliases` | For layer-based rescan dispatch and rename proposals |
| `rescan_hints.*` | Thresholds for proposing new framework detections |
| `analyzer_ignore` | User-maintained ignore list (opt-out per framework/path) |
| `shared_paths.*` | Where to look for shared components |
| `i18n.*` | Which message file to extract + what's allowed |

### What it writes

| Output | Purpose |
|--------|---------|
| `contexts/project-map.md` | Main catalog — tech stack, folders, shared components, REST endpoints, services, intents, i18n, build system |
| `contexts/config/pipeline.yaml` (auto-blocks) | `skills.layer_map` entries, `shared_paths` paths, aliases — populated where user left blank |
| Rescan log at top of `project-map.md` | History of rescans with dates + scope |

### Context flow

- **Read:** whole repo (bounded by `scan_exclusions`)
- **Write:** `project-map.md` (project-level, not per-ticket)
- **Consumed by:** every downstream agent reads `project-map.md` as shared knowledge; yaml auto-blocks drive skill/build resolution

### Enrichment support

Not applicable — Project Analyzer does discovery, not ticket work. No reference tickets, no images, no MCP auto-discovery (though it respects `mcp_servers` config for any cross-repo scans).

### Typical scenarios

| Situation | Command |
|-----------|---------|
| New empty pack just installed | `Analyze project` |
| Team added React to the Java stack | `Rescan Frontend/React` (or full rescan) |
| Map looks stale (>30 days) | Orchestrator's `freshness_check (A.0.5)` will prompt; or run `Rescan <narrowest scope>` manually |
| You told analyzer to ignore Django months ago; want to reconsider | `Reconsider ignored` |

---

## Purpose

Takes unstructured source code and produces structured, queryable knowledge that every other agent consumes. Scans once at project setup; refreshes on-demand via scoped rescans. Maintains two artifacts: `contexts/project-map.md` (human-readable catalog) and `contexts/config/pipeline.yaml` auto-populated blocks (machine config).

## When it runs

- **First time:** `Analyze project` — runs all 12 phases, 5–15 min
- **On-demand refresh:** `Rescan <scope>` — runs subset of phases, 30s–2 min
- **Never auto-runs during stories** — Review's PART 5b handles per-story project-map updates without invoking the analyzer

## Trigger commands

See `agent-pipeline/rules/agent-flow.mdc § Step 0 triggers` for the full list. Summary:

| Command | Scope |
|---|---|
| `Analyze project` | Initial full scan |
| `Rescan project` | Full rescan with diff preview |
| `Rescan <Stack>` (e.g. `Rescan Java`) | Stack-scoped |
| `Rescan <Stack>/<Section>` (e.g. `Rescan Java/Services`) | Narrow stack+section |
| `Rescan components` / `services` / `endpoints` / etc. | Section-scoped cross-stack |
| `Rescan path: <dir>` | Directory-scoped |
| `Rescan since <date>` | Git-delta |
| `Reconsider ignored` | Force-display Phase 8.6 ignore list |
| `Show low-confidence detections` | Expand Phase 8.6 to LOW confidence |

## Phase overview

```
preload_config (Phase 0)
    ↓
discover_tech_stack (Phase 1)
    ↓
map_folder_structure (Phase 2)
    ↓
catalog_shared_components (Phase 3) → classify_promotions (Phase 3b)
    ↓
catalog_shared_services (Phase 4)
    ↓
catalog_rest_endpoints (Phase 5)
    ↓
catalog_templates (Phase 6) → build_layout_graph (Phase 6-enh)
    ↓
catalog_config_and_build (Phase 7)
    ↓
write_pipeline_yaml (Phase 8)
    ↓
emit_rescan_guidance (Phase 8.5)
    ↓
propose_unconfigured_detections (Phase 8.6, v18)
    ↓
extract_data_contracts (Phase 9)
    ↓
build_consumer_graph (Phase 10) → classify_button_intents (10c)
    ↓
score_endpoint_reusability (Phase 11)
    ↓
gate → apply → Scope Summary Report (v17)
```

## Phase-by-phase

### preload_config (Phase 0, v17)

Loads shared config every phase uses. Three steps:

- `build_exclusion_flags (0.1)` — reads `scan_exclusions` from pipeline.yaml (43 default exclusions across 7 categories: dependencies, build output, caches, VCS/IDE, infra state, test fixtures, custom). Produces `$EXCLUDE_FLAGS` (for `find`) and `$GREP_EXCLUDE_FLAGS` (for `grep -r`).
- `load_component_naming (0.2)` — reads `component_naming.prefix` (e.g. `sp-`) for Signal 1b extraction. If null, analyzer auto-detects at Phase 3.
- `validate_exclusions (0.3)` — warns on typo patterns in `scan_exclusions.custom` (non-blocking).

### discover_tech_stack (Phase 1)

Scans the project for technology indicators. Reads dependency manifests (`pom.xml`, `package.json`, `requirements.txt`, `environment.yml`) and greps for framework signatures (`@NgModule`, `@Path`, `@app.route`, `@Component`).

Output: `project-map.md § 1 Tech Stack` with languages, frameworks, DB, infra, CI/CD, AI/ML, testing.

### map_folder_structure (Phase 2)

Maps every major directory with purpose and owning framework. Depth was raised from 3 to 6 to catch nested feature folders (e.g. `{frontend_path}/feature/subfeature/handlers/`). Passthrough detection: folders with only subdirectories are flagged so the tree stays readable.

Output: `project-map.md § 2 Folder Structure` grouped by framework.

### catalog_shared_components (Phase 3)

The component discovery engine. Uses 6 signals per component:

1. **Filename** (weak) — e.g. `spReviewerSelector.js`
2. **1b Naming convention** (STRONG, v17) — strips prefix, parses suffix against 30-entry primitive table (select, radio, modal, grid, date-picker, etc.)
3. **Props/Inputs/Bindings** (STRONG) — reads declared scope/@Input/@Output
4. **Template contents** — what DOM elements the component renders
5. **Library wrapper** — detects wrapping of third-party libraries (ui-select, mat-dialog, etc.)
6. **Developer intent hints** — comments, @description tags

Signal 1b (v17) is the reason "when ticket asks for select dropdown, `sp-*-select*` triggers" works deterministically. Without it, detection depended on whether props documentation was good.

Output: `project-map.md § 3 Shared UI Components` with name, path, primitives, aliases, API, consumers, confidence.

### classify_promotions (Phase 3b)

Every component gets a promotion status:

- **AUTO_PROMOTED** — already in shared directory, no action
- **CROSS_FEATURE** — feature-local but used by 3+ features → promote to shared
- **CONSOLIDATION** — multiple near-identical wrappers exist → pick one, retire others
- **FEATURE_LOCAL** — correctly scoped to a single feature

Output: `project-map.md § 3b Promotion Recommendations`.

### catalog_shared_services (Phase 4)

Same pattern as Phase 3 but for services. Reads service folders, extracts public method signatures + parameter types + return types.

Output: `project-map.md § 4 Shared Frontend Services` + `§ 5 Shared Backend Services`.

### catalog_rest_endpoints (Phase 5)

Finds all API paths by greping framework-specific decorators: `@Path`, `@RequestMapping`, `@GetMapping`, `@app.route`, Express `app.get`. Extracts HTTP verb + path + parameter types.

Output: endpoint list; schema extraction is deferred to Phase 9.

### catalog_templates (Phase 6) + build_layout_graph (Phase 6-enh)

- Phase 6: finds templates/partials (`.html`, `.xhtml`, `.pug`) by folder + naming pattern
- Phase 6-enh: traces `extends`/`includes`/`ng-include`/`router-outlet` to build inheritance graph

Output: `project-map.md § 6 Templates & Partials` + layout inheritance graph.

### catalog_config_and_build (Phase 7)

Reads config files (`init.xml`, `UIConfig.xml`, `.env` templates, `application.yml`) and build manifests (`package.json` scripts, `build.xml` targets). Distinguishes module registrations from feature config.

Output: `project-map.md § 7` config + build sections.

### write_pipeline_yaml (Phase 8)

**The auto-populate phase.** Writes THREE specific blocks to pipeline.yaml, preserving everything else:

- `shared_paths:` — where shared code lives per framework, with `provides[]` populated via Signal 1b
- `operation_patterns:` — canonical templates for fetch_list, create, update, delete per project
- `i18n:` — messages file location, key format, allowed/forbidden content defaults

User-owned blocks (`skills`, `runtime`, `jira`, `rescan_hints`, `intent_classification`, `analyzer_ignore`) never touched.

Step 8c (v15.0 W3) refines `skills.explorer.paths` from Phase 2 folder data, proposing additions/removals at the pre-write gate.

### emit_rescan_guidance (Phase 8.5, v14.2)

Three blocks output after every analyze/rescan, persisted in `project-map.md § 🧭 Rescan Guidance`:

- **Rescan Menu** — valid rescan commands for THIS project, generated from layer_map + file counts
- **Drift Detected** — per-scope drift since last rescan (HIGH/MEDIUM/LOW priority) — only on rescans, not first scan
- **Unmapped Content** — languages/directories not in layer_map or shared_paths, with ready-to-paste config stubs

Configurable via `rescan_hints.drift_thresholds` (default: 25 HIGH, 10 MEDIUM, 3 LOW, 60 days stale).

### propose_unconfigured_detections (Phase 8.6, v18)

Surfaces frameworks/directories found in code but not in pipeline.yaml. Per-item gate with four options (Apply A: append to existing layer, Apply B: create new layer, Ignore, Defer) + batch ops + LOW confidence filtering + sticky ignore list with growth-based re-propose.

Why this differs from Phase 8.5's Unmapped Content: Phase 8.5 shows raw stubs. Phase 8.6 shows structured proposals with Apply/Ignore actions, diff previews, and attribution comments.

### extract_data_contracts (Phase 9)

For each endpoint, extract request body schema, response schema, query parameters. Classifies by confidence (v15.0):

- **HIGH** — typed framework with validation (Spring `@Valid`, Pydantic, Zod)
- **MEDIUM** — typed but no validation decorators
- **LOW** — untyped framework (Flask with plain `request.json`)
- **NONE** — dynamic routing or proxy endpoints where contract can't be extracted

Step 9a tries OpenAPI/Swagger fast path first. Step 9b falls back to framework-specific regex extraction.

Output: `project-map.md § 6` endpoint entries with `contract_confidence:`, `contract_source:`, full request/response schemas.

### build_consumer_graph (Phase 10) + classify_button_intents (10c)

For each REST endpoint, finds every frontend consumer and traces backward: FE file → HTTP call → BE endpoint → service method → DAO → DB table.

Step 10c (v15.0) classifies buttons via a YAML decision tree:

- `destructive-confirm` — delete/remove/revoke with confirmation
- `destructive-immediate` — force-actions like disable-user
- `submit` — form submissions
- `navigation` — links, redirects
- `async-action` — long-running ops (certify, provision)
- `toggle` — on/off switches
- `bulk-action` — batch operations

Uses `intent_classification.verb_synonyms` from pipeline.yaml (pack-specific lexicon merged with kernel defaults).

Output: `project-map.md § 10 Consumer Graph` + `§ 10c Button Intents`.

### score_endpoint_reusability (Phase 11)

Scores each endpoint 0-10 across five dimensions (filterability, pagination, field selection, response shape, consumer diversity). Classifies HIGH (9-10), MEDIUM (5-8), LOW (2-4), FEATURE-LOCAL.

Output: `project-map.md § 11 Endpoint Reusability`.

## Inputs

| Source | What's read |
|---|---|
| `contexts/config/pipeline.yaml` (existing) | `scan_exclusions`, `component_naming`, `shared_paths` (if any), `skills.layer_map`, `rescan_hints`, `intent_classification`, `analyzer_ignore` |
| `contexts/project-map.md` (existing, on rescan) | prior state for diff computation |
| Source code (filesystem) | everything else |

## Outputs

Primary: `contexts/project-map.md` with 11 sections (plus Rescan Guidance). Secondary: three auto-populated blocks in `pipeline.yaml`.

After apply, emits Scope Summary Report (v17) — current-state overview of the rescanned scope: stacks, reusable components by primitive, shared locations, promotion candidates, coverage gaps, contract confidence breakdown, reusability distribution.

## Hand-off contract

Analyzer doesn't hand off to a specific next agent — it runs asynchronously. Output is consumed by:

- **Orchestrator** — reads `project-map.md` sections + `pipeline.yaml` shared_paths/operation_patterns during its `synthesize_lld (B)` phase
- **Explorer** — reads map entries during `reuse_discovery (E.0)`
- **Review** — writes to map via `project_map_update (PART 5b)` after each story
- **Ship** — validates map markers via v15 integrity check pre-commit

## Dependencies

- **pipeline.yaml must exist with `skills.layer_map`** before first run. Installer creates it.
- **`scan_exclusions` and `component_naming` blocks** should be populated (v17+). Packs ship defaults.
- **Git required** for `Rescan since <date>` and drift detection. Without git, drift falls back to file-mtime.

## Token economics

| Operation | Typical cost |
|---|---|
| Initial `Analyze project` | ~40-80k tokens (one-time) |
| Full `Rescan project` | ~30-60k (if unchanged, faster; if significant drift, closer to full) |
| `Rescan frontend` or `Rescan backend` | ~10-20k |
| `Rescan <Stack>/<Section>` | ~3-8k |
| `Rescan path: <dir>` | proportional to directory size |

The analyzer is the most expensive agent. Per-story agents (Orchestrator, Explorer, Surgeon) all run 5-10x cheaper because they LOOK UP in the map instead of rebuilding it.

## Common failure modes

- **Stale pipeline.yaml from earlier version** — if `scan_exclusions` missing, analyzer falls back to per-phase exclusion lists. Fix: regenerate pipeline.yaml or manually add the block.
- **Layer_map missing framework** — Phase 8.5 Unmapped Content + Phase 8.6 proposals catch this. User applies, rescans.
- **Component naming ambiguous** — if no dominant prefix in shared dirs, Phase 3 auto-detect fails. User sets `component_naming.prefix` manually in yaml.
- **Phase 9 contract extraction returns NONE for many endpoints** — often caused by framework using dynamic dispatch. Manual override: annotate LLD tasks with `contract_source: manual` + hand-written schema.
- **Consumer graph misses cross-repo dependencies** — analyzer only scans the current repo. Multi-repo projects need per-repo analysis + manual cross-linking.

## Configuration knobs

All live in `contexts/config/pipeline.yaml`:

```yaml
scan_exclusions:                  # v17
  dependencies: [...]
  build_output: [...]
  caches: [...]
  vcs_and_ide: [...]
  infra_state: [...]
  test_fixtures: [...]
  custom: []                      # user appends

component_naming:                 # v17
  prefix: "sp-"                   # null = auto-detect
  custom_suffix_map: {}

rescan_hints:
  enabled: true
  drift_thresholds:
    high_file_count: 25
    medium_file_count: 10
    low_file_count: 3
    stale_days: 60
  detection_thresholds:           # v18 (Phase 8.6)
    framework_min_files: 3
    shared_dir_min_files: 3
    build_tool_min_files: 1
    growth_multiplier: 2
  freshness_check:                # v19 (used by Orchestrator, not analyzer itself)
    ...
  unmapped_detection:
    enabled: true
    min_file_count: 3
    shared_dir_patterns: [...]

analyzer_ignore: []               # v18 — user-maintained via Phase 8.6 gate

intent_classification:            # used by classify_button_intents (10c)
  verb_synonyms:
    destructive: [delete, remove, revoke, drop, ...]
    submit: [save, apply, confirm, ...]
    async: [certify, provision, delegate, ...]   # pack-specific extensions
    # ...
```

## Cross-agent awareness

- **Orchestrator's `freshness_check (A.0.5)`** consults analyzer's `rescan_log` (in project-map.md) to determine per-ticket staleness.
- **Explorer's `check_file_freshness (0c)`** consults the same `rescan_log` for per-file staleness.
- **Review's `project_map_update (PART 5b)`** writes incrementally to the same project-map without invoking analyzer.
- **Ship's v15 marker integrity check** validates the metadata that `extract_data_contracts (9)` and `classify_button_intents (10c)` wrote.

## Version history

- v14.0 — introduced `project-map.md` + Phases 9, 10, 11
- v14.1 — Rescan Command Router
- v14.2 — Phase 8.5 Rescan Menu + Drift Detection + Unmapped Content
- v14.3 — moved `project-map.md` to `contexts/` root
- v15.0 — 4-tier contract confidence + Phase 10c intent classification + Step 8c explorer_paths refinement
- v15.1 — rescan preflight (8 checks) + synthetic fixture harness + VALIDATION-CHECKLIST.md
- v17.0 — centralized scan_exclusions + Signal 1b naming + Scope Summary Report + Phase 2 depth 6
- v18.0 — Phase 8.6 "Detected but not configured" gate
- v19.0 — `rescan_log` metadata consumed by Orchestrator's freshness check
- v20.0-21.0 — semantic phase names
