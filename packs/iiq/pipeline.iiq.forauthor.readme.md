# Pipeline YAML — Pack Author / Tech Lead Guide

This guide is **for pack authors and repo owners** who maintain the release repo.

> **NOT for team members.** This file stays in the release repo (`packs/<pack>/`) and is NOT copied to user projects during install. Team members get a separate guide: `pipeline.iiq.readme.md` (installed to their project's `contexts/config/`). Keep the two in sync when you change the architecture.

You maintain the pack seed at `packs/<pack>/pipeline.<pack>.yaml`. Changes you commit here ship to every user on the next pack release.

---

## What you own vs what team members own

| You (Pack Author) | Team Members (user projects) |
|---|---|
| `packs/<pack>/pipeline.<pack>.yaml` (monolithic seed, source-of-truth for installs) | `contexts/config/pipeline.<pack>.*.yaml` (5 split files, their local runtime) |
| `packs/<pack>/skills/*.md` (shipped skill catalog) | `.cursor/skills/*.md` (installed skills — they can add local ones too) |
| `packs/<pack>/rules/*.mdc` (shipped rule catalog) | `.cursor/rules/*.mdc` (installed rules — they can add local ones too) |
| Release cadence: what ships in the next pack version | Day-to-day config tweaks in their own project |

**When team members open PRs against this repo** to promote their local change to the pack, you review the diff to `packs/<pack>/pipeline.<pack>.yaml` (they regenerate it from their splits via `npm run pipeline:merge`).

---

## The 5 runtime split files — what each owns

After users install, these live at `contexts/config/` in their project. The pack seed is the single file you edit; install splits it into these 5:

| File (after install) | Top-level YAML keys it owns | Loaded by agents |
|---|---|---|
| `pipeline.<pack>.yaml` (CORE) | `meta`, `runtime`, `jira`, `mcp_servers`, `subagents`, `intent_classification` | Every agent |
| `pipeline.<pack>.skills.yaml` | `skills.layer_map`, `skills.extra_triggers`, `skills.orchestrator`, `skills.explorer` | Orchestrator, Surgeon, Explorer |
| `pipeline.<pack>.builds.yaml` | `builds`, `component_structure`, `operation_patterns`, `i18n` | Surgeon, Review |
| `pipeline.<pack>.analyzer.yaml` | `shared_paths`, `scan_exclusions`, `explorer_paths`, `rescan_hints`, `component_naming`, `analyzer_ignore` | project-analyzer, Explorer |
| `pipeline.<pack>.e2e.test.yaml` | `demo` | AC-E2E-Check |

Routing is defined in `contexts/tools/split-pipeline.mjs § ROUTING` — update that if you add a new top-level key and want it in its own split file.

---

## Edit Recipes (pack author flow)

### Recipe 1 — Add a new SKILL to the pack

1. Drop the skill file in `packs/<pack>/skills/<pack>-<name>.md`. Use existing skills as templates (`packs/iiq/skills/iiq-java-standards.md` is a good reference).

2. Wire it in `packs/<pack>/pipeline.<pack>.yaml` — pick ONE:
   - **Always-for-a-layer:** append to `skills.layer_map.<Layer>.skills[]`
   - **Conditional:** add to `skills.extra_triggers[]` with a `when:` clause

3. Regenerate the split view so your local release repo stays consistent:
   ```bash
   npm run pipeline:split --force
   ```

4. Run the validator:
   ```bash
   node contexts/tools/validate.mjs
   ```

5. Commit the skill file + the updated pack seed. Ship in next pack release.

### Recipe 2 — Update an EXISTING skill

1. Edit `packs/<pack>/skills/<name>.md` directly (add patterns, anti-patterns, examples).
2. Commit. Ship. No YAML change needed — wiring is already in place.

**To change WHEN the skill is loaded** (broaden/narrow trigger): edit `skills.extra_triggers[]` in the pack seed (see Recipe 5).

### Recipe 3 — Add a new RULE (always-on)

Rules are always-loaded, every agent run. Use sparingly — each rule adds tokens to every call.

1. Drop the rule in `packs/<pack>/rules/<pack>-<name>.mdc` with frontmatter:
   ```yaml
   ---
   description: <one-line summary — shows in agent's Active Context>
   alwaysApply: true
   ---
   ```

2. Commit. Ship. No YAML wiring — the installer copies every `.mdc` in `packs/<pack>/rules/` to the user's `.cursor/rules/` (or converts for Claude Code).

### Recipe 4 — Update an EXISTING rule

Edit `packs/<pack>/rules/<name>.mdc` directly. Commit. Ship.

### Recipe 5 — Add or modify a TRIGGER

Triggers sit under `skills.extra_triggers[]` in the pack seed:

```yaml
skills:
  extra_triggers:
    - when: "task touches <path-pattern> OR mentions <keyword>"
      add: [<pack>-<skill-name>.md]
```

`when:` is free-form English; agents parse intent. Common shapes:
- `"task touches src/foo/**"` — file path match
- `"task involves X, Y, or Z"` — keyword match in task text
- `"file ends with DAO/Repository"` — filename pattern
- `"task ID starts with T-TC"` — task ID convention
- `"Layer = Backend/Java AND file path contains /rest/"` — combined layer + path

Edit → `npm run pipeline:split --force` → validate → commit.

### Recipe 6 — Change which skill an AGENT uses (per-agent skill)

Per-agent skills (Orchestrator's ticket-schema, LLD generator, AC templates; Explorer's bug-localization) live under `skills.orchestrator` and `skills.explorer` in the pack seed:

```yaml
skills:
  orchestrator:
    ticket_schema_story: iiq-ticket-schema-story.md
    lld_generator: iiq-lld-generator.md
    ac_templates_intent_aware: iiq-ac-templates-intent-aware.md
  explorer:
    bug_router: iiq-bug-localization.md
    bug_frontend: iiq-bug-localization-frontend.md
    bug_backend: iiq-bug-localization-backend.md
```

Point any key to a different filename — file must exist in `packs/<pack>/skills/`. Then split → validate → commit.

---

## Reviewing a team-member PR

Team members may open PRs against this repo to promote their local config changes into the pack. What they typically send:

| Files they change | Why |
|---|---|
| `packs/<pack>/pipeline.<pack>.yaml` | They ran `npm run pipeline:merge` in their project, regenerated the seed, and copied the new trigger(s) / layer mapping into the pack seed |
| `packs/<pack>/skills/*.md` | Any new skill files they added locally that should ship with the pack |
| `packs/<pack>/rules/*.mdc` | Any new rule files |

**Review checklist:**

- [ ] Does the YAML change add a clearly-scoped `extra_triggers[]` (narrow `when:` clause)? Or does it broaden a layer's default — justified?
- [ ] New skill file references — do they actually exist under `packs/<pack>/skills/`?
- [ ] Skill content: well-scoped, non-duplicative with existing skills, uses existing patterns?
- [ ] Token cost acceptable? (1-2K skills on rare triggers = fine; 5K skills on most tasks = reconsider)
- [ ] Would this change break existing installs when they pull + re-split with `--force-config`?
- [ ] CI runs `node contexts/tools/validate.mjs` against the pack seed (if you have CI)

**After merging, verify:**

```bash
# In the release repo after merge:
npm run pipeline:split --force                # refresh release-repo split view
node contexts/tools/validate.mjs              # all checks pass
# Test install to a fresh target:
npm run install-pipeline -- --project-root /tmp/release-test --pack <pack>
```

---

## Worked example: adding "security for auth-sensitive code" to the pack

Scenario: every time Surgeon writes code that touches auth or password handling, apply stricter patterns. You want this to ship in the pack for all future installs.

### Step 1 — Create the always-on rule

```
packs/iiq/rules/iiq-security-standards.mdc
```

```markdown
---
description: IIQ security standards — non-negotiable rules applied every agent run.
alwaysApply: true
---

# IIQ Security Standards

## Never
- Log PII, passwords, session tokens
- Concatenate user input into HQL/SQL
- Skip AuthorizationService.requireRight() on mutation endpoints
- Commit secrets to code or messages.properties

## Always
- AuthorizationService.requireRight(SPRight.X) before DAO save/update/delete
- AuditService.log() before commit on destructive actions
- Validate input length/type at REST boundary
- Encode user-provided strings before HTML rendering
```

No YAML wiring — installer copies all `.mdc` automatically.

### Step 2 — Create 3 conditional skills

```
packs/iiq/skills/iiq-security-auth.md          (SPRight patterns, login/session rules)
packs/iiq/skills/iiq-security-persistence.md   (parameterized HQL/SQL, DAO return boundary)
packs/iiq/skills/iiq-security-secrets.md       (hashing, encryption, log redaction)
```

### Step 3 — Wire the triggers in `packs/iiq/pipeline.iiq.yaml`

```yaml
skills:
  extra_triggers:
    # ... existing ...
    - when: "task touches src/sailpoint/web/rest/auth/** OR references SPRight constants"
      add: [iiq-security-auth.md]
    - when: "task touches src/sailpoint/persistence/** OR file ends with DAO/Repository/Mapper"
      add: [iiq-security-persistence.md]
    - when: "task involves password, credential, token, apiKey, secret, sessionId, or bearer handling"
      add: [iiq-security-secrets.md]
```

### Step 4 — Split, validate, test install

```bash
npm run pipeline:split --force
node contexts/tools/validate.mjs
npm run install-pipeline -- --project-root /tmp/security-test --pack iiq
# Check that the 3 triggers appear in /tmp/security-test/contexts/config/pipeline.iiq.skills.yaml
# Check that the rule + 3 skills land in /tmp/security-test/.cursor/
```

### Step 5 — Commit + ship

```bash
git add packs/iiq/rules/iiq-security-standards.mdc \
        packs/iiq/skills/iiq-security-{auth,persistence,secrets}.md \
        packs/iiq/pipeline.iiq.yaml
git commit -m "security: add baseline rule + conditional auth/persistence/secrets skills"
```

On the next pack release, every new or re-installing user gets:
- `iiq-security-standards.mdc` auto-loaded (~1.5K tokens every agent call)
- `iiq-security-*.md` skills loaded on-demand via `extra_triggers` (0 tokens when not touching sensitive code)

---

## Quick reference — where does X live in the pack seed?

Everything lives in `packs/<pack>/pipeline.<pack>.yaml`. The split view below shows where each block LANDS after `npm run pipeline:split`, so you know which file team members will open in their project.

| You edit (in pack seed) | Team member sees it in (split file) |
|---|---|
| `meta`, `runtime`, `jira`, `mcp_servers`, `subagents`, `intent_classification` | `pipeline.<pack>.yaml` (core) |
| `skills.layer_map`, `skills.extra_triggers`, `skills.orchestrator`, `skills.explorer` | `pipeline.<pack>.skills.yaml` |
| `builds`, `component_structure`, `operation_patterns`, `i18n` | `pipeline.<pack>.builds.yaml` |
| `shared_paths`, `scan_exclusions`, `explorer_paths`, `rescan_hints`, `component_naming`, `analyzer_ignore` | `pipeline.<pack>.analyzer.yaml` |
| `demo` | `pipeline.<pack>.e2e.test.yaml` |

If you add a NEW top-level YAML key that doesn't fit any existing split: update `ROUTING` in `contexts/tools/split-pipeline.mjs` to place it in an existing file (or create a new split view).

---

## Commands (pack-author day-to-day)

```bash
# Refresh the release-repo split view from the pack seed (run after editing the seed)
npm run pipeline:split --force

# Regenerate the pack seed from splits (rare — used when a team member's PR updates splits instead of the seed)
npm run pipeline:merge

# Validate the pack
node contexts/tools/validate.mjs

# Smoke-test the install to a fresh target
npm run install-pipeline -- --project-root /tmp/test --pack iiq
```

---

## Don't do

- **Don't edit the split files in the release repo and forget to merge back.** The split files under `contexts/config/` are gitignored in release-only mode for exactly this reason — the pack seed is the source of truth.
- **Don't add overly broad `extra_triggers`.** A `when:` clause that matches most tasks = move the skill to `layer_map` for its layer instead. Triggers are for surgical additions.
- **Don't add rules (`.mdc`) for task-specific concerns.** Rules load every agent call. If it only matters for, say, REST tasks, make it a skill triggered by REST paths.
- **Don't forget to update team member's README.** When you add a new recipe or change the architecture, update `packs/<pack>/pipeline.<pack>.readme.md` too — that's the file they actually read.

---

## MCP configuration — `mcp_servers`, `mcp_roles`, `mcp_guidance`

Three related blocks in the core `pipeline.<pack>.yaml`. Every MCP-consuming agent (Orchestrator, Review, Ship, AC-E2E-Check) reads this core file at pre-flight, so the blocks are deliberately terse — **verbose explanations live in this file, not in the YAML.**

### Block 1 — `mcp_servers` (developer onboarding only)

This block exists for one purpose: to generate `contexts/config/mcp.sample.json`, which each developer copies into their personal Cursor / Claude Code MCP config on first install. It does NOT drive routing. Three fields per server:

| Field | Values | Purpose |
|---|---|---|
| `auth` | `oauth` \| `token` \| `token_or_oauth` | Tells the sample generator which auth template to emit |
| `config` | `url: ...` (oauth) OR `command + args + env` (stdio) | Connection details copied into `mcp.sample.json` |
| `setup_hint` | Multi-line string | Pack-author notes shown to developers via `mcp.sample.README.md` |

**Retired fields (still parsed for back-compat, now ignored + warn):** `used_by`, `required`, `skip`, `fallback_prompt`. Routing is driven by `mcp_roles`; skip is driven by CLI flags. The validator warns if any of these show up in a pack seed.

### Block 2 — `mcp_roles` (MANDATORY — the routing decision)

Four role keys, all mandatory:

| Role | What it does |
|---|---|
| `story_source` | Fetch ticket body + ACs; transition status on PR open |
| `design_source` | Fetch design frames / visual specs (Figma, etc.) |
| `vcs` | Branch / commit / PR creation; reference-PR diff fetch |
| `docs_source` | Fetch HLDs, wiki pages, requirements docs |

Each role's value is one of four shapes:

| Shape | Meaning | Gate behavior when role's content needed |
|---|---|---|
| `atlassian` | Single primary MCP, no fallback | Gate fires only if probe fails |
| `[atlassian]` | Same, list form | Same |
| `[github, bitbucket]` | Primary + ordered fallback list | Gate fires only if all candidates fail probe |
| `null` or `[]` | **Config-time skip — equivalent to `--skip <role>` flag** | **Gate fires on demand** — if the ticket needs this role's content (e.g. Figma URLs present + no attachments), user is prompted for an alternative (upload / file / inline `Context:`). If the ticket doesn't need this role's content this run, gate stays silent. |
| *(key missing)* | Validator V1 error | n/a (blocks install) |

**Resolution ladder (per role, per run):**

```
0. Config-time skip (equivalent to --skip flag)
   mcp_roles.<role>: null | []
   → role resolves with mcp=null and reason="skipped (config opt-out)".
     Downstream gate fires on demand if content is needed.

1. CLI flag overrides (ALWAYS WIN)
   --offline            → all roles have no MCP
   --skip <name,...>    → listed MCPs removed from candidates
   --only <name,...>    → all MCPs NOT listed removed

2. Walk mcp_roles.<role> in declared order
   Pick first candidate still allowed after step 1.

3. Consult mcp_guidance.<role> for declared quirks (block 3 below).

4. Check candidate is reachable at the host. Not reachable → next fallback.

5. All candidates exhausted:
   need_content(role, ticket) == true  → fire the role-keyed gate
   need_content == false               → silent (note in Active Context)
```

**Key invariant — all three "role has no MCP" paths behave the same at the gate:** whether the role was opted out via `null`/`[]`, flag-skipped, or probe-failed, the downstream behavior is identical (fire if content needed, silent otherwise). The difference is only cosmetic — the gate header names the cause so the user knows what to fix long-term.

#### `need_content(role, ticket)` — when each role's gate fires

The gate is not just "role has no MCP" — it's "role has no MCP AND this ticket actually needs the role's content." Each role has a specific content-dependency check:

| Role | `need_content == true` when … | Example backend/DB ticket | Example UI ticket with flow diagram |
|---|---|---|---|
| `story_source` | No `contexts/ticket-input.md` AND no inline `Context:` in trigger | Always needed unless local file provided | Always needed unless local file provided |
| `design_source` | Ticket has Figma/design URLs **AND** no trigger attachments **AND** `scope.ui_involved == true` | Silent — `scope.ui_involved == false` short-circuits the check | Silent — any image attachment (flow diagram, sketch, screenshot, UI mock) satisfies the "attachments present" branch |
| `docs_source` | Ticket references HLDs/wikis AND no local file provided | Silent unless ticket cites an external HLD | Silent unless ticket cites an external HLD |
| `vcs` | A reference ticket is declared AND its PR diff is requested for pattern comparison | Silent unless `— reference: PROJ-100` in trigger | Silent unless `— reference: PROJ-100` in trigger |

**Three concrete scenarios for `design_source: null`:**

| Ticket | Outcome |
|---|---|
| Backend / DB change · no Figma URLs · no images | **Silent** — `scope.ui_involved = false`; design input not needed. Active Context notes: `design_source ✗ (config) · not needed this ticket` |
| UI ticket · Figma URLs in description · **no images attached** · `scope.ui_involved = true` | **Gate fires** — "design_source is skipped (config). Provide design via: upload image / cancel." |
| UI ticket OR hybrid ticket · any image attached (flow diagram, sequence diagram, whiteboard sketch, UI mock, screenshot) | **Silent** — attachment satisfies `need_content`. Image-analysis subagent extracts whatever structure it can (boxes + arrows for a flow diagram, component tree for a UI mock); downstream agents use that + the ticket prose as context. |

#### How `scope.ui_involved` is determined

Set earlier in pre-flight by `classify_scope (A0.6.3)` — a cheap LLM pass over ticket title + description. Looks for signals like:

- **UI-involved:** "screen", "page", "form", "button", "modal", "dropdown", "component", "layout", "responsive", "accessibility", mentions of frontend paths, Figma/screenshot attachments
- **Not UI-involved:** "DAO", "migration", "REST endpoint", "service", "batch job", "index", "schema", "cron", "webhook", backend-path mentions only

Users can override with `Amend: scope.ui_involved = true/false` at the Phase C gate if classification was wrong.

#### Image-analysis is agnostic to image type

The `subagent-image-analysis` extracts whatever structure it finds in any attached image:

| Image type | What the subagent captures |
|---|---|
| UI mock (Figma export, Sketch screenshot) | Component tree, states, spacing, copy, interactive elements |
| Flow diagram / sequence diagram | Boxes, arrows, text labels, sequence/direction |
| Whiteboard sketch / napkin sketch | Coarse visual outline, labels, groupings |
| Screenshot of existing screen | Treated as "reference for current state" — the agent does NOT assume this is the target design |
| Architecture diagram | Components, connections, data flow |

Ticket prose provides the interpretation — the agent doesn't need to classify the image. So for a backend ticket with a flow diagram attached, the image becomes supplementary context for the LLD, not a UI mock to implement from.

### Block 2b — `docs_publish` + `docs_publish_target` (OPTIONAL — write-side LLD publishing)

Opt-in fifth role. When configured, Orchestrator step **C.5b (publish_lld)** publishes `$LLD_FILE` (PART 1 + PART 2) plus the inlined test plan (PART 3 + PART 4) as a **draft page** on the named MCP, **after the user approves the LLD at Phase C "Go"** AND opts in at the publish gate. The local `$LLD_FILE` remains canonical — this step is purely additive for discoverability.

**Why post-approval, not mid-synthesis:** the page reflects the LLD the user actually approved, not an in-progress draft that's about to be amended. Each amendment cycle stays local until "Go" — no churning a remote page for every Phase C tweak.

**Pack authors who do not want this feature: do nothing.** Omit `docs_publish` from `mcp_roles`, omit the `docs_publish_target` block, and B.3.5 short-circuits silently — zero behavior change vs. today.

#### When to enable

Turn it on when your team wants the LLD reviewable in Confluence / Notion / Slab during Phase C, before the PR opens. Turn it off (or leave omitted) when the local file is sufficient.

#### Schema

```yaml
mcp_roles:
  story_source: atlassian
  design_source: figma
  vcs: [github]
  docs_source: atlassian
  docs_publish: atlassian        # OPTIONAL — any mcp_servers key exposing createPage/updatePage

docs_publish_target:             # required when mcp_roles.docs_publish is set
  enabled: true                  # master on/off (boolean) — see below
  publish_gate: always           # always | first_only | never  (default: always — see below)
  space: "ENG"                   # provider-specific: Confluence space, Notion database, Slab topic
  parent_page_id: "12345"        # parent page / database / topic the draft is filed under
  state: draft                   # draft | current — recommend draft
  title_format: "{TICKET_ID} LLD — {title}"   # template; {TICKET_ID} and {title} substituted
```

#### The `enabled` master switch

The `enabled` flag is independent of whether the MCP is configured. Use it to keep your config but suspend publishing temporarily:

| `mcp_roles.docs_publish` | `docs_publish_target.enabled` | Behavior at B.3.5 |
|---|---|---|
| absent / null | (irrelevant) | Skip silently. Today's local-only flow. |
| set (e.g. `atlassian`) | `false` | Skip. Active Context notes "publishing suspended; flip to true to resume". Zero tokens. |
| set | `true` (or absent — defaults to true) | Run. Publish on first call, update on amendment, idempotent skip on no-op. |

The switch lives in `docs_publish_target` (not `mcp_roles`) because it's a *toggle*, not a *route*. Routing belongs with the four-role grammar; the toggle belongs with the publish settings it gates.

#### The `publish_gate` user-consent switch

C.5b runs *after* the user approves the LLD at Phase C ("Go"), but the publish itself is gated separately. The user sees a preview (action, title, target, body size, cost estimate) and chooses Yes / No / Disable / Never-ask. The `publish_gate` setting controls when that prompt fires:

| Value | createPage (first publish) | updatePage (amendment) | When to use |
|---|---|---|---|
| `always` (default) | gate fires | gate fires | Default — explicit consent every time. Recommended for teams new to the feature or where LLDs sometimes contain sensitive context. |
| `first_only` | gate fires | silent (auto-update) | Confirm the first publish; let amendments flow to the draft automatically once approved. Good middle ground for active epics. |
| `never` | silent | silent | Auto-publish, no prompt. Only choose this when the team has fully validated the publishing flow and trusts every "Go" to mean "publish too." Validator emits a warn when this is set, to make the choice deliberate. |

The gate prompt itself costs ~150 input + ~50 output tokens (≈ $0.001) per firing — negligible vs. the full publish (~$0.05). Default `always` adds ~$0.015 across a 15-story epic.

**Gate response handling:**

| User reply | Effect |
|---|---|
| `Yes` | Run the publish. |
| `No` | Skip this run. Frontmatter unchanged; next "Go" or amendment re-fires the gate. |
| `Disable` | Set `docs_publish_target.enabled` to `false` and skip. Future runs short-circuit at the master switch (zero tokens). |
| `Never ask` | Set `docs_publish_target.publish_gate` to `first_only` (or `never`) and proceed. |

#### Provider-agnostic contract

The pipeline never names "Confluence" or "Atlassian" in any agent prompt. It talks to whatever MCP you wire under `docs_publish`. Any MCP that exposes tools matching this contract plugs in:

```
createPage(space, parent_id, title, body, state)  → { id, url }
updatePage(id, body, state)                       → { id, url, version }
```

The body is markdown. The MCP server is responsible for translating to the provider's native format (Confluence storage XHTML, Notion blocks, Slab post body, etc.).

#### Compatibility matrix — what's known to work

| Provider | MCP availability | Provider-specific quirks (handled in `mcp_guidance`) |
|---|---|---|
| **Atlassian (Confluence)** | Official Atlassian Rovo MCP — already declared in this pack's `mcp_servers` | None — direct fit. `space` + `parent_page_id` map 1:1. |
| **Notion** | `@modelcontextprotocol/server-notion` (community / official) | Uses `database_id` not `space`; "draft" maps to a `Status` property if the database has one, otherwise unpublished page == draft by convention |
| **Slab** | Slab MCP wrapper (write a thin one if your team uses Slab) | "Topic" instead of "page hierarchy"; `state: draft` → unpublished post; no parent-child concept (use a top-level topic ID as `parent_page_id`) |
| **Outline** (open-source wiki) | Outline MCP wrapper around the public API | "Collection" instead of "space"; standard parent/child page model — close fit |
| **GitBook** | GitBook MCP wrapper | "Space" maps directly; drafts are first-class — clean fit |
| **BookStack** (self-hosted) | BookStack MCP wrapper around its REST API | "Books" + "chapters" — `parent_page_id` becomes chapter ID |
| **Google Docs / Drive** | Google Drive MCP | Folder ID → `parent_page_id`; "draft" via "view-only by default" sharing — needs a guidance prose line |
| **Internal / custom wiki** | A thin MCP wrapper your team writes around your wiki's API (~100–200 lines with the @modelcontextprotocol SDK) | Whatever your wiki's API needs — explained in `mcp_guidance.docs_publish` prose |

#### Where each provider's quirks live (the 4-surface separation)

The pipeline keeps four responsibilities cleanly separated, which is what makes provider-swapping painless:

| Surface | Job | Example for Notion |
|---|---|---|
| `mcp_servers` | "Here's how to *connect* to provider X" — auth, URL, command, env vars | `notion: { auth: token, config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-notion"], env: { NOTION_TOKEN: "${NOTION_TOKEN}" } } }` |
| `mcp_roles.docs_publish` | "*Use* provider X for the publish role" — one line, the routing decision | `docs_publish: notion` |
| `docs_publish_target` | The values that go *into* the createPage call (parent ID, space, title format, gate behavior) | `parent_page_id: "abc123database…"`, `space: ""` (Notion has no space concept) |
| `mcp_guidance.docs_publish` | Prose-level adapter — quirks the structured config can't express | "pass parent_page_id as `database_id`; Notion has no native draft, fall back to Status property" |

So switching from Confluence → Notion is roughly:
1. Declare the Notion MCP in `mcp_servers` (~6 lines)
2. Change `mcp_roles.docs_publish: atlassian` → `docs_publish: notion` (1 line)
3. Update `docs_publish_target.parent_page_id` to the Notion database ID (1 line)
4. Optionally add 3–5 lines in `mcp_guidance.docs_publish` for quirks

**No agent prompt changes, no validator changes, no kernel rework.** Same recipe applies to Slab, Outline, GitBook, internal wikis — anything that speaks the contract.

#### Two-line check before adopting an alternative

When evaluating any non-Confluence provider, the only two questions to answer:

1. **Does it have an MCP server?** (official, community, or one you'll write)
2. **Can that MCP create + update pages under a parent, with a draft state?**

If both are yes, it works. If "draft state" is fuzzy on that provider (Notion, Google Docs), `mcp_guidance` carries the workaround in prose — agents follow the guidance verbatim at runtime.

#### When it doesn't work

There's one hard requirement: **the wiki must be reachable via an MCP server.** If your internal wiki has no MCP wrapper at all, the pipeline can't talk to it. Three options:

1. **Build a thin MCP wrapper** (~100–200 lines with the @modelcontextprotocol SDK) around your wiki's REST API. The pipeline doesn't care if the wrapper is official, third-party, or hand-rolled — just that it speaks MCP and exposes the contract above.
2. **Use a generic HTTP MCP** if your wiki has a simple REST API. Some generic MCPs can drive arbitrary HTTP endpoints with prose-level guidance describing the request shapes.
3. **Stay local-only.** Leave `docs_publish` unset or `enabled: false`. The pipeline runs exactly as it does today — `$LLD_FILE` locally, no remote publishing, zero behavior change. This is a perfectly valid long-term posture; publishing is opt-in for a reason.

#### Lifecycle (per story)

1. **Phase C gate**: user reviews the LLD. Amendments stay local; the remote page is untouched until "Go".
2. **User says "Go"** → branch is created, JIRA is updated, then C.5b runs.
3. **C.5b user gate fires** (per `publish_gate` setting). User picks Yes / No / Disable / Never-ask.
4. **First publish** (gate `Yes`, frontmatter has no `published_id`): Orchestrator calls `createPage`, then writes `published_id`, `published_url`, `published_state`, `published_content_hash`, `published_at`, and `published_to: <provider>` into `$LLD_FILE` frontmatter.
5. **Subsequent re-trigger** (e.g. user re-runs Orchestrator with amendments after Surgeon started): C.5b's idempotency check inspects `published_id` + content hash. If hash matches, skip (≈ $0.001). If hash differs, gate fires (per `publish_gate`) → on `Yes`, calls `updatePage`. State stays `draft` — never auto-promoted.
6. **Ship**: reads `published_url` from frontmatter, includes it in the PR body. Does NOT promote draft → published. The owner publishes manually after PR review.

#### Failure handling

`docs_publish` MCP failures are **non-blocking** (Decision: warn + local-only). The pipeline does not halt. The local `$LLD_FILE` is canonical, so the rest of the pipeline (Surgeon, Review, Ship) runs identically to today. Re-running C.5b after fixing the MCP issue picks up where it left off because of the content-hash idempotency.

#### Token cost

| Operation | Tokens (in / out) | $ at Sonnet ($3in / $15out) |
|---|---|---|
| User gate prompt (per firing) | ~150 in / ~50 out | **~$0.001** |
| First publish (gate `Yes` → createPage with full LLD body) | ~200 in / ~3K out | **~$0.05** |
| Amendment with content changed (gate `Yes` → updatePage) | ~200 in / ~3K out | **~$0.05** |
| Amendment with content unchanged (hash idempotency skip) | ~100 in / ~50 out | **~$0.001** |
| Gate `No` / `Disable` / config short-circuit | ~150 / ~0 | **~$0.001 / $0** |

Across a 15-story epic with default `publish_gate: always`: typically **~$0.75–$1.05** added to the pipeline cost (the gate adds ~$0.015 vs. an ungated flow). The pipeline's token savings vs. traditional flow (~$22.70/epic) dwarf this.

#### Worked example — Atlassian (Confluence)

```yaml
mcp_servers:
  atlassian: { auth: oauth, config: { url: "https://mcp.atlassian.com/v1/mcp" } }

mcp_roles:
  story_source: atlassian
  design_source: figma
  vcs: [github]
  docs_source: atlassian
  docs_publish: atlassian

docs_publish_target:
  enabled: true
  publish_gate: always
  space: "ENG"
  parent_page_id: "983041"
  state: draft
  title_format: "{TICKET_ID} LLD — {title}"
```

Result on C.5b (post-"Go"): user sees the publish-gate prompt with title, target, body size, and cost. On `Yes`, page titled `IIQ-1234 LLD — Add approval-rules card` is created under the ENG space's parent page 983041, in draft state. Frontmatter of `contexts/IIQ-1234-lld.md` records the URL. On `No`, nothing publishes; the prompt fires again on the next "Go".

#### Worked example — Notion via guidance (alternative provider)

```yaml
mcp_servers:
  notion: { auth: token, config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-notion"], env: { NOTION_TOKEN: "${NOTION_TOKEN}" } } }
  atlassian: { auth: oauth, config: { url: "https://mcp.atlassian.com/v1/mcp" } }

mcp_roles:
  story_source: atlassian
  design_source: figma
  vcs: [github]
  docs_source: atlassian
  docs_publish: notion

docs_publish_target:
  enabled: true
  publish_gate: first_only                  # confirm first publish; auto-update on amendments
  space: ""                                 # Notion uses database_id, not space — left empty
  parent_page_id: "abc123notiondatabaseid"  # Notion database ID
  state: draft                              # Notion has no native draft; mapped via guidance below
  title_format: "[{TICKET_ID}] {title}"

mcp_guidance:
  docs_publish: |
    Notion MCP: pass parent_page_id as `database_id` (not `parent_id`).
    Notion has no first-class draft state — set `state: draft` is interpreted
    as "create with `Status` property = Draft" if the database has that property,
    otherwise the page is created normally and the team treats unpublished == draft.
```

How to use it day-to-day: at Phase C "Go", the user sees the publish gate showing `Provider: notion`, `Title: [IIQ-1234] Add approval-rules card`, target database ID, body size, cost. On `Yes`, the page lands in the Notion database; subsequent amendments auto-update silently because `publish_gate: first_only`.

#### Worked example — Slab (alternative SaaS knowledge base)

Slab uses "topics" instead of a page hierarchy and lacks an explicit draft state. Wrap it in `mcp_guidance` prose:

```yaml
mcp_servers:
  slab:
    auth: token
    config:
      command: "npx"
      args: ["-y", "mcp-server-slab"]   # community wrapper, or your own
      env:
        SLAB_TOKEN: "${SLAB_TOKEN}"
  atlassian: { auth: oauth, config: { url: "https://mcp.atlassian.com/v1/mcp" } }

mcp_roles:
  story_source: atlassian
  design_source: figma
  vcs: [github]
  docs_source: atlassian
  docs_publish: slab

docs_publish_target:
  enabled: true
  publish_gate: always
  space: ""                      # Slab has no space concept; left empty
  parent_page_id: "topic_engineering_lld_drafts"   # Slab topic ID
  state: draft                   # mapped to "unpublished post" via guidance
  title_format: "{TICKET_ID} — {title}"

mcp_guidance:
  docs_publish: |
    Slab MCP: there is no parent page model — `parent_page_id` is a Slab topic ID.
    Slab has no native draft state; create the post unpublished (state: draft is
    interpreted as `published: false`). Promotion to "published" remains manual
    (Ship will not auto-promote — Decision #2).
```

How to use it day-to-day: same gate prompt, just shows `Provider: slab`. On `Yes`, the LLD posts as an unpublished entry under the engineering topic. Surgeon, Review, Ship behave identically — they read `$LLD_FILE` locally; only the PR body and epic-context entry pick up the Slab URL.

#### Worked example — Internal / custom wiki (via a thin MCP wrapper)

For an internal wiki that has a REST API but no public MCP server, write a small wrapper. The wrapper only needs to expose `createPage` and `updatePage`:

**1. The wrapper (~150 lines — sketch):**

```js
// internal-wiki-mcp/index.js
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import fetch from "node-fetch";

const server = new Server({ name: "internal-wiki", version: "0.1.0" });
const BASE = process.env.WIKI_BASE_URL;
const TOKEN = process.env.WIKI_TOKEN;

server.tool("createPage", {
  description: "Create a draft page under a parent in the internal wiki",
  inputSchema: {
    type: "object",
    properties: {
      space:        { type: "string" },
      parent_id:    { type: "string" },
      title:        { type: "string" },
      body:         { type: "string" },   // markdown
      state:        { type: "string", enum: ["draft", "current"] },
    },
    required: ["parent_id", "title", "body"],
  },
}, async ({ space, parent_id, title, body, state }) => {
  const res = await fetch(`${BASE}/api/v1/pages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ space, parent_id, title, body_md: body, status: state }),
  });
  const j = await res.json();
  return { id: j.page_id, url: `${BASE}/p/${j.page_id}` };
});

