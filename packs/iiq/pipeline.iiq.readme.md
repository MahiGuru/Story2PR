# Pipeline YAML — Team Member's Guide

This guide is **for you, the team member in a user project**.

You edit config in your own project's `contexts/config/` and installed `.cursor/` (or `.claude/`) folders. Your edits are local to your project until you open a PR to promote them to the pack.

---

## What you edit

After install, your project has:

```
contexts/config/
├── pipeline.<pack>.yaml            ← CORE: runtime, jira, mcp_servers, subagents, intent_classification
├── pipeline.<pack>.skills.yaml     ← skills.layer_map, skills.extra_triggers, per-agent skills
├── pipeline.<pack>.builds.yaml     ← builds.commands, component_structure, operation_patterns, i18n
├── pipeline.<pack>.analyzer.yaml   ← shared_paths, scan_exclusions, rescan_hints
├── pipeline.<pack>.e2e.test.yaml   ← demo / E2E config
└── pipeline.<pack>.readme.md       ← this file

.cursor/  (or .claude/)
├── agents/
├── rules/    ← drop new .mdc files here to add always-on rules
└── skills/   ← drop new .md files here to add task-triggered skills
```

Agents read from `contexts/config/pipeline.<pack>.*.yaml`. Your edits take effect on the next agent run — no install needed.

---

## Which split file owns what

| File | Edit it for |
|---|---|
| `pipeline.<pack>.yaml` (core) | Branch prefix, JIRA project key, MCP servers, subagent hooks, verb classifications |
| `pipeline.<pack>.skills.yaml` | Layer → skill mappings, conditional triggers, Orchestrator/Explorer per-agent skills |
| `pipeline.<pack>.builds.yaml` | Build commands, forbidden targets, component structure rules, i18n rules |
| `pipeline.<pack>.analyzer.yaml` | Scan exclusions, component naming prefix, rescan thresholds, analyzer ignore list |
| `pipeline.<pack>.e2e.test.yaml` | Demo URL, browser credentials, E2E framework config |

**Quick decision:** not sure which file? Just search across all 5 for the YAML key you want to edit:

```bash
grep -rn "^<your_key>:" contexts/config/pipeline.*.yaml
```

---

## Recipes

### Recipe 1 — Add a new SKILL

**What's a skill?** A `.md` file with per-task guidance. Surgeon loads it when a task's layer or file set matches.

**5 steps:**

1. **Drop the skill file:**
   - Cursor: `.cursor/skills/<pack>-<name>.md`
   - Claude Code: `.claude/skills/<pack>-<name>/SKILL.md` (directory layout — see existing skills)

   Use an existing skill as a template (copy `.cursor/skills/iiq-java-standards.md` and modify).

2. **Wire it in `contexts/config/pipeline.<pack>.skills.yaml`** — pick ONE:

   **Always-for-a-layer** (e.g. every Java REST task loads this):
   ```yaml
   skills:
     layer_map:
       "Backend/REST":
         skills: [iiq-java-standards.md, iiq-rest-api-standards.md, <pack>-<name>.md]   # ← append
   ```

   **Conditional** (only when task touches specific code):
   ```yaml
   skills:
     extra_triggers:
       # ... existing entries ...
       - when: "task touches src/foo/** OR mentions bar"
         add: [<pack>-<name>.md]
   ```

3. **Validate:**
   ```bash
   node contexts/tools/validate.mjs
   ```
   Should report "no errors" and confirm your skill file is found.

4. **Commit to your project repo** (so teammates get it on pull):
   ```bash
   git add .cursor/skills/<pack>-<name>.md contexts/config/pipeline.<pack>.skills.yaml
   git commit -m "skills: add <pack>-<name> (trigger: <when>)"
   ```

5. **Optional — promote to the pack** (so every new install ships with your skill):
   ```bash
   # Regenerate a monolithic view of your splits:
   npm run pipeline:merge

   # Open a PR against the release repo with:
   #   - your new skill file under packs/<pack>/skills/
   #   - your trigger entry added to packs/<pack>/pipeline.<pack>.yaml
   # Use the merged contexts/pipeline.<pack>.yaml as reference for the trigger wording.
   ```

   Once the pack PR is merged and you re-install, your skill is part of the pack's defaults.

### Recipe 2 — Update an EXISTING skill

Skills are just markdown — you usually don't need to touch YAML.

1. Edit the installed skill file:
   - Cursor: `.cursor/skills/<name>.md`
   - Claude Code: `.claude/skills/<name>/SKILL.md`
