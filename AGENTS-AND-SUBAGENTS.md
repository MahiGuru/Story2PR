# Agents, Subagents, Rules & Skills — how each is triggered

The pipeline is built from **four kinds of building block**, and each is triggered by a *different* mechanism. Knowing which is which is the key to understanding the whole system.

| Block | Triggered by | When it fires | Defined in |
|-------|-------------|---------------|-----------|
| **Agent** | **You** — a trigger you type | When your input matches a trigger phrase | `agent-pipeline/agents/*.md` (+ `bundle/`) |
| **Subagent** | **A parent agent** — automatically | At a specific step inside an agent | `agent-pipeline/agents/subagent-*.md` |
| **Rule** | **The host** — automatically | **Every** run, always injected | `agent-pipeline/rules/*.mdc` |
| **Skill** | **The agent** — on demand | Only when a task/agent needs it | `packs/<pack>/skills/*.md` (wired in YAML) |

> **The mental model:** **Rules** always apply · **Skills** load on demand · **Subagents** are invoked · **Agents** are what *you* run.

---

## 1. AGENTS — triggered by you

Agents are loaded because an **always-on rule** tells the model to load them.

1. **The rule is always present.** `agent-flow.mdc` (single-story + setup) and `bulk-agent-flow.mdc` (bundle) have `alwaysApply: true`, so the host injects them into **every** conversation.
2. **Your input matches a trigger phrase** listed in the rule's `description:`.
3. **The rule executes the agent:** (1) load the matching `.md` fully → (2) execute with real tool calls → (3) never just describe it.
4. **Auto-start** picks the first agent: `Work on {TICKET}` → orchestrator; `Work on epic stories …` → bundle-orchestrator.

```
You type:  Work on story PROJ-1234
  → agent-flow.mdc already loaded (alwaysApply) → "Work on story" fires
  → Auto-start → load orchestrator.md fully + EXECUTE → runs to the Phase C gate
```

`@orchestrator.md Work on PROJ-1234` ≡ plain `Work on PROJ-1234`. In **Cursor** use `@` (more reliable); **Claude Code** handles plain triggers and discovers agents recursively by `name:` frontmatter (so `agents/bundle/` works).

| Agent | Trigger(s) |
|-------|-----------|
| **project-analyzer** | `Analyze project` · `Rescan <stack>` |
| **orchestrator** | `Work on <TICKET>` (auto-start) |
| **explorer** | `Run the explorer` |
| **surgeon** | `Run the surgeon` |
| **ac-e2e-check** | `Demo <TICKET>` · `Verify: <scenario>` |
| **review** | `Run the review` (`--slim` optional) |
| **ship** | `Ship it` · `raise PR` · `push it` |
| **bundle-orchestrator** | `Work on epic stories <IDs>` · `Work on epic <ID> with status=…` |
| **bundle-explorer / surgeon / review / ship** | `Run the bundle explorer` · `…surgeon` · `…review` · `Ship the bundle` |

---

## 2. SUBAGENTS — triggered by a parent agent

Subagents are **invoked by an agent** via the Task tool at a specific step — you never type them. Their value is **context isolation**: heavy data stays in the subagent's context, only a small result crosses back. The kernel ships **two**:

| Subagent | Fired by · step | Fires when | Returns |
|----------|-----------------|------------|---------|
| **image-analysis** | Orchestrator · `resolve_enrichments (A0.6)` | ≥2 images present | compact `visual_spec` (~3K) |
| **amender** | Orchestrator · `gate_for_approval (C)` | you type `Amend: <change>` | status after targeted LLD edits |

**Contract:** input passed as one YAML block, output is one YAML block (`status: ok|error|partial`), never gates the user, caches external fetches. A pack can wire more at extension points (`surgeon_pre_task`, `surgeon_post_task`, `review_post_check`) via `subagents:` in `pipeline.<pack>.yaml`.

---

## 3. RULES — triggered automatically, every run (Tier 1)

A rule is a `.mdc` file with **`alwaysApply: true`** in its frontmatter. The host (Cursor / Claude Code) **injects it into every agent run's context automatically** — no command, no loading, no choice. That is the entire trigger mechanism: *always on.*

### The rule files
| Rule | Enforces |
|------|----------|
| `agent-flow.mdc` | Single-story routing, path resolution, all harness mechanics (pressure, build reports, tool ledger) |
| `bulk-agent-flow.mdc` | Bundle triggers, dispatch, disambiguation, JIRA bulk labels |
| `engineering-principles.mdc` | SOLID / KISS / DRY / YAGNI + greenfield-vs-legacy mode (applied per Surgeon task) |
| `<pack>-*.mdc` | Pack-specific scope + naming/postverify rules |

### "Always on" ≠ "always acts" — when each rule *bites*
The rules are loaded every run; the column below is *where they matter*:

| Rule | Bites when |
|------|-----------|
| **Pre-flight pattern** | Before every agent starts — verifies branch + inputs exist |
| **No hallucinated paths** | Any time a path is referenced — `ls`-verify first |
| **Error escalation** | On any error — try 3–5 fixes → present options → never skip silently |
| **Build safety** | Before any build command — `builds.forbidden` denylist (`git push --force*`, `rm -rf*`, deploys, DB drops) |
| **Branch safety** | All work — never commit to `base_branch` |
| **Git ownership** | Commit/push — only **Ship** runs `git add/commit/push` |
| **Parallel tool calls** | Any step with independent reads — batch into one turn (cache saver) |
| **Context pressure** | Continuously; surfaced at every gate (GREEN/YELLOW/ORANGE/RED zones) |
| **Token-usage tracking** | End of every run — append a block to the ledger |