server.tool("updatePage", { /* same shape, calls PUT /api/v1/pages/:id */ });

server.start();
```

**2. The pack config:**

```yaml
mcp_servers:
  internal_wiki:
    auth: token
    config:
      command: "node"
      args: ["/path/to/internal-wiki-mcp/index.js"]
      env:
        WIKI_BASE_URL: "https://wiki.internal.example.com"
        WIKI_TOKEN:    "${INTERNAL_WIKI_TOKEN}"
    setup_hint: |
      Internal wiki MCP — install once via `npm i -g internal-wiki-mcp`
      or check it out from internal-tools/. Token is your wiki API key.
  atlassian: { auth: oauth, config: { url: "https://mcp.atlassian.com/v1/mcp" } }

mcp_roles:
  story_source: atlassian
  design_source: figma
  vcs: [github]
  docs_source: atlassian
  docs_publish: internal_wiki         # routes publish to the in-house MCP

docs_publish_target:
  enabled: true
  publish_gate: always
  space: "engineering"                # whatever your wiki calls a top-level area
  parent_page_id: "lld-drafts-2026"   # parent page ID in your wiki
  state: draft
  title_format: "{TICKET_ID} LLD — {title}"

mcp_guidance:
  docs_publish: |
    Internal wiki: drafts are visible only to the author until promoted.
    Promotion is manual via the wiki UI (matches Decision #2 — Ship does not promote).
    Title is unique per parent, so re-runs with the same ticket update the existing draft.
```

How to use it day-to-day: identical UX to the Atlassian or Notion path. The user sees `Provider: internal_wiki` in the gate prompt and a URL pointing to your internal hostname after publishing. The pipeline doesn't know or care that this isn't Confluence — it speaks MCP, that's all that matters.

The same wrapper recipe works for any internal system with an HTTP API: BookStack, Outline, MediaWiki, custom CMS. The wrapper is the only piece that knows the wiki's specifics; everything above it (the four-surface config) stays uniform across providers.

#### Validator behavior (V5)

| Condition | Severity |
|---|---|
| `docs_publish_target.enabled` not boolean | error |
| `docs_publish_target.state` not `draft` or `current` | error |
| `docs_publish_target.publish_gate` not `always` / `first_only` / `never` | error |
| `docs_publish_target.publish_gate: never` | warn (deliberate-choice nudge — disables consent prompt) |
| `docs_publish_target.space` / `parent_page_id` / `title_format` not string | error |
| `mcp_roles.docs_publish` set but `docs_publish_target` missing | warn |
| `enabled: false` with `parent_page_id` populated | warn (informational — confirms suspension is intentional) |

#### Anti-patterns

- **Don't put `enabled` in `mcp_roles`.** It's a toggle, not a route. The four-role grammar of `mcp_roles` is `name → mcp_key`, not `name → { mcp_key, enabled }`.
- **Don't skip the local file.** B.3.5 always runs *after* B.2/B.3 — it never substitutes for the local write. Surgeon, Review, and Amender all read locally; the published page is for human review only.
- **Don't auto-promote in Ship.** Drafts stay drafts. Owners publish manually after PR review. (Phase 2 may add an opt-in promotion flag.)
- **Don't bypass content-hash idempotency.** Re-publishing on every Phase C iteration without checking the hash burns tokens for no gain.
- **Don't set `publish_gate: never` casually.** It's the right choice for fully automated CI-style pipelines, but for interactive use the consent prompt is a tiny cost ($0.001/firing) for a meaningful safety property. The validator's warn on `never` is intentional friction.
- **Don't try to publish during Phase C amendments.** C.5b is post-approval (after "Go") by design. Earlier publication churns a remote page for content the user is still amending; the design correctly defers all publishing to a single moment of consent.

### Block 3 — `mcp_guidance` (OPTIONAL — prose quirks)

Plain-English augmentation for `mcp_roles`. **Only** consulted for documented conditional overrides — NOT a general routing mechanism. Leave empty (`{}`) for the common case.

Use it when you need a conditional that the structured `mcp_roles` mapping can't express. Example — a team keeps JIRA as the primary story source but also accepts Odoo-tracked tickets:

```yaml
mcp_servers:
  atlassian: { auth: oauth, config: { url: "https://mcp.atlassian.com/v1/mcp" } }
  odoo:      { auth: token, config: { command: "npx", args: ["-y", "mcp-server-odoo"], env: { ODOO_TOKEN: "${ODOO_TOKEN}" } } }

mcp_roles:
  story_source: atlassian             # primary
  # ... other roles ...

mcp_guidance:
  story_source: |
    Ticket IDs starting with "ODO-" come from Odoo — route those to the
    odoo MCP if configured. Otherwise use mcp_roles.story_source.
```

At pre-flight, Orchestrator consults this text only for the specific quirk (ODO-prefix routing). For all other ticket IDs, it follows the structured `mcp_roles.story_source` value.

**Validator checks:** orphan guidance keys (guidance for a role not in `mcp_roles`) trigger a warning. Non-string values trigger an error.

### Token-efficiency note

Comments in the **pack seed** (this file's sibling `pipeline.<pack>.yaml`) are **free at runtime** — the seed is never loaded by agents. It's only read by the installer + by you (pack author). So write as much commentary as helps you maintain the pack.

The **runtime splits** (written to `contexts/config/pipeline.<pack>.*.yaml` at install time) ARE loaded by agents on every pre-flight — every comment line costs tokens there. That's why the installer **strips all comment-only lines** when writing the splits:

```
pack seed (you edit)             →   runtime splits (agents read)
─────────────────────────        →   ─────────────────────────
1219 lines · ~170 comment lines  →   859 lines · 0 comment lines
```

The stripper is in `contexts/tools/split-pipeline.mjs` → `stripCommentLines()`. It:

- Drops every line that starts with optional whitespace + `#` (pure comment lines)
- Preserves YAML data, indentation, quoted values, blank separators
- Collapses 3+ consecutive blank lines to 1
- Leaves inline trailing comments untouched (rare; regex-stripping them risks breaking quoted strings with `#`)

This splits the concern cleanly:

| Audience | What they read | Comments |
|---|---|---|
| Pack author (you) | `packs/<pack>/pipeline.<pack>.yaml` (seed) | **Keep generous inline comments** — they help maintenance. Zero runtime cost. |
| Agents at pre-flight | `contexts/config/pipeline.<pack>.*.yaml` (splits) | **Zero comments** — installer strips them. Slim files, tight agent context. |
| Tech lead editing config | `contexts/config/pipeline.<pack>.*.yaml` (splits) | No comments — but this file (`pipeline.<pack>.forauthor.readme.md`) + the pack seed are the reference. Tech leads can read the seed on GitHub if they want the commentary. |

So as a pack author: **write the detailed explanation IN the seed** (as inline comments) AND optionally mirror the design rationale here (for discoverable search). The installer takes care of stripping for the agents.

---

## Config keys — what's live, what's tooling-only

Before adding a new top-level block to the pack seed, confirm it has a consumer. A full audit of the current pack is below — use it as a reference when deciding whether a new key will actually do something or just sit as dead config.

### Consumed by agents at runtime

These are what actually drive pipeline behavior. Any new key you add should land in this tier.

| Block | Primary consumers |
|---|---|
| `skills` (`layer_map`, `orchestrator`, `explorer`, `extra_triggers`) | Orchestrator, Surgeon, Explorer, Project-Analyzer |
| `shared_paths` | Orchestrator, Explorer, Surgeon, Project-Analyzer |
| `operation_patterns` | Orchestrator, Explorer, Surgeon |
| `i18n` | Orchestrator (task decomposition), Surgeon (implementation) |
| `component_structure` | Surgeon (component scaffolding) |
| `component_naming` | Orchestrator, Explorer, Project-Analyzer |
| `scan_exclusions` | All agents (grep safety) |
| `explorer_paths` | Explorer (scan scope), Project-Analyzer (Phase 8c) |
| `rescan_hints` | Project-Analyzer, Orchestrator (freshness check) |
| `intent_classification` | Orchestrator (verb resolution) |
| `runtime.branching.*` | Orchestrator (branch naming), Ship |
| `runtime.contexts_layout.*` | All agents (path resolution via `agent-flow.mdc § Procedure B`) |
| `runtime.trigger.inline_context_keyword` | Orchestrator |
| `jira.label` / `jira.add_at` / `jira.on_failure` / `jira.post_comment` / `jira.reference_link_types` / `jira.status_map.*` | Orchestrator, Review, Ship |
| `jira.status_groups.{active_hydrate, active_flag_only, completed}` | Orchestrator (A.4a-bis drift check bucketing + conditional LLD hydration) |
| `demo.*` | AC-E2E-Check |
| `subagents.*` | Whichever agent declares the extension point |
| `mcp_servers.*.auth` / `config` / `setup_hint` | `mcp-sample-generator.mjs`, `subagent-image-analysis` (connection) |
| `mcp_roles.*` | Orchestrator (resolve_mcp_roles), Review, Ship, AC-E2E-Check |
| `mcp_guidance.*` | Orchestrator (only when declared quirks apply) |

### Consumed by tooling only (not agents)

Legitimate keys that serve the installer / validator / split-pipeline — NOT read by any agent at runtime.

| Key | Consumer | Why it exists |
|---|---|---|
| `meta.schema_version` | `validate.mjs` | Warns when config schema drifts from validator expectations |
| `meta.pack` | `install.mjs`, `split-pipeline.mjs` | Pack name drives split filenames (`pipeline.<pack>.*.yaml`) |

**Rule of thumb:** `meta.*` is tooling-only. Anything else you add to the seed should be readable by at least one agent, otherwise it's dead config.

### Self-referential (written + read by one agent)

| Key | Consumer | Notes |
|---|---|---|
| `analyzer_ignore` | Project-Analyzer (writes on ignore-gate; reads next rescan) | User-maintained opt-out list — remembers "ignore this framework" decisions across rescans. |

### Retired (parsed but warned; safe to remove from pack seeds)

Validator warns on these so legacy packs keep parsing cleanly. Kernel code no longer reads them.

| Retired key | Replaced by |
|---|---|
| `project:` block (entire) | `runtime.branching.*` + ticket prefix from trigger |
| `mcp_servers.*.used_by` | `mcp_roles` (role-based routing) |
| `mcp_servers.*.required` | Fallback-chain driven halt |
| `mcp_servers.*.skip` | CLI `--skip` flag or `mcp_roles.<role>: null` |
| `mcp_servers.*.fallback_prompt` | Built-in per-role gate text; rule-layer override if needed |

### How to check before adding a new key

When you add a new top-level block to the seed, confirm there's at least one `.md` or `.mdc` file in `agent-pipeline/agents/`, `agent-pipeline/rules/`, `packs/<pack>/rules/`, or `packs/<pack>/skills/` that explicitly references it. If nothing does, either:

1. Wire the consuming agent to read it (preferred — add a real consumer), or
2. Don't add the block (it's dead config).