2. Save. Agents pick it up on next run. No install / validate / YAML step needed.
3. Commit so teammates get the update.
4. **Optional:** open a PR against the release repo with the updated `packs/<pack>/skills/<name>.md` to ship the improvement to all users.

**To change WHEN the skill is loaded** (e.g., broaden the trigger), see Recipe 5.

### Recipe 3 — Add a new RULE (always-on)

**What's a rule?** An `.mdc` file that's loaded by every agent on every run. Use sparingly — rules add tokens to every agent call.

1. Drop the rule file with frontmatter:

   **Cursor:** `.cursor/rules/<pack>-<name>.mdc`
   ```yaml
   ---
   description: <one-line summary>
   alwaysApply: true
   ---

   # <Rule Title>
   ...
   ```

   **Claude Code:** `.claude/rules/<pack>-<name>.md` — same content but rename `.mdc` → `.md` and remove the `alwaysApply:` line (Claude Code auto-loads everything in rules dir).

2. Save. All agents pick it up next run. No YAML wiring.

3. Commit to your project repo.

4. **Optional — promote to the pack:** open a PR adding the `.mdc` to `packs/<pack>/rules/`.

### Recipe 4 — Update an EXISTING rule

1. Edit `.cursor/rules/<name>.mdc` (or `.claude/rules/<name>.md`) directly.
2. Save. Commit. Done.

### Recipe 5 — Add or modify a TRIGGER

**What's a trigger?** A `when:` condition in `skills.extra_triggers[]` that tells Surgeon "when a task matches this condition, ALSO load these skills on top of the layer defaults."

**Common `when:` shapes** (free-form English, agents parse intent):

- `"task touches src/foo/**"` — file path match
- `"task involves X, Y, or Z"` — keyword match in task text
- `"file ends with DAO/Repository"` — filename pattern
- `"task ID starts with T-TC"` — task ID convention
- `"Layer = Backend/Java AND file path contains /rest/"` — combined condition

**To add a trigger:**

1. Edit `contexts/config/pipeline.<pack>.skills.yaml`:
   ```yaml
   skills:
     extra_triggers:
       # ... existing entries ...
       - when: "task touches <path-pattern>"
         add: [<pack>-<skill-name>.md]
   ```
   The skill file must exist at `.cursor/skills/<pack>-<skill-name>.md` (see Recipe 1).

2. Validate:
   ```bash
   node contexts/tools/validate.mjs
   ```

3. Commit to project repo.

4. Optional — open pack PR with the same entry added to `packs/<pack>/pipeline.<pack>.yaml`.

**To modify an existing trigger:** edit the `when:` string to broaden/narrow, or append more skills to `add: [...]`.

**To remove a trigger:** delete the whole `- when: ... add: [...]` block.

### Recipe 6 — Change which skill an AGENT uses (per-agent skill)

Per-agent skills (Orchestrator's ticket-schema, LLD generator, AC templates; Explorer's bug-localization) are pointed to by filename in `pipeline.<pack>.skills.yaml`:

```yaml
skills:
  orchestrator:
    ticket_schema_story: iiq-ticket-schema-story.md      # swap to a different filename to change
    lld_generator: iiq-lld-generator.md
    ac_templates_intent_aware: iiq-ac-templates-intent-aware.md
  explorer:
    bug_router: iiq-bug-localization.md
    bug_frontend: iiq-bug-localization-frontend.md
    bug_backend: iiq-bug-localization-backend.md
```

1. Point the key to a different filename.
2. Make sure the skill exists at `.cursor/skills/<new-name>.md` (or `.claude/skills/<new-name>/SKILL.md`).
3. Validate + commit.

---

## Worked example: adding "security for auth-sensitive code"

Scenario: every time Surgeon writes code that touches auth or password handling, apply stricter patterns (parameterized queries, audit logging, right checks).

Decide: do you want this **always** (rule) or **only when touching sensitive code** (skill + trigger)? Most teams want both — rule for non-negotiables, skill for detailed patterns.

### Step 1 — Create the always-on rule

Drop `.cursor/rules/iiq-security-standards.mdc` (Cursor) or `.claude/rules/iiq-security-standards.md` (Claude Code):

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

No YAML wiring — rules auto-load.

### Step 2 — Create 3 conditional skills

Drop these in `.cursor/skills/` (or appropriate Claude Code layout):

```
iiq-security-auth.md           (SPRight patterns, login/session rules)
iiq-security-persistence.md    (parameterized HQL/SQL, DAO return boundary)
iiq-security-secrets.md        (hashing, encryption, log redaction)
```

Use existing skills as templates (e.g. `.cursor/skills/iiq-java-standards.md`).