`engineering-principles.mdc` is loaded every run but *applies* to every task that writes code — the mode (greenfield vs legacy) is chosen per task from its LLD status.

---

## 4. SKILLS — triggered on demand (Tier 2)

A skill is a `.md` reference file **catted into an agent's context only when triggered** — declared in `pipeline.<pack>.skills.yaml`. This is why a pack can ship many layer-standard skills without bloating every run. Skills load **two ways**:

### A. Per-run (once, at agent startup — no trigger)
Loaded unconditionally because they apply to the whole run:

| Skill slot | Loads in · step |
|------------|-----------------|
| `orchestrator.lld_generator` | Orchestrator `load_context (A0)` |
| `orchestrator.ticket_schema_story` | Orchestrator (parse the ticket) |
| `orchestrator.ac_templates_intent_aware` | Orchestrator (AC generation) |

### B. Per-task (only when a task matches)
The **Surgeon** resolves skills for **each task** at `load_coding_standards (0b)` — two match strategies, union taken:

| Strategy | Matches on | Example |
|----------|-----------|---------|
| **A — path_glob** | the task's files vs each `layer_map` entry's `path_glob` | a task touching `frontend/src/**/*.ts` → loads the Angular/React standards |
| **B — layer string** | `task.Layer` vs the entry's key + `aliases` | `task.Layer = "React"` → loads React standards |

`extra_triggers` fire additively on top (e.g. add a11y or security standards when a natural-language condition matches). The previous task's skill is released before the next loads. **Review** also loads per-layer standards in default mode (skipped in `--slim`).

```
Surgeon working task T3 (Files: PreferenceResource.java, Layer: Backend/Java)
  → load_coding_standards (0b): path_glob + layer match → cat in java-standards.md
  → implement T3 with those standards → release → move to T4 (loads T4's skills)
```

---

## 5. Three kinds of input — don't confuse them

At the keyboard, what you type is one of three things. Only the first launches an agent.

| You type… | What it is | Example |
|-----------|-----------|---------|
| A **trigger** | Launches an **agent** | `@orchestrator.md Work on PROJ-1234` · `Run the surgeon` |
| A **gate reply** | Answers the current agent's stop (no `@`) | `Go` · `Amend: …` · `Fix all P1` · `Confirmed` |
| *(nothing — auto)* | A **subagent** fires, or a **rule**/**skill** loads | image-analysis at A0.6 · a layer skill on a matching task |

`Amend: <change>` is a *gate reply* that *causes* the amender **subagent** to fire — you answer the Phase C gate, the Orchestrator delegates the edit.

---

## 6. How the pipeline (config) ties it all together

The four blocks don't wire themselves — **`contexts/config/pipeline.<pack>.yaml` is the trigger map** that connects them. It's the reason the same project-neutral agents work on any stack.

| Config key | Wires… | Used at |
|------------|--------|---------|
| `meta.pack` | **which pack** (resolves `{PACK}` once at pre-flight) | every agent's pre-flight |
| `skills.layer_map` | **task → skill** (path_glob + layer + build + aliases) | Surgeon per task |
| `skills.orchestrator.*` | **per-run skills** (lld_generator, ticket schema, AC templates) | Orchestrator startup |
| `subagents.*` | **extension point → subagent** (which hook fires which subagent) | parent agents |
| `mcp_roles` | **role → MCP** (`story_source`, `design_source`, `vcs`, `docs_source`) — agents never hardcode a tool | any agent that fetches |
| `builds.commands` / `builds.forbidden` | **layer → build command** + the safety denylist | Surgeon, Review, build-safety rule |
| `jira.*` / `runtime.branching` | project key, transitions, branch prefixes | Orchestrator, Ship |

**How the pipeline helps, concretely:**
- **Install splits it into 5 files** so each agent loads only its slice (~10K saved/agent). `validate.mjs` merges + checks every reference.
- **`project-analyzer` auto-fills most of it** — scans the repo and writes `shared_paths`, `component_naming`, `operation_patterns`, `layer_map` additions, `i18n`. You set only a handful of keys (`base_branch`, `jira.project_key`, `builds.commands`).
- **Change one line, not seven prompts** — swap GitHub→GitLab (`mcp_roles.vcs`), add a framework's standards (`layer_map`), or add a subagent (`subagents:`) by editing config; the agents pick it up on the next run.

---

## 7. Source of truth

- **Single-story + setup triggers** → `agent-pipeline/rules/agent-flow.mdc`
- **Bundle triggers** → `agent-pipeline/rules/bulk-agent-flow.mdc`
- **Subagent fire points** → inside the parent agent prompts + the invocation contract in `agent-flow.mdc`
- **Rules** → `agent-pipeline/rules/*.mdc` (`alwaysApply: true`)
- **Skill wiring** → `contexts/config/pipeline.<pack>.skills.yaml`
- **Everything wired together** → `contexts/config/pipeline.<pack>.yaml` (+ its split siblings)