Grep discipline:
```bash
grep -rnE "\byour_new_key\b" agent-pipeline/ packs/ contexts/tools/ 2>/dev/null
```

If this returns only the pack seed itself, the key has no consumer.

---

## Explorer — in-flight sibling branch scan

Explorer's pre-flight step `scan_inflight_siblings (2.5)` surfaces **unmerged sibling work** under the current epic by scanning local git branches. It complements the codebase-map (which reflects MERGED code only) by catching open PRs that might overlap with the current story's tasks.

### What it does

For each remote branch matching `{prefix_story}{EPIC_PREFIX}-*` or `{prefix_bug}{EPIC_PREFIX}-*` (from `runtime.branching.*` config):

1. Skip if merged into base branch (already in codebase-map)
2. Skip if stale (last commit > 30 days old)
3. Compute: files touched, stat summary, last author, last commit date
4. Cross-reference with the current story's tasks (from `$LLD_FILE` PART 2)
5. Flag any task whose target files overlap with a sibling branch's touched files

Results are appended to `$EXPLORATION_FILE` as an **"In-flight Siblings"** table plus an "⚠ Potential conflicts" summary if overlap is detected.

### When it runs

| Condition | Scans? |
|---|---|
| Pipeline mode + epic exists + git repo | ✅ Yes |
| Standalone mode | ❌ Skipped silently |
| No epic (standalone ticket) | ❌ Skipped silently |
| Not a git repo | ❌ Skipped silently |
| No remote configured | ❌ Skipped silently (`git fetch` warning written to log, not error) |

