# 07 — Ship

## Quick Reference

### Invocation modes

| Mode | Trigger | Outcome |
|------|---------|---------|
| **Pipeline** | `Ship it` / `Run the ship` / `raise PR` / `push it` | Commit + push + PR + JIRA transition |
| **Standalone** | ❌ **NOT SUPPORTED** | Safety rail — Ship refuses standalone. Requires Review verdict. |

### Why no standalone

Ship commits and pushes code, which **must** be reviewed first. Bypassing Review means committing un-reviewed code — an unsafe default.

For ad-hoc work, Ship's halt message offers alternatives:
```
⛔ Ship does not support standalone mode.

1. Full pipeline:        @orchestrator.md Work on <TICKET>
2. Ad-hoc + manual git:  @surgeon.md Apply: <spec>
                         then: git add <files> && git commit -m '...'
                               git push origin <branch>
3. Quick review first:   @review.md Review changes
                         then manually commit + push
```

### Example commands

```
Ship it               # after Review says ship-ready
Run the ship          # alias
raise PR              # alias
push it               # alias
```

### What it reads

| From `pipeline.yaml` | Why |
|---------------------|-----|
| `runtime.branching` | `base_branch` for PR target, stacking detection |
| `jira.*` (auth, label, add_at, transitions, post_comment) | Apply label, transition status, post comment |
| `jira.status_map` | `ship_done` → which JIRA status |
| `mcp_servers.github` | Push + PR creation via GitHub MCP |
| `mcp_servers.atlassian` | JIRA operations via Atlassian MCP |
| `builds.forbidden` | Never run these |

### What it reads from contexts/

- `$CONTEXTS_FILE` — Requirement Summary + ACs (for PR body)
- `$LLD_FILE` — PART 1 + PART 2 (for PR body task list)
- `$TESTPLAN_FILE` — PART 3 + PART 4 (for PR test plan)
- `$MANIFEST_FILE` — Surgeon's change manifest (drives commit grouping)
- `$REVIEW_FILE` — **REQUIRED** — must contain ship-ready verdict or Ship halts
- `$CODEBASE_MAP` — for metadata update (stories_completed, story_log)

### What it writes

| Output | Purpose |
|--------|---------|
| Git commit(s) + branch push | Via GitHub MCP (or CLI fallback) |
| GitHub PR | With body assembled from 3-file LLD + Review summary |
| JIRA transitions + label + comment | Via Atlassian MCP |
| `$CODEBASE_MAP` metadata update | `stories_completed++`, append to `story_log` |
| `epic-e2e-plan.md` (if AC-E2E-Check ran) | Final append of this story's walkthrough steps |

### Phase overview

```
0    detect_invocation_mode   — rejects anything other than pipeline triggers
0    check_prerequisites      — $REVIEW_FILE exists + ship-ready YES + working tree has changes + right branch
1    resolve_paths            — Procedure B + $MANIFEST_FILE + $REVIEW_FILE
2    commit                   — group by task/layer, respect forbidden patterns
3    push                     — via GitHub MCP, tracking upstream
4    create_PR                — body from 3-file LLD + review summary
5    update_jira              — transition + label + comment
6    update_codebase_map      — metadata: stories_completed, story_log
7    append_epic_e2e_plan     — if demo plan exists
```

### Enrichment support

Not applicable. Ship consumes the already-enriched artifacts (LLD with reference pattern, manifest with visual annotations, review with fidelity sections) and surfaces them in the PR body. No new enrichment at Ship time.

### Typical scenarios

| Situation | Command |
|-----------|---------|
| Review says ship-ready | `Ship it` |
| Review said P0 blocker | Ship halts — fix blockers, re-run Review, then Ship |
| Want to commit ad-hoc Surgeon work manually | Use git directly (`git add` / `git commit` / `git push`) — Ship is not a git wrapper |
| Want to skip JIRA updates for testing | Set `jira.on_failure: warn-and-continue` in config (default) — failures become warnings |

---

## Purpose

Takes the reviewed story and ships it — runs git add/commit/push, creates PR, updates JIRA status, updates codebase map metadata, appends to epic E2E plan. Only agent allowed to run git operations.

## When it runs

- **Per ticket, Step 5 of 5** — final agent in the pipeline
- **Requires `Ship-ready: YES` from Review** — halts if Review signaled NO
- **v16 marker integrity check pre-flight** — halts if LLD markers corrupted

## Trigger commands

