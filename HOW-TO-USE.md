# How To Use

**Who:** tech lead rolling the pipeline out + developers using it.
**What:** everything you need to go from unzip → first shipped PR, plus standalone + enrichment + MCP.

---

## Quick Start

```
You: @orchestrator.md Work on PROJ-1234
[Orchestrator → Explorer → Surgeon → (AC-E2E-Check, optional) → Review → Ship]
```

One command per step. A gate between each. Ticket-to-PR in 6 gates.

**Cursor tip:** always prefix with `@<agent-file>.md <trigger>` for reliable invocation. Plain triggers work via the rule router but can be flaky. Claude Code users don't need the `@`.

---

## Command Cheat Sheet

Three ways to run — pick by the shape of the work:

| Mode | Use when | Start with |
|------|----------|-----------|
| **1 · Direct** | One JIRA story, full pipeline → PR | `@orchestrator.md Work on PROJ-1234` |
| **2 · Standalone & offline** | Ad-hoc single-agent work, or no-network / private runs | `@explorer.md Research: …` · add `--offline` to any trigger |
| **3 · Bundle** | 2–10 related stories → ONE branch + ONE PR | `@bundle-orchestrator.md Work on epic stories …` |

_Setup & admin commands are further down._

---

### 1 · Direct — ticket end-to-end

The main flow. Most of your work happens here.