### Token cost

**Effectively zero.** Pure local git — no MCP calls, no external network. Per-branch record is ~50-80 tokens; capped at 10 branches. Typical cost: 500-800 tokens one-time at Explorer pre-flight.

Contrast: fetching the same siblings' PR diffs via GitHub MCP would cost ~3-10K tokens per branch. `scan_inflight_siblings` gives most of the value (knowing what's in flight + overlap detection) without the MCP hit. For full pattern-level PR diff, developers still use `— reference: SIBLING-ID` at Orchestrator time.

### Edge cases handled

- **Current branch excluded** — the story's own branch doesn't appear in the list
- **Merged branches excluded** — `git merge-base --is-ancestor` check
- **Stale branches excluded** — 30-day age cutoff (configurable in future if needed)
- **Non-standard branch naming** — uses the pack's `runtime.branching.prefix_story` / `prefix_bug` values to build the branch regex; won't find branches with ad-hoc names
- **More than 10 branches** — caps at top 10 by recency, notes count of skipped ones

### What it does NOT do

- **Does not fetch PR diffs** — that remains `— reference:` flag territory via GitHub MCP
- **Does not read file content** from sibling branches — only `git diff --name-only` for file lists
- **Does not gate the story** — informational only; developer decides whether to coordinate with the sibling author
- **Does not auto-add references** — the overlap warning suggests re-triggering with `— reference: SIBLING-ID` but doesn't do it automatically