### Step 3 — Wire 3 triggers in `contexts/config/pipeline.iiq.skills.yaml`

```yaml
skills:
  extra_triggers:
    # ... existing triggers (accessibility, ExtJS, test tasks) ...

    - when: "task touches src/sailpoint/web/rest/auth/** OR references SPRight constants"
      add: [iiq-security-auth.md]

    - when: "task touches src/sailpoint/persistence/** OR file ends with DAO/Repository/Mapper"
      add: [iiq-security-persistence.md]

    - when: "task involves password, credential, token, apiKey, secret, sessionId, or bearer handling"
      add: [iiq-security-secrets.md]
```

### Step 4 — Validate

```bash
node contexts/tools/validate.mjs
```

Should report "no errors." The 3 triggers and 3 skill references are validated.

### Step 5 — Commit to your project repo

```bash
git add .cursor/rules/iiq-security-standards.mdc \
        .cursor/skills/iiq-security-{auth,persistence,secrets}.md \
        contexts/config/pipeline.iiq.skills.yaml
git commit -m "security: add baseline rule + conditional auth/persistence/secrets skills"
git push
```

Teammates pull → they have the same security standards. Agents pick them up automatically.

### Step 6 (optional) — Promote to the pack

Only if this should ship as a pack default for all future projects (not just yours):

```bash
npm run pipeline:merge    # regenerates contexts/pipeline.iiq.yaml (throwaway unified view)
```

Open a PR against the release repo:
- Copy the rule to `packs/<pack>/rules/`
- Copy the 3 skills to `packs/<pack>/skills/`
- Add the 3 trigger entries to `packs/<pack>/pipeline.<pack>.yaml`

Tech lead reviews + merges. Next pack release ships these to everyone.

### Token cost

- Routine frontend task: +1.5K (rule only)
- Task touching `src/sailpoint/persistence/`: +1.5K (rule) + 2.5K (persistence skill) = ~4K
- Task touching auth + persistence + secret handling: ~7-9K extra

---

## Quick reference — where to edit what

| I want to… | File to edit |
|---|---|
| Change branch prefix / base branch | `contexts/config/pipeline.<pack>.yaml` → `runtime.branching` |
| Change JIRA project key or status map | `contexts/config/pipeline.<pack>.yaml` → `jira` |
| Add or update an MCP server | `contexts/config/pipeline.<pack>.yaml` → `mcp_servers` |
| Add/update a layer skill mapping | `contexts/config/pipeline.<pack>.skills.yaml` → `skills.layer_map` |
| Add/update a conditional trigger | `contexts/config/pipeline.<pack>.skills.yaml` → `skills.extra_triggers` |
| Change Orchestrator's ticket schema / LLD generator | `contexts/config/pipeline.<pack>.skills.yaml` → `skills.orchestrator` |
| Add/update a build command | `contexts/config/pipeline.<pack>.builds.yaml` → `builds.commands` |
| Forbid destructive ant targets / git commands | `contexts/config/pipeline.<pack>.builds.yaml` → `builds.forbidden` |
| Change i18n rules | `contexts/config/pipeline.<pack>.builds.yaml` → `i18n` |
| Update scan exclusions | `contexts/config/pipeline.<pack>.analyzer.yaml` → `scan_exclusions` |
| Change demo base URL / credentials / E2E framework | `contexts/config/pipeline.<pack>.e2e.test.yaml` → `demo` |
| Add an always-on rule | NEW `.mdc` file in `.cursor/rules/` (no YAML wiring) |
| Add a task-triggered skill | NEW `.md` in `.cursor/skills/` + trigger entry in `contexts/config/pipeline.<pack>.skills.yaml` |

---

## Commands you'll use

```bash
# Validate your edits — run after any YAML change
node contexts/tools/validate.mjs

# Regenerate a unified view of all 5 splits (for PR diff review or pack-promotion prep)
npm run pipeline:merge             # → contexts/pipeline.<pack>.yaml (throwaway, delete after)

# Re-split from a unified seed (rare — use if someone updated the monolithic file and you want its contents)
npm run pipeline:split --force     # ⚠ overwrites your local splits — see "Don't do" below
```

---

## Don't do

- **Don't run `npm run install-pipeline -- --force-config` if you have local edits** in `contexts/config/*.yaml` that aren't yet in the pack. Force-install re-splits from the pack seed and overwrites your trigger / skill-mapping additions (backed up to `.bak.<timestamp>` files, but still disruptive). Either:
  - Don't use `--force-config` until the pack PR with your changes lands, OR
  - Commit your splits first and verify the pack ships them after your PR merges, THEN run `--force-config`.