- `ship`, `ship it`, `raise PR`
- Auto: after Review if `runtime.ship.auto: true` (rarely enabled; usually explicit)

## Phase overview

```
Pre-flight:
    Load pipeline config
        ↓
    Resolve paths ($MANIFEST_FILE, $REVIEW_FILE, $CODEBASE_MAP)
        ↓
    Verify branch + Ship-ready: YES from Review
        ↓
    v15/v16 marker integrity check (halts on corruption)
        ↓
show_state (1)                  [git status + diff --stat]
    ↓
ask_commit_strategy (2)         [single vs per-task]
    ↓
execute_commits (3)             [git add + git commit]
    ↓
pre_push_checklist (4)          [double-gated]
    ↓
push_and_pr (5)                 [git push + PR creation]
    ↓
jira_status_comment (5b)        [optional, if configured]
    ↓
update_codebase_map (6)         [MANDATORY metadata update]
    ↓
update_epic_e2e_plan (6b)       [MANDATORY plan write]
```

## Phase-by-phase

### Pre-flight — marker integrity check (v16)

Before any git operation, verify LLD markers are intact:

1. **Markers present** — every REST endpoint task has `contract_confidence:`; every UI task creating/modifying a button has `button_intent:`. If missing in v15+ LLD → HALT.
2. **Values valid** — contract_confidence ∈ {HIGH, MEDIUM, LOW, NONE}; button_intent ∈ {7 intents + unknown + ambiguous}. If invalid → HALT.
3. **Cross-references resolve** — `§ 3b`, `§ 6`, `§ 9`, `§ 10c` citations match actual sections in project-map.md. If stale → WARN (non-blocking).
4. **project-map.md diff consistency** — if PART 5b updated project-map.md during this story, verify no silent corruption. If detected → HALT.

Rationale: Ship is the last line of defense before corrupted markers enter git history where they poison every future pipeline run against the project.

### show_state (1)

Runs `git status` and `git diff --stat`. Shows user what's about to be committed. No action yet.

### ask_commit_strategy (2)

Two canonical strategies:

- **Single** — one commit with all changes, message `{TICKET}: {title} ...`
- **Per-task** — one commit per task, messages `T{N}: {desc} [{TICKET}]`

Additional optional strategies packs can configure:
- **Atomic** — one commit per logical unit (smaller than task, usually by file set)
- **Conventional** — conventional commits format (`feat:`, `fix:`, `refactor:`)

User picks; default from `runtime.ship.default_commit_strategy`.

### execute_commits (3)

Per strategy:

- **Single:** `git add -A && git commit -m "{TICKET}: ..."`
- **Per-task:** loop through Change Manifest tasks, each gets `git add {files} && git commit -m "T{N}: ..."`

Commits stay local. Nothing pushed yet.

### pre_push_checklist (4) — double-gated

Shows checklist before push:
- Branch name matches expectation
- Commit count matches strategy
- No untracked files missed
- JIRA label applied (if `jira.enabled`)
- Manual verification step the team defines

User confirms → proceed. Cancel → branch stays local.

### push_and_pr (5)

- `git push -u origin {branch}`
- Via configured PR tool (`gh pr create`, Bitbucket API, etc.): create PR with:
  - Title: `{TICKET}: {title}`
  - Body: auto-generated from LLD Requirement Summary + Change Manifest
  - Labels: per `jira.label`
  - Reviewers: per team config (optional)

### jira_status_comment (5b)

If `jira.add_at: ship` (configurable):
- Transition JIRA ticket to "In Review" status
- Add comment: "PR created: {PR_URL}"
- Apply label: `jira.label` (e.g. "agentic-team")

Configurable via `jira` section in pipeline.yaml.

### update_codebase_map (6) — MANDATORY

Updates `contexts/{EPIC}-codebase-map.md` metadata:
- `last_story_shipped: {TICKET}`
- `last_story_shipped_at: {timestamp}`
- `last_story_shipped_branch: {branch}`
- `last_story_shipped_commit: {commit_sha}`

Tells next story's Explorer "this is the new baseline" for Mode B sync.

### update_epic_e2e_plan (6b) — MANDATORY

Writes this story's scenarios to `{EPIC_ID}-epic-e2e-plan.md`. Uses Review's `epic_e2e_plan_preview (PART 5c)` output as input — no re-classification here, just the write.

Rationale for separating preview (Review) from write (Ship): Review previewed so user could fix classifications; Ship just persists what was agreed. Keeps commit history clean.