### Example output (in `$EXPLORATION_FILE`)

```markdown
## In-flight Siblings (epic PROJ-EPIC-42)

| Sibling | Branch | Files | Last commit | Overlap |
|---|---|---|---|---|
| PROJ-1235 | feature/PROJ-1235-auth-middleware | 8 (+210/-30) | @alice · 2d | ⚠ T3 (src/auth/session.js) |
| PROJ-1237 | feature/PROJ-1237-extract-form | 3 (+45/-12)  | @bob · 5d   | — no overlap |

### ⚠ Potential conflicts

**Task T3** modifies `src/auth/session.js`, which **PROJ-1235** is also
modifying on `feature/PROJ-1235-auth-middleware` (last updated 2 days ago).
- Coordinate with @alice before implementing T3
- Or re-trigger Orchestrator with `— reference: PROJ-1235` to include its
  PR diff for pattern alignment.
```

### Why this earns its keep

Teams with multiple developers on the same epic frequently hit merge conflicts because each branch evolves in isolation. The codebase-map captures merged code but misses "what Alice is doing on her open branch right now." This scan fills that gap at zero API cost. It's the cheapest way to catch "two people modifying `session.js` in parallel" before it becomes a painful merge resolution.

### Disabling

There's no config flag today — the step is unconditionally on in pipeline story mode. If a pack author needs to disable (e.g., a team that doesn't use branch-per-ticket conventions), the cleanest override is a pack rule that instructs Explorer to skip the step — or a future config knob `explorer.scan_inflight_siblings: false` can be added if the need arises.