| I want to… | Command |
|------------|---------|
| Work on a JIRA ticket end-to-end | `@orchestrator.md Work on PROJ-1234` |
| Work on a ticket using a prior ticket as a pattern | `@orchestrator.md Work on PROJ-1234 — reference: PROJ-100` |
| Work on a ticket with a design attached | `@orchestrator.md Work on PROJ-1234` + attach image |
| Amend the LLD before Explorer runs | At Phase C gate: `Amend: <your change>` |
| Continue after Orchestrator's Go gate | `@explorer.md Run the explorer` → `@surgeon.md Run the surgeon` → `@review.md Run the review` → `@ship.md Ship it` |
| Run AC-E2E-Check between Surgeon and Review (optional) | `@ac-e2e-check.md Demo PROJ-1234` |
| Slim Review (integration + AC + blast only; trusts Surgeon's per-task work) | `@review.md Run the review --slim` (~$0.30; skip per-task checklist) |
| Full Review (mandatory before Ship) | `@review.md Run the review` (~$0.50; full per-task + AC + blast + visual + pattern) |

---

### 2 · Standalone & offline

**Standalone (no ticket)** — single-agent, ad-hoc runs. Output lands in `contexts/standalone/`. Size caps apply (see "Standalone Mode" section below).

| I want to… | Command |
|------------|---------|
| Research a codebase question | `@explorer.md Research: <question>` |
| Apply a small targeted fix | `@surgeon.md Apply: <spec> in <files>` |
| Implement from ACs (no ticket) | `@surgeon.md Implement:` + bullet list of ACs |
| Spot-check git diff before commit | `@review.md Review changes` |
| AC-coverage review of an existing ticket | `@review.md Review PROJ-1234` |
| AC-coverage review with inline ACs | `@review.md Review against:` + bullets |
| Ad-hoc browser walk of a URL | `@ac-e2e-check.md Demo <URL>` |

**Offline / selective MCP** — per-run flags; combine with any pipeline trigger (direct **or** bundle). See "Running without MCP" below for full details + examples.

| I want to… | Command |
|------------|---------|
| Work on a ticket with no MCP at all | `@orchestrator.md Work on PROJ-1234 --offline` (provide ticket via `contexts/ticket-input.md` or inline `Context:`) |
| Skip specific MCPs only | `@orchestrator.md Work on PROJ-1234 --skip atlassian,figma` |
| Use only specific MCPs (skip the rest) | `@orchestrator.md Work on PROJ-1234 --only github` |

---

### 3 · Bundle — multi-story consolidation

Bundle 2–10 related stories into ONE LLD, ONE branch, ONE PR. Use when stories share code (overlapping ACs, shared components). Does NOT change single-story flow above.

| I want to… | Command |
|---|---|
| Bundle a known list of related stories | `@bundle-orchestrator.md Work on epic stories PROJ-1234, PROJ-5533, PROJ-2344` |
| Bundle all children of an epic in a status | `@bundle-orchestrator.md Work on epic PROJ-EPIC-42 with status="Ready for Dev"` |
| Bundle by status group (uses `jira.status_groups`) | `@bundle-orchestrator.md Work on epic PROJ-EPIC-42 group=ready_for_dev` |
| Continue bundle after Orchestrator's Go | `@explorer.md Run the explorer` → `@surgeon.md Run the surgeon` → `@review.md Run the review` → `@ship.md Ship it` (auto-detects bundle from `mode: bundle` in the contexts file — same words as single-story) |
| Resume mid-bundle after a stop | Re-issue the original `Work on epic stories ...` trigger — bundle-orchestrator's BR.0 finds `_bundle-state.yaml` and offers Resume options |
| Resume one specific stage | `@surgeon.md Resume bundle-surgeon for <BUNDLE_ID> from T<N>` (or `bundle-explorer` / `bundle-review` / `bundle-ship`) |
| Run upfront grep-based overlap analysis | Append `--deep` to the trigger (~10–20K extra tokens, amortized) |
| Override the size cap | Append `--max=<N>` (cannot exceed `runtime.bundle.max_tickets`) |
| Re-synthesize from scratch | Append `--fresh` (preserves the branch; resets state cursors) |

**What you get:**
- One consolidated 3-file LLD: `<BUNDLE_ID>.md` + `-lld.md` + `-testplan.md` (where `<BUNDLE_ID>` looks like `proj-epic-42-bundle-a3f2`)
- AC Registry where every row carries `Source: <ticket>` so per-ticket coverage is preserved through Review
- Tasks ordered by layer + dependency (DB → backend → REST → frontend → templates)
- Surgeon + Review checkpoint every 5 tasks (`runtime.bundle.checkpoint_every`) — each checkpoint emits a fresh-chat resume deeplink to keep the context window healthy
- One PR closing every shipped ticket; per-ticket JIRA transitions; one `<BUNDLE_ID>-summary.md` post-ship

**When NOT to use bundle:**
- Single ticket → use the regular `Work on PROJ-1234` flow
- Tickets span sprints or have unrelated code areas — overhead eats the savings
- Bug tickets — bundle accepts Story / Task / Spike only
- You need per-ticket production rollback granularity

**Cost expectation (real API-billing numbers, Sonnet 4.5):**

Per-agent cost is dominated by cache reads (every tool call re-reads the cached system prompt). Real per-agent cost is **$3–6 on Sonnet 4.5**, **$1.50–4 on Haiku 4.5** — not the $0.50/agent that file-read math suggests.

| Scenario | Sonnet 4.5 | Haiku 4.5 |
|---|---|---|
| 1 single story cold | $15–30 | $8–18 |
| 10 single stories sequential, back-to-back (cache-warm) | $80–180 | $50–110 |
| 10 stories bundled (recommended for related work) | $80–180 | $50–110 |
| 10 single stories spread across days (cache-cold every time) | $150–300 | $80–180 |

Bundle wins are **wall-clock (~30–40% faster), code dedup at design time, 1 PR vs N** — token saving over warm sequential is only 10–20%, but vs cold sequential it's ~50%. Use bundle when stories share code; use single-story for unrelated work.

**To reduce cost:** finish each agent within ~5 min of starting it (5-min cache TTL — going idle costs 10× on the next tool call). Run agents back-to-back to keep cache warm.

**Mid-bundle failure handling:** if Review verdict is `PARTIAL` (some tickets pass ACs, some don't), Ship's gate prompts (per `runtime.bundle.partial_ship_policy: ask`):
- `Halt and fix` — stop and resume Surgeon at the failing tasks
- `Ship passing tickets only` — JIRA transitions fire only for YES tickets; failing tickets stay in pre-bundle state
- `Ship anyway with gaps` — closes all tickets in the PR; transitions only YES; PR body labels gaps as fix-forward

---

### Project setup & maintenance

Infrequent — usually one-time at project onboarding or when the codebase shifts.

| I want to… | Command |
|------------|---------|
| First-time project analysis (creates project-map, populates config) | `@project-analyzer.md Analyze project` |
| Rescan a specific stack or section (after significant code churn) | `@project-analyzer.md Rescan <stack>[/section]` |

### Pipeline admin (tools)

Release / config management. Most team members rarely run these.

| I want to… | Command |
|------------|---------|
| Install pipeline into a project (default pack: `your-project`) | `npm run install-pipeline -- --project-root /path` |
| Install with a specific pack | `npm run install-pipeline -- --project-root /path --pack <name>` |
| List available packs | `npm run install-pipeline -- --list-packs` |
| Validate pipeline config | `node contexts/tools/validate.mjs` |
| Sync config splits → seed (before promoting to pack) | `npm run pipeline:merge` |
| Refresh splits from seed (rare — overwrites local splits) | `npm run pipeline:split --force` |
| See where time / tokens / tool calls actually went | `node contexts/tools/aggregate-tool-usage.mjs` |
| See one specific story's ledger | `node contexts/tools/aggregate-tool-usage.mjs --story PROJ-1234` |
| See last 5 stories aggregated | `node contexts/tools/aggregate-tool-usage.mjs --last 5` |

### Reading the Tool Usage Ledger

Every agent (single-story or bundle) appends a structured block to `contexts/<epic>/<TICKET>-tool-usage.md` (or `<BUNDLE_ID>-tool-usage.md`) at the end of its run. The ledger captures **what** each agent did — MCP calls, git ops, bash invocations, file reads/writes, build invocations, estimated cost.

Open the file directly to read one story's run, OR run the aggregator for cross-story summaries:

```
node contexts/tools/aggregate-tool-usage.mjs                  # all stories
node contexts/tools/aggregate-tool-usage.mjs --epic proj-1200      # one epic
node contexts/tools/aggregate-tool-usage.mjs --last 5             # most recent N
node contexts/tools/aggregate-tool-usage.mjs --json               # machine-readable
```

Output includes per-agent durations, tool-call counts, build wall-clock, estimated $ subtotal, plus auto-suggested optimization hints (e.g., "Surgeon avg X bash invocations/run — likely candidate for parallel-grep batching").

**Important caveat**: numbers are agent-side estimates. Counts (MCP / git / bash / reads / writes / builds) are exact because the agent issues the commands itself. Token / cost estimates are approximate within ~30% — the agent doesn't see the API billing. For exact billing, cross-reference with Anthropic Console or Cursor billing. The ledger is for **finding patterns and anomalies**, not auditing exact spend.

Schema definition lives in `agent-pipeline/rules/agent-flow.mdc § Tool Usage Tracking`.

---

## Pipeline Mode — With user approvals

```
Orchestrator → branch + 3-file LLD
    Gate: review LLD, amend or Go
Explorer → exploration file + codebase map sync
    Gate: review exploration, proceed
Surgeon → code changes + manifest (per-task loop)
    Gate: review changes, optionally run AC-E2E-Check
AC-E2E-Check → browser verification (OPTIONAL)
Review → full review report + ship-ready verdict
    Gate: review report
Ship → commit + PR + JIRA transitions
```

**What happens at each step:**

| Agent | Reads | Writes | Purpose |
|-------|-------|--------|---------|
| Orchestrator | JIRA ticket, project-map, epic-context | `<TICKET>.md` + `<TICKET>-lld.md` + `<TICKET>-testplan.md` + branch | Synthesize LLD; create branch; gate for amendment |
| Explorer | LLD PART 2, codebase-map, project-map | `<TICKET>-exploration.md`, syncs codebase-map | Find existing code, insertion points, reuse |
| Surgeon | Exploration, LLD PART 2, LLD PART 4 | `<TICKET>-manifest.md` + uncommitted code | Execute tasks in dependency order |
| AC-E2E-Check (optional) | AC Registry, LLD PART 2 | Browser screenshots + new tasks if gaps | Verify ACs in real browser |
| Review | Manifest, LLD, git diff | `<TICKET>-review.md` + epic-context update | Full build, tests, AC compliance, blast radius |
| Ship | Review, manifest, LLD | Git commit + PR + JIRA update + codebase-map metadata | Commit, push, open PR, transition ticket |

---

## Standalone Mode — run one agent at a time

When you want ad-hoc work without the full pipeline. Each standalone trigger is single-agent and produces a scoped output in `contexts/standalone/`.

| Agent | Triggers | Output |
|-------|----------|--------|
| Explorer | `Research: <q>` or `Explore: <spec>` | `standalone-exploration-{ts}.md` |
| Surgeon — Apply | `Apply: <spec> in <files>` | `standalone-manifest-{ts}.md` + code (≤5 files, ≤150 lines) |
| Surgeon — AC-driven | `Implement:` + bullets of ACs | `standalone-ac-manifest-{ts}.md` + code (≤5 ACs, ≤5 files, ≤150 lines) |
| Review — diff | `Review changes` | `standalone-review-{ts}.md` — code quality only |
| Review — ticket | `Review <TICKET>` | `standalone-ticket-review-{ts}.md` — AC coverage + quality |
| Review — ac-driven | `Review against:` + bullets | `standalone-ac-review-{ts}.md` — inline ACs + quality |
| AC-E2E-Check | `Demo <URL>` or `Verify: <scenario>` | `standalone-demo-{ts}.md` — browser walk |

**No standalone:** Orchestrator (it IS the pipeline start), Explorer-bug (needs structured Bug Context), Ship (safety rail — requires Review).

**When standalone says "use pipeline instead":** Surgeon's 5-file / 150-line cap, more than 5 ACs, Review missing blast radius for a real story. Promote to pipeline when you hit these.

---

## Enrichment — reference stories + design images + MCP auto-discovery

Layered onto any mode (pipeline OR standalone). Caps: 1 reference ticket + 3 images per run.

### Ways to provide enrichment

**Explicit, via trigger:**
```
@surgeon.md Implement:
  - AC1: ...
  - AC2: ...
  — reference: PROJ-100
[attach design.png]

@review.md Review PROJ-1234 against pattern PROJ-100
[attach design.png]
```

**Automatic, via MCP (when connected):**
```
@orchestrator.md Work on PROJ-1234
# Atlassian MCP: auto-discovers linked issue PROJ-100, fetches 2 JIRA image attachments
# Figma MCP: auto-fetches Figma frames from URLs in JIRA description
# GitHub MCP: inspects reference ticket's PR for ship-ready verification
```

### What each MCP unlocks

| MCP | Auto-discovers |
|-----|----------------|
| Atlassian | Reference tickets from linked issues (any type in `jira.reference_link_types`); JIRA image attachments; reference suggestions from comments |
| Figma | Fetches structured frame data from Figma URLs in JIRA description |
| GitHub | Fetches reference ticket's merged PR for pattern comparison (Review); inspects PR status (Orchestrator) |

### Graceful fallback

| Setup | Behavior |
|-------|----------|
| No MCPs, no explicit trigger | Standard pipeline — unchanged |
| MCPs connected, no explicit trigger | Auto-discovered enrichment flows through all 5 phases |
| Explicit trigger only | Trigger wins, fills any remaining image slots from other sources |
| Explicit + MCP with conflict | Explicit wins, warn about ignored MCP findings |
| Reference missing / pack mismatch | Warn, proceed without enrichment (never halt) |

See per-agent docs for exactly how each agent consumes enrichment.

---

## Output Layout

```
contexts/
├── config/
│   └── pipeline.<pack>.yaml                   config — see "Config Essentials" below
├── project-map.md                               Project Analyzer output (shared globally)
├── archive/                                     optional — shipped tickets moved here
│
├── <epic-lower>/                                ticket artifacts nested under epic
│   ├── codebase-map.md                          epic file catalog (Explorer maintains)
│   ├── epic-context.md                          epic knowledge log (Review appends)
│   ├── PROJ-1234.md                             Requirement Summary + ACs + Companion index
│   ├── PROJ-1234-lld.md                         PART 1 Design + PART 2 Tasks
│   ├── PROJ-1234-testplan.md                    PART 3 Test Plan + PART 4 Test Tasks
│   ├── PROJ-1234-exploration.md                 Explorer's task annotation summary
│   ├── PROJ-1234-manifest.md                    Surgeon's per-task change rows
│   └── PROJ-1234-review.md                      Review's full report
│
└── standalone/                                  ad-hoc (no ticket) outputs
    ├── standalone-exploration-{ts}.md
    ├── standalone-manifest-{ts}.md
    ├── standalone-ac-manifest-{ts}.md
    ├── standalone-review-{ts}.md
    ├── standalone-ticket-review-{ts}.md
    ├── standalone-ac-review-{ts}.md
    └── standalone-demo-{ts}.md
```

**Why nested by default:** `runtime.contexts_layout.nested_by_epic: true` keeps the tree organized per epic and gives each epic its own codebase-map.
**Flat mode** (`nested_by_epic: false`): everything flat under `contexts/`. Both layouts coexist — flip the flag, it applies to new tickets.

---

## Choosing a pack

The kernel is **pack-agnostic** — it ships with a your-project pack, and you can author more.

| Pack | Status | When to use |
|------|--------|-------------|
| **`your-project`** | Default. Public, didactic | Starting a new project. Covers Angular 18/19, React, Vue 3, JavaScript, TypeScript, Java standards as worked examples. Copy + rename to seed your own pack. |
| **`<your-pack>`** | You create | After you've copied `packs/your-project/` → `packs/<your-pack>/`, edited the seed, and added your project-specific skills + rules |

### How packs work — at a glance

Every install combines **kernel** (pack-agnostic agents/rules/skills) + **chosen pack** (project-specific rules + skills + the trigger map):

```
.cursor/
├── agents/    ← kernel only (15 agents — same for every pack)
├── rules/     ← kernel rules (agent-flow, engineering-principles)
│              + pack rules (e.g. your-project-project-scope.mdc)
└── skills/    ← kernel skills (8 generic) + pack skills (e.g. your-project-react-standards.md)

contexts/config/pipeline.<PACK>.yaml         ← THE TRIGGER MAP
                                                (which skill loads when, what builds run, etc.)
```

The kernel agents are pack-agnostic — they reference `pipeline.{PACK}.<role>.yaml` and resolve `{PACK}` from `meta.pack` at pre-flight. So the same kernel agent prompts work whether you install `--pack your-project` or `--pack <your-pack>`.

### Authoring your own pack

```bash
cp -r packs/your-project packs/<your-pack>
# Rename pipeline.your-project.yaml → pipeline.<your-pack>.yaml
# Set meta.pack: <your-pack> in the seed
# Edit rules/, skills/, and pipeline.<your-pack>.yaml for your project
npm run install-pipeline -- --pack <your-pack> --project-root /path/to/project
```

`packs/your-project/README.md` is the full guide — naming conventions, how to add a skill, how to add a rule, what `project-analyzer` writes vs what you author.

---

## For the Tech Lead — one-time setup

### Step 1 — Install

```bash
# From the unzipped release folder

# Option 1: your-project pack (default, didactic — recommended for new projects)
npm run install-pipeline -- --project-root /path/to/your/project

# Option 2: explicit pack name
npm run install-pipeline -- --pack your-project --project-root /path/to/your/project
npm run install-pipeline -- --pack <your-pack> --project-root /path/to/your/project
```

Copies the kernel + pack into your project's `.cursor/` and `contexts/` folders. The pack's monolithic YAML is **split at install time** into per-agent files so each agent loads only what it needs (saves ~10K tokens per agent). You'll see this in the install log (filenames substitute the pack name):

```
pipeline.<pack>.yaml: split from pack seed
pipeline.<pack>.skills.yaml: split from pack seed
pipeline.<pack>.builds.yaml: split from pack seed
pipeline.<pack>.analyzer.yaml: split from pack seed
pipeline.<pack>.e2e.test.yaml: split from pack seed   # optional, only if pack ships demo config
```

The pack's monolithic source is NOT copied into your project — only the splits land at `contexts/config/`. Agents read directly from the splits.

### Step 2 — Validate

```bash
node contexts/tools/validate.mjs
```

Expects 10 checks to pass. The validator auto-discovers and merges the split YAMLs. Most common failure: YAML indentation in one of the split files.

### Step 3 — Customize the split pipeline YAMLs

Edit the split files directly in `contexts/config/`. The validator merges them at runtime so you can put each section in its proper file. Filenames follow the pattern `pipeline.<pack>.<role>.yaml` — substitute your actual pack name:

| File (substitute `<pack>`) | Edit these keys |
|---|---|
| `contexts/config/pipeline.<pack>.yaml` (core) | `meta.pack`, `runtime.*`, `jira.*`, `mcp_servers.*`, `mcp_roles.*`, `subagents.*`, `intent_classification.*` |
| `contexts/config/pipeline.<pack>.skills.yaml` | `skills.layer_map`, `skills.orchestrator`, `skills.explorer`, `skills.extra_triggers` |
| `contexts/config/pipeline.<pack>.builds.yaml` | `builds.commands`, `builds.forbidden`, `component_structure`, `operation_patterns`, `i18n` |
| `contexts/config/pipeline.<pack>.analyzer.yaml` | `shared_paths`, `scan_exclusions`, `explorer_paths`, `rescan_hints`, `component_naming` (most of this is auto-generated by project-analyzer) |
| `contexts/config/pipeline.<pack>.e2e.test.yaml` | `demo.*` (browser auth, E2E framework, routes, credentials) — optional, only if pack ships demo config |

> **Why does the kernel work for any pack?** Every kernel agent prompt references files as `pipeline.{PACK}.<role>.yaml`. At pre-flight, agents glob `contexts/config/pipeline.*.yaml` for the **core** YAML (single dot in stem), read `meta.pack` from it, and substitute that value for `{PACK}` in every path reference. You don't need to touch this — pack name is auto-discovered. See `agent-pipeline/rules/agent-flow.mdc § Pack Resolution` for the resolution snippet.

Key things to set first:

| Key | What to set | File |
|---|---|---|
| `runtime.branching.base_branch` | Your main dev branch (`develop` / `main`) | core |
| `runtime.branching.prefix_story`, `prefix_bug` | Branch prefixes | core |
| `jira.project_key`, `jira.reference_link_types` | JIRA project + pattern-reference link types | core |
| `skills.layer_map` | Layer → skill filename mapping for your stack | skills |
| `builds.commands`, `builds.forbidden` | Per-layer builds + destructive patterns | builds |
| `demo.*` | Credentials + browser config (optional) | demo |
| `mcp_servers.*` | MCP connector declarations | core |

### Step 3.5 — Team sync workflow (when team member changes config)

Your project repo has only the 5 split files — no monolithic seed. Team members edit the splits directly and commit them:

```bash
# Team member edits a split file
vim contexts/config/pipeline.<pack>.skills.yaml

# Commit the split file directly
git add contexts/config/pipeline.<pack>.skills.yaml
git commit -m "config: add new layer mapping"
git push
```

Other team members `git pull` → they have the updated split → agents pick it up on next run. No merge step required for intra-team sync.

**When to use `npm run pipeline:merge` (optional):**

The merge command is useful in two cases:

1. **PR review convenience** — regenerates a throwaway monolithic file at `contexts/pipeline.<pack>.yaml` so reviewers can see the full config in one place. After review, delete the file (it's gitignored by default in release-only projects):
   ```bash
   npm run pipeline:merge            # writes contexts/pipeline.<pack>.yaml
   # ... review the single file ...
   rm contexts/pipeline.<pack>.yaml  # done, splits are source-of-truth
   ```

2. **Contributing back to the pack** — if a config change is worth shipping as a pack default for all future projects, regenerate the monolithic, then open a PR against the release repo with the updated `packs/<pack>/pipeline.<pack>.yaml`:
   ```bash
   npm run pipeline:merge
   # Copy contexts/pipeline.<pack>.yaml → release-repo/packs/<pack>/pipeline.<pack>.yaml
   # Open a PR against the release repo
   ```

**What `pipeline:split` does (rare):** reverse of merge. Regenerates the 5 splits from a monolithic seed. Useful mainly when a pack author edits the monolithic seed in the release repo and wants to push changes into the splits locally for testing.

**Tech lead PR review checklist (for intra-project config changes):**
- [ ] Team member edited the split file(s) directly (small, focused diff)
- [ ] `node contexts/tools/validate.mjs` passes
- [ ] Reviewer optionally ran `npm run pipeline:merge` locally to see unified view

### Step 4 — Set up MCP servers (each developer)

```bash
# The installer writes contexts/config/mcp.sample.json with all declared servers.
# Each developer copies entries into their personal Cursor/Claude MCP config.

# Atlassian — OAuth flow, browser-based
# GitHub    — personal access token with 'repo' scope
# Figma     — personal access token (optional)
```

See `mcp.sample.README.md` (generated by installer) for step-by-step.

### Step 5 — Run Project Analyzer

```
@project-analyzer.md Analyze project
```

Takes 5–15 minutes. Produces `contexts/project-map.md` and populates yaml auto-blocks (`shared_paths`, `component_naming`, `operation_patterns`, `i18n` in the analyzer + builds split files).

**Three pieces of output worth knowing about:**

1. **`contexts/project-map.md`** — your project's DNA: tech stack, folder structure, shared components, REST endpoints, templates, build system, consumer graph.
2. **🆕 Unmapped Content** — file extensions present in the repo but missing from `skills.layer_map`. Suggests a YAML stub to paste.
3. **💡 Skill Authoring Recommendations** *(Step 8.6h, new)* — for layers configured in `layer_map` but with empty `skills:` list OR missing skill files, the analyzer suggests what to write. Each recommendation includes a concrete topic outline (e.g., "Spring Boot: constructor injection only, @Transactional on services, jakarta.* imports …") and points at the matching reference skill in `packs/your-project/skills/` if one exists. Recommendations persist as a one-liner snapshot in `project-map.md` so authoring debt is visible to the team without re-running the analyzer.

The analyzer **does NOT auto-create skill files** — recommendations are read-only. You author the skill, add the YAML reference, re-install with `--merge-config`. See "Adding new skills and rules" below.

### Step 6 — First real ticket

```
@orchestrator.md Work on PROJ-1234
```

Walk through all gates once yourself before telling the team.

### Step 7 — Tell the team

Share:
- Command cheat sheet (top of this doc)
- Your customizations (if any) to `pipeline.yaml`

---

## Adding new skills and rules

The pipeline becomes more useful as your pack grows — new layer skills, new project-specific rules. This section covers the workflow.

### TL;DR — three-step loop

```
write skill .md  →  add to layer_map (or extra_triggers, or per-agent slot)
                 →  npm run install-pipeline -- --pack <pack> --merge-config
                 →  validator catches typos
                 →  Surgeon resolves it on next matching task
```

Each step matters: the file makes the content available, the YAML makes it triggerable, the install propagates it from `packs/<pack>/` to runtime locations, the validator checks references.

### Scenario A — Add a skill to an EXISTING layer

Most common case. Example: pack already has `Backend/Java` mapped to `<pack>-java-standards.md`; you want to add Spring Boot specifics.

```bash
# 1. Write the skill file
$EDITOR packs/<pack>/skills/<pack>-spring-boot-standards.md
```

```yaml
# 2. Append to packs/<pack>/pipeline.<pack>.yaml — add (don't replace)
"Backend/Java":
  skills:
    - <pack>-java-standards.md
    - <pack>-spring-boot-standards.md   # NEW
  path_glob: "backend/src/main/java/**/*.java"
  ...
```

```bash
# 3. Re-install with --merge-config (preserves analyzer-written sections,
#    refreshes pack-owned sections like skills.layer_map)
npm run install-pipeline -- --pack <pack> --project-root /path --merge-config

# 4. Validator runs automatically. If you typoed:
#    ERROR: skill '<pack>-spring-bot-standards.md' referenced by
#           skills.layer_map['Backend/Java'].skills not found on disk
```

Surgeon picks it up on the next task that touches `backend/src/main/java/**`.

### Scenario B — Add a skill for a NEW layer

When the analyzer recommended a brand-new framework (or you're adding one yourself). Example: adding `Frontend/Svelte`.

```bash
# 1. Write the skill
$EDITOR packs/<pack>/skills/<pack>-svelte-standards.md
```

```yaml
# 2. Add a NEW layer_map entry in pipeline.<pack>.yaml
"Frontend/Svelte":
  skills: [<pack>-svelte-standards.md]
  path_glob: "src/**/*.svelte"
  build: ui_dev
  desc: "Svelte 5 — runes, snippets"
  aliases: ["Svelte", "Frontend Svelte", "SvelteKit"]
```

```bash
# 3. Re-install
npm run install-pipeline -- --pack <pack> --project-root /path --merge-config

# 4. (Optional) Re-run analyzer to populate shared_paths for the new layer
@project-analyzer.md Rescan frontend
```

### Scenario C — Per-agent skill (orchestrator / explorer)

Different wiring path — these live under `skills.orchestrator.*` or `skills.explorer.*`, not in `layer_map`. They load **once per agent invocation**, not per task. Use only when the skill genuinely applies to every run.

```yaml
# In pipeline.<pack>.yaml
skills:
  orchestrator:
    lld_generator: <pack>-lld-generator.md
    ticket_schema_story: <pack>-ticket-schema-story.md
  explorer:
    bug_router: <pack>-bug-localization.md
```

If a slot is unset, the kernel default applies (e.g. `agent-pipeline/skills/ticket-schema-template.md`).

### Adding a Tier 1 rule

Rules in `packs/<pack>/rules/` are **always** Tier 1 (`alwaysApply: true`) — they load on every agent run. They're project-policy guardrails, not per-task guidance.

```bash
# 1. Write the rule
$EDITOR packs/<pack>/rules/<pack>-<topic>.mdc
```

```markdown
---
description: One sentence — what this rule enforces and why.
alwaysApply: true
globs:                # optional — narrows applicability to certain files
  - "**/*.ts"
---

# Rule body
```

```bash
# 2. Re-install — rules merge into .cursor/rules/ at install time
npm run install-pipeline -- --pack <pack> --project-root /path --merge-config
```

No YAML wiring required. Rules are discovered by directory scan; skills are declared in YAML because their loading is conditional.

### Naming convention

| Layer | Kernel default | Pack-supplied |
|-------|---------------|---------------|
| Rule | `<topic>.mdc` (no prefix) | `<pack>-<topic>.mdc` |
| Skill | `<topic>.md` (no prefix) | `<pack>-<topic>-standards.md` |
| Subagent | `subagent-<name>.md` | `subagent-<pack>-<name>.md` |

The pack prefix is enforced — both because the installer copies kernel + pack files into the same `.cursor/skills/` directory, and because the validator's reference checker scans by filename. Without prefixes, packs would collide with the kernel.

### Direct-edit alternative (use sparingly)

Technically you can drop a skill straight into `.cursor/skills/<name>.md` and reference it from `contexts/config/pipeline.<pack>.skills.yaml` without going through the pack workflow. **It works** — the agent doesn't care where the file came from. But:

- `--merge-config` overwrites pack-owned sections in the runtime YAMLs, so your YAML edit is gone next install. Skill file survives but goes orphaned.
- `.cursor/` is typically gitignored — your teammates don't get it.
- Cursor and Claude Code use different layouts (`.cursor/skills/<name>.md` vs `.claude/skills/<name>/SKILL.md`) — direct edit means maintaining both by hand.
- Step 8.6h (skill recommendations) scans `packs/<pack>/skills/`, not `.cursor/skills/`. The analyzer will keep nagging you to author a skill that "doesn't exist" (from its perspective).

Healthy pattern: **iterate fast in the runtime location, promote to the pack when stable.** Once you like the skill, copy into `packs/<pack>/skills/`, mirror the YAML edit into the seed, run `--merge-config`, commit.

Full reference: **`packs/your-project/README.md`** — worked examples, conventions, and the analyzer/author boundary table.

---

## For Developers — per-ticket flow

1. **Start:** `@orchestrator.md Work on PROJ-1234` (attach design image if you have one)
2. **Phase C gate:** review the LLD summary. If something's wrong → `Amend: <what to change>`. If good → `Go`.
3. **Explorer:** `@explorer.md Run the explorer`. Review Task Annotation Summary. Usually `Run the surgeon`.
4. **Surgeon:** `@surgeon.md Run the surgeon`. Surgeon runs per-task loop; gate after final build.
5. **Optional AC-E2E-Check:** `@ac-e2e-check.md Demo PROJ-1234` for browser verification.
6. **Review:** `@review.md Run the review`. Reports ship-ready YES/NO. Fix any P0 blockers and re-run if needed.
7. **Ship:** `@ship.md Ship it`. Commit + push + PR + JIRA transition.

**If something goes wrong at any gate:** every agent's halt message tells you exactly what command to run next. Read the message — don't guess.

---

## Running without MCP (offline / selective)

By default, Orchestrator uses configured MCP servers (Atlassian for JIRA + Confluence, Figma for designs, GitHub for reference PRs). You can skip any/all per-run — saves tokens (~15-40K per story) and works when MCPs are unavailable or content is sensitive.

### The input file — where ticket content goes

On first install, the installer creates **`contexts/ticket-input.md`** from the shipped template. It's ready to fill — no copy step needed. When you skip Atlassian (so the orchestrator can't fetch JIRA), this file is what it reads instead.

```
contexts/ticket-input.md   ← edit this before running --skip atlassian or --offline
```

Preserved across re-installs (your filled-in content survives). Reset with `--force-config` during install if you want a fresh template.

### Trigger flag reference

| Flag | Effect | What you must provide |
|---|---|---|
| `--offline` | Skip all 3 MCPs | `contexts/ticket-input.md` + images + (optional) local reference |
| `--skip atlassian` | Skip JIRA/Confluence only | `contexts/ticket-input.md` OR inline `Context:` |
| `--skip figma` | Skip Figma only | Drag-drop images into chat |
| `--skip github` | Skip GitHub only | Usually nothing — GitHub is rare |
| `--skip atlassian,figma` | Skip both (comma-separated) | ticket-input.md + attached images |
| `--only github` | Use ONLY GitHub, skip the rest | ticket-input.md + attached images |

### Example 1 — `--skip atlassian` (have ticket text, still want Figma + GitHub)

You have the JIRA ticket text in front of you but don't want the MCP round-trip:

**Step 1:** edit `contexts/ticket-input.md`:
```markdown
# PROJ-1234 — Add entitlement filter to cert page

## Ticket summary
Allow users to filter certification list by entitlement. Filter appears between
search bar and status filter, uses existing sp-dropdown, persists across reloads.

## Acceptance Criteria
- AC1: Given user on /ui/certification/list.jsf, When page opens, Then "Entitlement" dropdown appears
- AC2: Given dropdown open, When user selects entitlement, Then cert list filters to matches
- AC3: Given selection, When user reloads, Then selection restores via session storage

## In scope
- UI filter on cert list page + session storage

## Out of scope
- Backend filter API (exists at /rest/ui/certifications?entitlement=)
- Filter on other list pages

## Epic
PROJ-1200
```

**Step 2:** trigger:
```
@orchestrator.md Work on PROJ-1234 --skip atlassian
```

Orchestrator reads `contexts/ticket-input.md`, uses Figma MCP for designs (still active), uses GitHub MCP for any reference PR lookups. Saves ~10-20K by skipping Atlassian probing + Confluence HLD fetch.

### Example 2 — `--skip figma` (have designs locally, still want JIRA)

You have design screenshots on your desktop, want JIRA ticket fetch to work normally:

**Step 1:** drag your design screenshots into the Cursor/Claude chat input (up to 3).

**Step 2:** trigger (no file edit needed — Atlassian fetches the ticket):
```
@orchestrator.md Work on PROJ-1234 --skip figma
```

Orchestrator fetches ticket from JIRA normally; uses the 3 attached images for Visual Specification instead of fetching Figma frames. Saves ~10-25K for Figma-heavy tickets.

### Example 3 — `--skip atlassian,figma` (have both locally)

Most common "offline-ish" pattern:

**Step 1:** edit `contexts/ticket-input.md` with your ticket content.
**Step 2:** drag 1-3 design images into the chat.
**Step 3:** trigger:
```
@orchestrator.md Work on PROJ-1234 --skip atlassian,figma
```

Orchestrator uses your file + attached images + GitHub (still active for reference lookups). Saves ~20-40K.

### Example 4 — `--offline` (fully local, quickest ticket)

Small ticket, quick inline content, no external calls at all:

```
@orchestrator.md Work on PROJ-1234 --offline Context:
Title: Add entitlement filter to cert page
ACs:
  AC1: Entitlement dropdown appears on cert list page
  AC2: Selecting an entitlement filters the list
  AC3: Selection persists on page reload (session storage)
In scope: UI filter + session storage
Out of scope: backend (endpoint exists)
Epic: PROJ-1200
```

Drag a screenshot if you have one. That's it — no MCP calls, agents run fully local. Saves ~15-40K.

### Example 5 — `--offline` + pre-filled file + attached images (full offline)

The most structured offline flow:

```bash
# 1. Fill in the input file (once — survives re-installs)
vim contexts/ticket-input.md

# 2. Drag images into chat

# 3. Trigger
@orchestrator.md Work on PROJ-1234 --offline
```

Orchestrator reads file + images, does everything else locally. Shows in the Active Context block: `MCPs: all skipped (user --offline)`.

### How the orchestrator tells you it's working

The Active Context block printed at Phase A shows the MCP status for the run:

```
┌─ Active Context — Orchestrator ────────────────────────┐
│ Ticket:  PROJ-1234 · Story                             │
│ MCPs:    atlassian skipped (--skip) · github ✓ ·       │
│          figma skipped (--skip)                        │
│ Input:   contexts/ticket-input.md ✓ · 2 images ✓       │
└────────────────────────────────────────────────────────┘
```

If you didn't pass any flag and all MCPs are used: the block shows a one-line tip reminding you the option exists.

### Context: keyword — when inline beats file

Use inline `Context:` when:
- The ticket content is small (1-3 ACs)
- You don't want to edit a file
- You're prototyping something one-off

Use `contexts/ticket-input.md` when:
- Full ticket with long description
- You want to review/edit before running
- You're running the same ticket multiple times
- Teammates need to see the same input

You can combine both — orchestrator reads the file first, then overlays inline `Context:` on top.

### What if you DON'T use a skip flag and an MCP fails?

If you run the default `@orchestrator.md Work on PROJ-1234` (no flags) and an MCP fails at runtime — token expired, server down, OAuth prompt dismissed, rate-limited — Orchestrator **prompts you with a fallback gate** instead of failing the run. You answer inline; it continues using your fallback content. No re-trigger needed.

#### Decision rule (when a gate fires)

A gate fires only when **both** are true:

1. The MCP probe **failed** (not the same as "user explicitly skipped")
2. The ticket actually **needs content** from that MCP (e.g. Figma MCP down but ticket has no Figma URLs → silent, no gate)

#### Atlassian fails — what you see

When the Atlassian (JIRA + Confluence) MCP probe fails and you haven't pre-filled `contexts/ticket-input.md` or inlined `Context:`:

```
⚠ Atlassian MCP failed to connect — OAuth token expired (403 Unauthorized)

JIRA ticket content for PROJ-1234 can't be fetched automatically. Pick one:

  1. `retry`    — Try connecting again (fix your MCP token/config, then reply `retry`)
  2. `inline`   — Reply with "Context:" + ticket summary + ACs, I'll parse as JIRA
  3. `file`     — Fill contexts/ticket-input.md, then reply `continue`
  4. `skip`     — Proceed with whatever local content exists (halt if nothing exists)
  5. `cancel`   — Exit; re-trigger when MCP is back

> 👉 Pick one:
```

**What each option does:**

| You reply | Orchestrator does |
|---|---|
| `retry` | Re-probes Atlassian MCP. If healthy → fetches ticket normally and proceeds. If still failing → re-renders this gate. |
| `inline` + Context: block | Parses your reply's `Context:` content as if from JIRA. Active Context records `atlassian: user-provided via Context:`. Proceeds. |
| `file` (after filling `contexts/ticket-input.md`) | Reads the file. Active Context records `atlassian: user-provided via file`. Proceeds. |
| `skip` | Equivalent to `--skip atlassian`: uses whatever local content exists (file if present, inline if present). If neither exists, halts with `⛔ No ticket content available`. |
| `cancel` | Exits cleanly. No files written. Re-trigger later. |

#### Figma fails — what you see

When Figma MCP fails AND the ticket has Figma URLs AND no images are attached yet:

```
⚠ Figma MCP failed to connect — network timeout

2 Figma URL(s) referenced in ticket can't be fetched:
  - https://figma.com/file/abc/123?node-id=1-2
  - https://figma.com/file/abc/123?node-id=4-5

Pick one:

  1. `retry`    — Try again
  2. `upload`   — Drag design image(s) into this chat, reply `continue`. Up to 3 images used.
  3. `skip`     — Continue with URL-only Visual Spec (weaker — Phase B visual biasing degrades)
  4. `cancel`   — Exit

> 👉 Pick one:
```

| You reply | Orchestrator does |
|---|---|
| `retry` | Re-probes Figma. If healthy → fetches frames. Otherwise re-renders gate. |
| `upload` + dragged images + `continue` | Uses up to 3 newly-attached images for Visual Specification. Figma URLs are recorded but not analyzed. Proceeds. |
| `skip` | Proceeds with URL-only Visual Spec. Phase B (task decomposition) still runs, but visual-spec biasing is weaker — component matching via image analysis is skipped. |
| `cancel` | Exits. No files written. |

**Figma gate does NOT fire** if:
- Ticket has no Figma URLs at all (nothing to fetch)
- You already dragged images into the trigger message (attachments satisfy the visual-spec need)

#### GitHub fails — what you see

GitHub is rarely on the critical path. When its MCP fails:

```
⚠ GitHub MCP failed — continuing without PR diff enrichment for reference ticket PROJ-1001.
Pattern comparison will use ref LLD (local file) only, not the merged diff.
No action needed unless you specifically want PR-level pattern match; re-run when MCP is back.
```

No interactive gate — the orchestrator emits this one-line note in the Active Context block and continues. GitHub MCP only matters when you've declared a reference ticket whose PR diff would enrich the pattern match (rare).

#### Silent degradation cases (no gate, no prompt)

The orchestrator proceeds without asking when the failure is immaterial:

| Scenario | Behavior |
|---|---|
| Atlassian fails BUT `contexts/ticket-input.md` is already filled | Uses the local file. Active Context: `atlassian: degraded — using ticket-input.md`. |
| Atlassian fails BUT trigger has inline `Context:` | Uses inline content. Active Context: `atlassian: degraded — using Context: inline`. |
| Figma fails BUT ticket has no Figma URLs | Nothing to fetch anyway. Active Context: `figma: degraded — no Figma URLs in ticket`. |
| Figma fails BUT you attached images in the trigger | Uses attachments. Active Context: `figma: degraded — using trigger attachments`. |
| GitHub fails AND no reference ticket declared | Nothing to fetch. Silent. |
| MCP declared `required: false` in pipeline config + content not strictly needed | Single-line note, no gate. |

#### How the Active Context block shows MCP status

Regardless of flags or failures, Orchestrator's Active Context block always reports the MCP status, so you can see what actually happened:

```
┌─ Active Context — Orchestrator ────────────────────────┐
│ Ticket:  PROJ-1234 · Story                             │
│ MCPs:    atlassian ✗ (probe failed: token expired) →   │
│          recovered via inline Context: ✓               │
│          github ✓ · figma ✗ (probe failed) →           │
│          recovered via 2 uploaded images ✓             │
│ ...                                                    │
└────────────────────────────────────────────────────────┘
```

If you see `→ recovered via <method>`, you know the gate fired and your fallback was applied.

#### Gate vs `--skip` flag — which to use when

| Situation | Recommended approach |
|---|---|
| MCP works normally, you just want to save tokens or keep content private | Use `--skip <name>` upfront. Cleaner — no gate, no interruption. |
| MCP typically works, occasionally flakes | Default trigger. When it flakes, answer the gate with `retry` or `inline`/`upload`. |
| MCP is down for extended time (org-wide outage) | Use `--offline` or `--skip atlassian,figma` upfront. Avoids a gate per-story until MCP is back. |
| You have the content locally and don't want MCP calls at all (privacy) | Fill `contexts/ticket-input.md`, attach images, use `--offline`. |

**Why this design:** you don't have to predict MCP outages. Default triggers work most of the time. If something breaks, you handle it in the same conversation — no need to abort, re-configure, and re-trigger.

### Subsequent stories — what changes with skip flags

MCP skip flags behave differently depending on story position in an epic. Orchestrator already prefers local files for subsequent stories (that's the epic-context optimization). Here's what each flag affects per story position:

| Flag | 1st story of epic | 5th / 10th story of same epic |
|---|---|---|
| `--skip atlassian` | Must fill **Section 1** (ticket basics) AND **Section 2** (HLD/architecture) of `contexts/ticket-input.md` | Fill **Section 1 only** — Section 2 is skipped (local `epic-context.md` has the architecture info from the 1st story). Sibling drift check is silently skipped. |
| `--skip figma` | Drag images into chat | Same — drag images into chat |
| `--skip github` | No impact (rare MCP) | No impact |
| `--offline` | All MCPs skipped: fill Section 1 + 2 of ticket-input.md + attach images | All MCPs skipped: fill Section 1 only + attach images. Epic context loaded from local file — no content to re-provide. |

**Why subsequent stories need less:** the 1st story of an epic builds `contexts/{epic}/epic-context.md` with HLD summary, architecture decisions, spike findings, and a running story log. Orchestrator's Phase A.4 reads this file directly on every subsequent story — no MCP call needed for that content. The only content a subsequent-story skip loses is:

- **Sibling drift check** (A.4a-bis) — normally queries JIRA for sibling stories you might have missed. Skipped silently when Atlassian is off. Mitigation: run `git pull` before starting to ensure teammates' commits are in your local epic-context.
- **Fresh JIRA linked-issue scan for pattern references** — skipped. Use inline `— reference: PROJ-XXXX` in your trigger instead (Orchestrator reads the local file for that ticket).

**First-story impact is bigger:** without Confluence HLD fetch, you must provide the HLD summary yourself in Section 2 of ticket-input.md. This is the one case where going offline on story 1 requires more prep.

### Example — subsequent story offline (minimal prep)

5th story of the same epic, user wants to skip all MCPs:

```bash
# 1. Pull to make sure local epic-context is up to date
git pull

# 2. Edit contexts/ticket-input.md — ONLY Section 1 needed
vim contexts/ticket-input.md
# Fill: title, summary, ACs, in/out of scope. Delete Section 2 (epic-context is local).
# Delete Section 3 unless you have extra supplementary notes.

# 3. Drag any design screenshots into the chat

# 4. Trigger
@orchestrator.md Work on PROJ-1235 --offline
```

Orchestrator:
- Reads Section 1 from ticket-input.md for ticket basics
- Reads `contexts/{epic}/epic-context.md` locally for HLD + architecture + story log (no MCP)
- Uses trigger-attached images as Visual Specification (no Figma MCP)
- Skips drift check + pattern auto-discovery (Atlassian skipped)
- Writes new Requirement Summary + AC Registry normally

Active Context block shows:
```
MCPs:   atlassian skipped (--offline) · github skipped (--offline) · figma skipped (--offline)
Input:  contexts/ticket-input.md (Section 1) ✓ · epic-context.md ✓ (4 prior stories) · 2 images ✓
```

Total time saved vs full MCP run on a subsequent story: ~10-15K tokens.

### Gotchas

- **Forgot `contexts/ticket-input.md`?** With `--offline` or `--skip atlassian`, orchestrator halts: `"No ticket content provided. Fill contexts/ticket-input.md OR add Context: to the trigger."`
- **`--skip atlassian` + no inline + no file** → same halt.
- **1st story + `--skip atlassian`** → halts if Section 2 (HLD/architecture) is missing AND no epic-context.md exists. Subsequent stories don't hit this — they read epic-context locally.
- **Stale epic-context**: if a teammate shipped a sibling story but Review didn't update epic-context (rare process bug), `--skip atlassian` won't catch it. Occasionally run WITHOUT `--skip atlassian` to trigger the drift check, OR `git pull` before starting.
- **`--force-config` on re-install** wipes your filled-in `contexts/ticket-input.md` (backed up to `.bak`). Don't re-install with `--force-config` if you have in-progress ticket content there.
- **Images cap at 3** regardless of flags.
- **Re-running the same ticket offline**: Orchestrator archives `ticket-input.md` after reading. Re-create it (copy the archived version back, or fill fresh) before re-triggering.

---

## Config Essentials (minimum to set)

The config is split across 5 files in `contexts/config/`. The sample below is the merged view — in practice each block lives in its owning file (see the table in Step 3). Use `npm run pipeline:merge` if you want to see all blocks in one file.

```yaml
# contexts/config/pipeline.<pack>.yaml (CORE)
meta:
  schema_version: 4
  pack: <pack>     # this string is meta.pack — must match the filename stem

runtime:
  contexts_layout:
    nested_by_epic: true      # recommended default
  branching:
    base_branch: develop
    prefix_story: feature/
    prefix_bug: fix/

jira:
  project_key: "PROJ"
  label: "agentic-team"
  reference_link_types:
    - "is similar to"

mcp_servers:
  atlassian:
    required: true             # for ticket fetch
    used_by: [orchestrator, review, ship]
  github:
    required: true             # for Ship
    used_by: [orchestrator, explorer, review, ship]
  figma:
    required: false            # optional but recommended
    used_by: [orchestrator]

skills:
  layer_map:
    # your layers — see pack's pipeline.yaml for examples
  orchestrator:
    ticket_schema_story: <pack>-ticket-schema-story.md
    lld_generator: <pack>-lld-generator.md
    ac_templates_intent_aware: <pack>-ac-templates-intent-aware.md

shared_paths:
  frontend: { ui_elements: [...], services: [...], templates: [...] }
  backend:  { services: [...], rest_endpoints: [...], utilities: [...] }

builds:
  commands: { <layer>: { cmd: "...", desc: "..." } }
  forbidden: [ "deploy*", "drop table*", "git push --force*" ]
  review_gate: "ant clean build"

scan_exclusions:
  dependencies: [node_modules, vendor, ...]
  build_output: [target, dist, ...]
  caches: [__pycache__, ...]
```

See comments inside each split file for every key + why it exists. The pack seed at `packs/<pack>/pipeline.<pack>.yaml` has the full commented reference.

---

## Common Issues

| Symptom | Cause / fix |
|---------|-------------|
| `No context file found for PROJ-1234` | Downstream agent before Orchestrator ran. Start with `@orchestrator.md Work on PROJ-1234`. |
| `Ambiguous context file for PROJ-1234` | Same ticket ID in two folders. Move one to `contexts/archive/`. |
| `skill_loaded=<none — no config>` | One of the split `pipeline.*.yaml` files failed to parse. Run `node contexts/tools/validate.mjs` — it reports which file + line. |
| `top-level key 'X' declared in multiple files` | Same top-level key (e.g. `skills`) appears in two split YAMLs. Each block lives in exactly one file — see Step 3 table. |
| Want a unified view of all 5 split files | Run `npm run pipeline:merge` — generates a throwaway `contexts/pipeline.<pack>.yaml` you can inspect and delete. |
| `Split-output companion missing` | Orchestrator didn't finish. Re-run it. |
| Plain trigger didn't run in Cursor | Use `@<agent>.md <trigger>` pattern. Or `Verify last agent run` to diagnose. |
| Surgeon halted with LLD drift warning | Amender ran between Surgeon runs. Choose Restart / Proceed / Cancel at the prompt. |
| Reference auto-discovery missed an obvious link | Check `jira.reference_link_types` — does your link type match? |
| Figma URLs listed but not analyzed | Figma MCP not connected. Set it up or use image attachments instead. |
| `Atlassian MCP failed to connect — ...` gate appears | MCP token expired / server down. Answer the gate: `retry` (after fixing), `inline` + paste Context:, `file` + fill `ticket-input.md`, `skip`, or `cancel`. See "What if you DON'T use a skip flag and an MCP fails?" above. |
| `Figma MCP failed to connect — ...` gate appears | Answer with `retry`, `upload` + drag images, `skip` (URL-only visual spec), or `cancel`. |
| MCP keeps flaking across multiple stories | Use `--offline` or `--skip atlassian,figma` upfront to avoid gate-per-story. |
| `⛔ No ticket content available` after choosing `skip` at Atlassian gate | You picked `skip` but `ticket-input.md` is empty AND no inline `Context:` was provided. Fill one of them and re-trigger. |
| Review says "clean" but code looks broken | Review checks AC compliance + regressions, not behavioral correctness. LLD may be wrong — amend from the top. |
| `Amend:` option missing at Phase C gate | `subagent-amender.md` wasn't installed. Re-run installer. |
| `Ship does not support standalone mode` | By design. Use `@orchestrator.md Work on <TICKET>` OR `@surgeon.md Apply:` + manual git commit. |
| Orchestrator wrote to flat layout after flipping `nested_by_epic: true` | Re-run Orchestrator — flag reads at pre-flight. If still wrong, check validator output. |
| Ticket landed in `contexts/standalone/` but has an epic parent | Orchestrator walks JIRA parent chain up to 3 levels. Check JIRA — is an ancestor typed `Epic`? |
| `pack '<x>' not found at packs/<x>` | Pack name in `--pack` doesn't match a directory under `packs/`. Run `npm run install-pipeline -- --list-packs` to see what's shipped. |
| Agent halts at pre-flight: "Pack not installed" or "Ambiguous install" | `contexts/config/` either has no core `pipeline.<pack>.yaml` (zero matches) or has multiple (left over from switching packs without cleaning up). Remove stale split files, re-install. |
| Skill recommendation in project-map.md keeps showing for a layer I already authored | Skill file likely smaller than 500 bytes (counted as a stub) OR not under `packs/<pack>/skills/`. Check both. |
| New skill works locally but teammates don't see it | You direct-edited `.cursor/skills/` and the runtime YAML. `.cursor/` is gitignored. Promote to `packs/<pack>/skills/` and seed YAML, then commit. |

---

## Deeper Reading

- **Agent prompts:** `agent-pipeline/agents/` — one file per agent, source of truth for behavior
- **Pipeline flow rules:** `agent-pipeline/rules/agent-flow.mdc` — path resolution, companion files, invocation modes, **Pack Resolution** (top of file)
- **Your-project pack — didactic guide:** **`packs/your-project/README.md`** — naming conventions, how to add skills/rules, the analyzer/author boundary table, full template
- **Kernel skill index:** `agent-pipeline/skills/SKILL.md`
- **Pack skills:** `packs/<pack>/skills/` — project-specific coding standards
- **Full config reference:** the pack seed at `packs/<pack>/pipeline.<pack>.yaml` has every key documented inline. Split files in `contexts/config/` carry per-file headers + relevant comments.
- **Pipeline YAML editor's guide:** `contexts/config/pipeline.<pack>.README.md` (installed from `packs/<pack>/pipeline.<pack>.README.md`, if the pack ships one) — dedicated guide for adding/updating skills, rules, triggers, with a worked security/auth example.
- **Split/merge tools:** `npm run pipeline:split` (seed → 5 files) and `npm run pipeline:merge` (5 files → seed). See Step 3.5.
- **Validator:** `contexts/tools/validate.mjs` — auto-discovers and merges the split YAMLs. Run whenever you edit them.
- **Release history:** `CHANGELOG.md`
- **Manual validation:** `VALIDATION-CHECKLIST.md`

**When something surprises you**, the debugging sequence is: (1) read the agent prompt, (2) read the skill it loaded (listed in the Active Context block), (3) read the config section it consumed. The answer is always in one of those three places.