- **Don't commit files under `.cursor/` or `.claude/` that conflict with pack defaults.** If you add a skill with the exact same filename as one the pack ships, a re-install will back up yours. Use unique names.
- **Don't add rules (`.mdc`) for task-specific concerns.** Rules load every agent call — even frontend-only tasks will pay the cost. If it only matters for specific code paths, add a skill + trigger instead.
- **Don't forget to validate.** A malformed `when:` or a skill file typo can break Surgeon silently. Always run `node contexts/tools/validate.mjs` after a YAML change.

---

## Running without MCP (offline / selective / privacy)

By default, Orchestrator probes configured MCP servers (Atlassian for JIRA, Figma for designs, GitHub for reference PRs) and fetches content from them. You can skip any or all of these per-run — useful when:

- You want to **save tokens** (no MCP data fetches — JIRA tickets with Confluence HLDs and 3 Figma frames can add 25-50K to a first-story run)
- You're **offline** or the MCP is temporarily unavailable
- The ticket has **sensitive content** you don't want going through MCP (privacy / policy)
- You already have a **local copy** of the requirement summary and designs
- Your org hasn't enabled the MCP yet and you want to try the pipeline anyway

### Trigger flags — per-run override

Add flags to your trigger line. No config change needed; the override applies only to that run.

| Trigger | Behavior |
|---|---|
| `@orchestrator.md Work on IIQPROJ-1245` | Default — probe + use all configured MCPs |
| `@orchestrator.md Work on IIQPROJ-1245 --offline` | Skip ALL MCPs (atlassian + figma + github) |
| `@orchestrator.md Work on IIQPROJ-1245 --skip atlassian` | Skip Atlassian only (still use Figma + GitHub) |
| `@orchestrator.md Work on IIQPROJ-1245 --skip atlassian,figma` | Skip Atlassian AND Figma |
| `@orchestrator.md Work on IIQPROJ-1245 --only github` | Use ONLY GitHub; skip Atlassian + Figma |

### What to provide instead

When you skip an MCP, Orchestrator falls back to local content. Provide it in one of these ways:

**Instead of Atlassian** — ticket data:

Option A — **pre-flight file** (recommended for full tickets):
```bash
# The installer already created contexts/ticket-input.md for you. Edit it directly:
vim contexts/ticket-input.md

# Fill in: title, ticket summary, ACs, in/out of scope, epic, dependencies.
# Then run:
@orchestrator.md Work on IIQPROJ-1245 --skip atlassian
```

Option B — **inline Context** (quick, for small tickets):
```
@orchestrator.md Work on IIQPROJ-1245 --skip atlassian Context:
Title: Add entitlement filter to user certification page
ACs:
  - AC1: Given a user on cert list, when they click "Filter", then entitlement dropdown appears
  - AC2: Given filter selected, when they click "Apply", then list filters to matching entitlements
In scope: UI filter only (backend endpoint already exists)
Out of scope: Mobile UI
```

**Instead of Figma** — designs:

Attach images directly to the trigger message (Cursor + Claude Code both support drag-drop). Orchestrator uses trigger attachments first; Figma MCP is only consulted if no attachments are present. You can also paste image URLs/paths in the `Context:` block.

**Instead of GitHub** — reference patterns / cross-repo search:

GitHub is rarely needed. When skipped, Orchestrator uses local `git log` for history. If you explicitly want a reference ticket's pattern, paste its LLD path in Context:
```
Work on IIQPROJ-1245 --skip github — reference: IIQPROJ-1001
# Orchestrator reads contexts/<epic>/IIQPROJ-1001.md locally — no GitHub call
```

### Token savings

Typical savings per story with `--offline`:

| Scenario | Default (all MCPs) | `--offline` | Saved |
|---|---:|---:|---:|
| Simple ticket (no Figma, no Confluence HLD) | +3-5K MCP overhead | 0 | ~3-5K |
| Ticket with Confluence HLD (first story of epic) | +15-25K MCP | 0 | ~15-25K |
| Ticket with 3 Figma frames | +15-25K MCP | 0 (use attachments) | ~15-25K |
| First story + Confluence + Figma | +30-50K MCP | ~2-5K (inline content) | ~25-45K |

### Combining skip + inline

You can combine multiple flags AND provide inline content:

```
@orchestrator.md Work on IIQPROJ-1245 --skip atlassian,figma Context:
[paste ticket summary]
[reference images attached]
```

Orchestrator will:
- Skip Atlassian + Figma probes (save their auth round-trip)
- Read `contexts/ticket-input.md` if it exists (otherwise use inline Context)
- Use trigger-attached images for Visual Specification
- Still use GitHub MCP if configured (not skipped)