---

## `jira.status_groups` — configure drift-check status classification

JIRA status filtering has TWO sides:

| Direction | Config | Used for |
|---|---|---|
| **Write** — transitions | `jira.status_map.*` | Orchestrator/Review/Ship move the ticket through these states |
| **Read** — bucketing siblings | `jira.status_groups.{active_hydrate, active_flag_only, completed}` | Orchestrator's drift check (A.4a-bis) — classifies each sibling story so it can render the right recommended action AND decide whether to pull the LLD |

### The 4-bucket model

Every sibling story in the epic falls into exactly one of four buckets. The first three are configured; the fourth is implicit:

| Bucket | Config key | Meaning | Drift-check action | LLD fetched? |
|---|---|---|---|---|
| **active_hydrate** | `jira.status_groups.active_hydrate` | In-flight **and** content is stable enough to read (design locked, PR up) | `⚠️ coordinate with author — may conflict with your tasks` | **Yes** |
| **active_flag_only** | `jira.status_groups.active_flag_only` | In-flight **but** content too volatile to read (still churning) | `⚠️ coordinate with author — may conflict with your tasks` | **No** |
| **completed** | `jira.status_groups.completed` | Shipped / merged — code already lives in the repo | `🔄 run git pull — pick up shipped code before implementing` | **Yes** |
| *everything else* | *(implicit)* | Backlog, grooming, rejected, planning | **skipped** — not surfaced in drift output | No |