## Inputs

| Source | What's read | Phase |
|---|---|---|
| `contexts/{TICKET}.md` | LLD (marker validation) | pre-flight |
| `contexts/{TICKET}-manifest.md` | Change Manifest (commit content) | all phases |
| `contexts/{TICKET}-review.md` | Ship-ready signal | pre-flight |
| `contexts/project-map.md` | marker integrity cross-check | pre-flight |
| `contexts/{EPIC}-epic-e2e-plan.md` | existing plan (for append) | update_epic_e2e_plan |
| `contexts/{EPIC}-codebase-map.md` | for metadata update | update_codebase_map |
| `contexts/config/pipeline.yaml` | branching, jira, commit strategy defaults | pre-flight + throughout |
| Git state | `git status`, diff, branch | show_state + execute_commits |

## Outputs

Side effects (primary):
- Git commits on the feature branch
- Git push to origin
- PR created (URL returned)
- JIRA ticket transitioned + labeled (if configured)

File writes:
- `contexts/{EPIC}-codebase-map.md` metadata updated
- `contexts/{EPIC}-epic-e2e-plan.md` scenarios appended

## Hand-off contract

After Ship:
1. PR URL shown to user
2. JIRA status + label applied (if enabled)
3. Pipeline complete for this ticket

Next story in epic inherits: updated codebase-map, updated epic-e2e-plan, project-map from Review's PART 5b.

## Dependencies

- **Review must have set `Ship-ready: YES`** — pre-flight halts otherwise
- **Git + remote configured** — push requires origin
- **PR tool installed** — `gh` for GitHub, `bb` for Bitbucket, etc. (via `ship.pr_tool`)
- **JIRA API access** configured if `jira.enabled`
- **v15+ markers valid** — integrity check halts on corruption

## Token economics

Ship is the cheapest agent:

| Phase | Input tokens |
|---|---|
| pre-flight (inc. marker integrity) | ~2-3k |
| show_state + ask_commit_strategy | ~500 |
| execute_commits | ~1k |
| pre_push_checklist | ~500 |
| push_and_pr | ~1-2k |
| jira_status_comment | ~500 |
| update_codebase_map + update_epic_e2e_plan | ~2k |

Total: ~7-10k. Mostly git-tool invocations, minimal reasoning.

## Common failure modes

- **Ship-ready: NO from Review** — HALT with Review's reasons. User runs Surgeon + Review with fixes.
- **Marker integrity check fails** — LLD corrupted (amendment gone wrong, manual edit mismatch). User fixes LLD manually or re-runs Orchestrator.
- **Git push rejected** — remote has diverged. User pulls + resolves, re-runs push_and_pr.
- **PR tool missing** — `gh` not installed. Manual PR creation fallback; Ship tells user.
- **JIRA API failure** — `jira.on_failure: warn-continue` (default) logs warning and continues. `halt` option aborts.
- **Epic E2E plan write fails** — usually permission issue on contexts/. Ship surfaces; user fixes.

## Configuration knobs

```yaml
runtime:
  ship:
    enabled: true
    auto: false                          # never auto-ship after Review
    default_commit_strategy: "single"    # or per-task, atomic, conventional
    pr_tool: "gh"                        # github cli | bitbucket | gitlab
    pr_template: "{pack}-pr-template.md"   # pack-provided PR body template

jira:
  label: "agentic-team"
  add_at: "both"                         # when to add labels: phase-c-go | ship | both
  on_failure: "warn-and-continue"        # or "block"
  post_comment: true
  reference_link_types:
    - "is similar to"
  status_map:
    in_development: "In Development"
    review_done: "In Review"
    ship_done: "Ready for QA"

runtime:
  branching:
    base_branch: "develop"
    stacking: "off"
```

## Cross-agent awareness

- **Consumes Review's Ship-ready signal** — pre-flight gate
- **Validates Orchestrator+Amender's LLD markers** — integrity check (v16)
- **Validates Review's project-map updates** — diff consistency check (v16)
- **Writes what Review previewed** — epic E2E plan
- **Updates Explorer's next-run baseline** — codebase-map metadata

## Version history

- Pre-v14 — core commit/push/PR flow established
- v14+ — update_codebase_map (Step 6) MANDATORY
- v15.0 — update_epic_e2e_plan (Step 6b) MANDATORY
- v15.0 — JIRA automation (jira block)
- v16.0 — v15/v16 marker integrity check in pre-flight
- v21.0 — semantic phase names