### What Orchestrator shows you

The Active Context block reports which MCPs were used vs skipped:

```
┌─ Active Context — Orchestrator ────────────────────────┐
│ ...                                                    │
│ MCPs:   atlassian skipped (user --skip) · github ✓ ·   │
│         figma skipped (user --skip)                    │
│ ...                                                    │
└────────────────────────────────────────────────────────┘
```

And if you didn't skip any: the block shows a one-line tip (`tip: --skip <name> or --offline to save tokens`) so you're always aware the option exists.

### What happens when an MCP fails at runtime (no skip flag used)

If you run the default `@orchestrator.md Work on PROJ-1234` (no skip flag) and a configured MCP fails to connect mid-run (token expired, server down, OAuth prompt dismissed), Orchestrator **prompts you to provide a fallback** — it doesn't just fail or silently skip.

The prompt depends on which MCP failed and whether the ticket actually needs content from it:

**Atlassian fails (and no `ticket-input.md` / no inline Context: exists):**

```
⚠ Atlassian MCP failed to connect — <error>

JIRA ticket content for PROJ-1234 can't be fetched automatically. Pick one:

  1. `retry`    — Try again after fixing the MCP config / re-auth
  2. `inline`   — Reply with "Context:" + ticket summary + ACs
  3. `file`     — Fill contexts/ticket-input.md, reply `continue`
  4. `skip`     — Proceed with whatever local content exists
  5. `cancel`   — Exit; re-trigger later

> 👉 Pick one:
```

**Figma fails (only if the ticket has Figma URLs and no images are attached yet):**

```
⚠ Figma MCP failed to connect — <error>

2 Figma URL(s) in ticket can't be fetched:
  - https://figma.com/file/abc/123?node-id=1-2
  - https://figma.com/file/abc/123?node-id=4-5

Pick one:

  1. `retry`
  2. `upload`   — Drag the design image(s) into this chat, reply `continue`
  3. `skip`     — Continue with URL-only Visual Spec (weaker)
  4. `cancel`

> 👉 Pick one:
```

**GitHub fails:** rarely blocks. Orchestrator notes it in Cross-Reference Findings and continues without the optional PR diff enrichment — no gate.

### When the gate does NOT fire

The fallback gate only appears when a probed MCP **actually fails AND the ticket needs its content**. Cases where the orchestrator silently proceeds:

| Scenario | Behavior |
|---|---|
| You used `--skip atlassian` explicitly | No gate — you already said you'd provide content via `ticket-input.md` or `Context:` |
| Figma MCP fails but the ticket has NO Figma URLs | Silent — nothing to fetch |
| Figma MCP fails but you already attached images to the trigger | Silent — attached images are used; no need for Figma |
| GitHub fails and no reference ticket is declared | Silent — nothing to fetch |
| Atlassian fails but `ticket-input.md` is already filled | Silent — uses the local file |
| MCP marked `required: false` in pipeline config (like Figma) + ticket doesn't strictly need it | Single-line note in Active Context, no gate |

### What this means for you in practice

- **Happy path:** MCPs work, you never see a gate. Agents just run.
- **MCP flake (e.g. token expired mid-morning):** Orchestrator prompts you with specific options. Upload the image or paste the content, and it continues. You don't have to re-trigger.
- **Full outage:** use `--offline` or `--skip <name>` from the start — cleaner than letting each MCP fail in turn.
- **Sensitive ticket you don't want MCP-fetched:** use `--skip atlassian` upfront rather than relying on the gate.

### Gotchas

- **`--offline` requires you to provide ticket content.** If you run `--offline` with no inline `Context:` and no `contexts/ticket-input.md`, Orchestrator halts with a clear error.
- **GitHub skip rarely matters.** Most stories don't use GitHub MCP — it mainly serves reference-ticket PR diffs (feature rarely used) and cross-repo search. Skip it freely.
- **`--skip` vs removing the MCP from config.** `--skip` is per-run; removing from `mcp_servers` in the config is permanent. Use `--skip` for occasional offline work, edit config only if the MCP is fundamentally unavailable in your environment.
- **Image attachments cap at 3** regardless of flags — same as default behavior.

---

## Need more?

- **Full install flow, agent triggers, end-to-end walkthrough:** see `HOW-TO-USE.md` at the project root (or the release repo).
- **Per-agent behavior details:** `.cursor/agents/*.md` (or `.claude/agents/*.md`) — every agent has its own prompt with Active Context block and rules.
- **Validator source:** `contexts/tools/validate.mjs` — see what it checks.