**LLD hydration = `active_hydrate ∪ completed`.** These are the siblings whose Confluence LLD gets pulled into `epic-context.md` inline during the drift check, so Surgeon's Phase B can read them without a separate fetch.

### Why the split matters

A sibling in `Ready for Testing` is in very different shape from a sibling in `In Progress`:
- **`Ready for Testing`**: design is locked, code is written, PR likely open — reading the LLD is useful (your task may depend on theirs or touch the same files).
- **`In Progress`**: design may still be shifting, code may not compile, LLD may be half-written — reading it is noise. A warning to coordinate with the author is the right signal; pulling the (unstable) content would pollute epic-context.

Flattening both into one "active" list forces a binary choice: always hydrate (noisy) or never hydrate (misses useful context). Splitting lets you hydrate the stable ones and flag the volatile ones.

### 4-tier fallback (what the orchestrator reads at A.4a-bis)

Most-specific → least-specific:

1. **New 3-bucket shape**: `status_groups.{active_hydrate, active_flag_only, completed}` declared → used directly (recommended).
2. **Legacy flat shape**: only `status_groups.active` declared → treated as `active_flag_only`; no hydration for in-flight siblings. Validator warns.
3. **Pre-v24 shape**: legacy `jira.active_states` declared → treated as `active_flag_only`. Validator warns; `completed` defaults to `["Done"]`.
4. **Nothing declared**: synthesized from `status_map` values — `active_flag_only = [in_development, review_done, ship_done]`, `completed = ["Done"]`, `active_hydrate = []`.

The JQL query unions all in-flight + completed buckets so all relevant siblings are fetched in one round trip; bucketing happens client-side, then LLD hydration loops only over `active_hydrate + completed`.

### Example — team with custom workflow

```yaml
jira:
  status_map:
    in_development: "In Progress"       # their "in-flight" state (write-side)
    review_done: "Code Review"          # their "PR open" state (write-side)
    ship_done: "Ready for Testing"      # their "code shipped" state (write-side)

  status_groups:
    active_hydrate:                     # in-flight + stable → warn + pull LLD
      - "Code Review"
      - "Ready for Testing"
    active_flag_only:                   # in-flight + volatile → warn only
      - "In Progress"
      - "Ready for Review"
    completed:                          # shipped → pull LLD + suggest git pull
      - "Engineering Complete"
      - "Done"
      - "Closed"
    # Backlog / Grooming / Rejected are NOT listed → implicitly skipped
```

### Validator rules (Check 9b)

- Each declared bucket must be a list of non-empty strings (case-sensitive match against JIRA's `status.name`).
- A status name may appear in **exactly one** bucket — overlap across any pair is a hard error (the bucket decides the rendered action AND whether to hydrate; ambiguity breaks both).
- Cannot declare both legacy `active:` AND new `active_hydrate:`/`active_flag_only:` — pick one shape (hard error).
- Unknown bucket keys warn (typos like `active_hydrated` would otherwise silently drop the list).
- Empty bucket (declared but no entries) → warning; either remove the key or declare at least one status.
- Both `status_groups` and legacy `active_states` declared → warning; `status_groups` wins.

### What you should NOT include

- **Backlog states** (`To Do`, `Backlog`, `Selected`, `Ready for Grooming`, `Grooming in Progress`) — planning, not "real sibling work." Leave them out; the implicit-skip bucket handles them correctly.
- **Rejected states** (`Won't Do`, `Duplicate`, `Cancelled`, `Rejected`) — explicitly not tracked siblings. Leave them out.
- **Temporary / informal states** — only stable workflow states from your JIRA admin config; ad-hoc labels will silently no-op.

### Example drift-check output (4-bucket rendering)

```
🟡 Drift check — epic siblings missing from epic-context.md:

  IN FLIGHT — HYDRATED (LLD pulled into epic-context; coordinate before edits)
    • PROJ-1237  "Add rate-limit middleware"     [Code Review]      @alex   ✓ LLD hydrated
    • PROJ-1241  "Refactor auth middleware"      [Ready for Testing] @sam   ✓ LLD hydrated

  IN FLIGHT — FLAG ONLY (content too volatile; coordinate with author)
    • PROJ-1243  "Rework permission cache"       [In Progress]      @priya

  ALREADY SHIPPED — HYDRATED (LLD pulled into epic-context; `git pull` for code)
    • PROJ-1235  "Extract config loader"         [Done]             @jess   ✓ LLD hydrated
    • PROJ-1238  "Add OIDC provider support"     [Done]             @morgan ✓ LLD hydrated

(2 backlog siblings skipped — not surfaced)
```

### How Explorer consumes the buckets (v25+ status-aware scan)

Explorer's `scan_inflight_siblings (2.5)` uses the same `status_groups` buckets to decide how deep to scan each sibling branch. The bucket map is persisted by Orchestrator A.4a-bis into the active-context file (`sibling_buckets:` block, ~15 tokens per 10 siblings); Explorer reads it locally with no MCP.

| Bucket | Explorer scan depth | What gets read | Overlap computed? |
|---|---|---|---|
| `active_hydrate` | **deep** | Full `git diff --name-only` + shortstat + per-file overlap check | Yes |
| `active_flag_only` | **shallow** | File count + last-commit author/date only — no diff content | No (content too volatile) |
| `completed` | **skip** | Branch usually merged/deleted; codebase-map sync owns this | — |
| *everything else* | **skip** | Not real work | — |

**Back-compat:** If `sibling_buckets` is absent (first-story flow, drift check was skipped, or pre-v25 epic-context file), Explorer falls back to the pre-v25 behavior — deep-scan every non-stale, non-merged sibling branch. No regression; just loses the token savings.

**Token savings in a typical 15-story epic:** with ~6 `active_hydrate`, ~3 `active_flag_only`, ~5 `completed`, ~1 backlog, pre-v25 Explorer would deep-scan ~9 branches (~700 tokens). v25 Explorer deep-scans 6, shallows 3, skips 5 — ~450 tokens. **~35% reduction**, with overlap detection still running on the stable siblings that actually matter.

**Design note — why not make Explorer query JIRA directly?** Explorer is deliberately MCP-free (pure local git). Adding an MCP dependency for status lookup would break the "Explorer runs even when offline" invariant. Persisting the bucket map at Orchestrator time (one round trip, already happening) and handing it off via a file is the cheapest way to keep Explorer local-only while making it status-aware.

### Coverage header + Source markers (v25+)

Every A.4a-bis run writes/updates a Coverage block at the top of `epic-context.md` so a dev (or Surgeon) can see provenance at a glance without re-running the drift check:

```markdown
## Coverage (last synced 2026-04-24 by PROJ-1243)

- HLD:          1 page(s)
- SPIKE docs:   2 page(s)
- Stories:      8 of 15 (6 pipeline-review · 2 auto-hydrated · 1 user-reference)
- Not covered:  7 (backlog/grooming — implicit skip)
- Drift state:  in sync
```

Each story row also gets a `**Source:**` line identifying its origin:

| Source value | Written by | Means |
|---|---|---|
| `pipeline-review ({date})` | Review Part 5 | This-epic's pipeline shipped it; LLD is in `$CONTEXT_DIR/{ticket}.md` |
| `auto-hydrated A.4a-bis ({date}, bucket={active_hydrate\|completed})` | Orchestrator A.4a-bis | Sibling pulled from Confluence; LLD summary inline in epic-context |
| `user-reference` | Orchestrator `resolve_enrichments` | User passed `--reference {ID}` flag |

**Token cost of the new metadata:**
- Coverage header: ~60 tokens, **static** — doesn't grow with epic size.
- Source line per row: ~10 tokens × N stories. For a 15-story epic, ~150 tokens total.
- Combined: ~210 tokens for a large epic — well under 1% of typical context windows, and pays back the moment you need to answer "why is PROJ-1237 in here?" without a re-run.

**Back-compat:** A.4a parser tolerates missing Coverage header and missing `Source:` lines on pre-v25 files. First A.4a-bis run after upgrade writes the header; subsequent runs update it in place (find-and-replace by heading).

### When to put a status in `active_hydrate` vs `active_flag_only`

Rule of thumb: **would reading the LLD right now give you accurate signal, or stale/half-written noise?**

| Team signal | Bucket |
|---|---|
| Design doc is approved + code is in PR review | `active_hydrate` |
| Tests are being written against a locked spec | `active_hydrate` |
| Ticket is in "initial dev" / scope may still shift | `active_flag_only` |
| Author is actively restructuring the approach | `active_flag_only` |
| No Confluence LLD exists yet | `active_flag_only` (hydration falls through automatically) |

If you're unsure, default a status to `active_flag_only` — a missed hydration is cheaper to recover from (re-run or reference flag) than polluting epic-context with a half-written LLD.
