# Starter Project Pack

This pack is a **didactic template**. It shows how to wire up rules, skills,
and a `pipeline.<pack>.yaml` so the agent pipeline kernel knows when to
load each piece. Copy it, rename to `packs/<your-project>/`, and edit the
placeholders.

> Looking for a full production-scale example? The IIQ pack
> (`packs/iiq/`, kept locally — not shipped publicly via this repo) is the
> reference implementation this template is derived from.

## What's the trigger model?

The agent pipeline is built on **just-in-time loading**. Every rule and
every skill is declared once in `pipeline.starter.yaml`, then loaded into
an agent's context **only when something triggers it**.

There are three trigger models in play, in order of precedence:

| Mechanism | Where declared | When it fires |
|-----------|----------------|---------------|
| **Tier 1 rule (`alwaysApply: true`)** | `rules/*.mdc` frontmatter | Every agent run, every time |
| **Tier 1 rule (`globs:`)** | `rules/*.mdc` frontmatter | Files matching glob are touched |
| **Tier 2 skill (`layer_map`)** | `pipeline.starter.yaml` `skills.layer_map` | Surgeon Step 0a — task `Layer:` field or file path matches |
| **Tier 2 skill (`extra_triggers`)** | `pipeline.starter.yaml` `skills.extra_triggers` | When a layered orthogonal condition is met (e.g., a11y) |
| **Per-agent skill** | `pipeline.starter.yaml` `skills.orchestrator.*` / `skills.explorer.*` | Once per agent invocation, regardless of task |

**Skills cost tokens.** Loading every standards skill on every task would
cost ~60K tokens before the agent even starts. The `layer_map` is how
you ship 10 skills but only pay for the 1 or 2 a given task needs.

## What's in this pack

### `rules/` — Tier 1 rules (loaded on every agent run)

| File | Purpose |
|------|---------|
| `starter-project-scope.mdc` | Repo boundary, tech stack, allowed/forbidden build commands, ticket prefix |
| `starter-naming-conventions.mdc` | Universal naming rules — files, identifiers, classes |

These two files merge into your project's `.cursor/rules/` (Cursor) or
`.claude/rules/` (Claude Code) at install time. **They have `alwaysApply:
true`**, so every agent run loads them.

### `skills/` — Tier 2 skills (loaded only on trigger)

| File | Layer key | Loaded when |
|------|-----------|-------------|
| `starter-angular18-standards.md` | `Frontend/Angular18` | Task touches `frontend/src/**/*.{ts,html}` OR `task.Layer = "Angular18"` |
| `starter-angular19-standards.md` | `Frontend/Angular19` | Task touches `frontend/src/**/*.{ts,html}` OR `task.Layer = "Angular19"` |
| `starter-react-standards.md` | `Frontend/React` | Task touches `src/**/*.{tsx,jsx}` OR `task.Layer = "React"` |
| `starter-vue3-standards.md` | `Frontend/Vue` | Task touches `src/**/*.vue` OR `task.Layer = "Vue3"` |
| `starter-javascript-standards.md` | `JavaScript` | Task touches `**/*.js` OR `task.Layer = "JavaScript"` |
| `starter-typescript-standards.md` | `TypeScript` | Task touches `**/*.ts` OR `task.Layer = "TypeScript"` (also layered into React/Vue) |
| `starter-java-standards.md` | `Backend/Java` | Task touches `backend/src/main/java/**/*.java` OR `task.Layer = "Java"` |

**A task only ever loads 1–3 of these**, never all 7. That's the whole
point of the trigger model.

### `pipeline.starter.yaml` — the trigger map

This file is what makes everything click together. Open it and read the
comments — they walk through each section. The two key blocks are:

- **`skills.layer_map`** — names every standards skill, gives it a path
  glob and a list of human-friendly aliases for the `Layer:` field.
- **`skills.extra_triggers`** — orthogonal triggers that layer ADDITIONAL
  skills onto whatever `layer_map` resolved (e.g., always add the JS
  baseline when a React task is also touching plain `.js` files).

### `project-context.starter.md` — standing project context

Prose-only file loaded by Orchestrator on every ticket. Holds team
boundaries, active migrations, reference implementations, and
constraints — the kind of knowledge that doesn't fit in a standards
skill or rule.

## How to add a new standards skill

Say you want to add a Python standards skill for a new microservice:

1. **Write the skill** at `packs/starter/skills/starter-python-standards.md`.
   Structure: frontmatter (`name`, `description`), then one Markdown
   document. Look at any of the 7 existing skills as a template.

2. **Wire it in `pipeline.starter.yaml`** under `skills.layer_map`:

   ```yaml
   "Backend/Python":
     skills: [starter-python-standards.md]
     path_glob: "services/python/**/*.py"
     build: python_test
     desc: "Python 3.11+ — type hints, async, pytest"
     aliases: ["Python", "Backend Python", "FastAPI", "Django"]
   ```

3. **Add the build command** under `builds.commands`:

   ```yaml
   python_test:
     cmd: "cd services/python && pytest -x"
     desc: "Run Python tests, fail fast"
   ```

4. **Re-install the pack** so the runtime YAMLs get regenerated:

   ```bash
   npm run install-pipeline -- --pack starter --merge-config
   ```

That's the entire flow. The skill will only be loaded when a task touches
`services/python/**` OR sets `Layer: Python` — never wasted on unrelated
tasks.

## How to add a new rule

Rules in this pack are **always** Tier 1 (`alwaysApply: true`). They're
the framework's universal guardrails, not per-task guidance.

1. **Write the rule** at `packs/starter/rules/starter-<topic>.mdc` with
   the frontmatter:

   ```yaml
   ---
   description: One sentence — what this rule enforces and why.
   alwaysApply: true
   globs:                # optional — narrows applicability to certain files
     - "**/*.ts"
   ---
   ```

2. **Re-install the pack** — rules merge into `.cursor/rules/` (or
   `.claude/rules/`) at install time.

No YAML wiring needed. Rules are discovered by directory scan, not by
declaration. (Skills are declared in YAML because their loading is
conditional; rules are not.)

## What does project-analyzer / rescan author?

The `project-analyzer` agent does the **first scan** of your repo and
writes some YAML blocks back into `pipeline.starter.yaml` (or the runtime
splits). Specifically:

| Block | Owner | Hand-edit? |
|-------|-------|-----------|
| `meta`, `skills.layer_map`, `skills.extra_triggers` | **Pack author (you)** | Yes — these encode your project's intent |
| `skills.orchestrator.*`, `skills.explorer.*` | Pack author | Yes |
| `builds.commands`, `builds.forbidden`, `builds.lint`, `builds.review_gate` | Pack author | Yes |
| `runtime.*`, `jira.*`, `mcp_*` | Pack author | Yes |
| `shared_paths`, `component_naming` | **project-analyzer (auto)** | No — re-running rescan overwrites |
| `analyzer_ignore` | project-analyzer (auto) | OK to add manually too |
| `operation_patterns`, `i18n` (if used) | project-analyzer (auto) | No |

**Rule of thumb:** anything that documents **what the project IS** — its
file paths, conventions, build commands — is yours to author. Anything
that's **discovered from the repo's current state** is the analyzer's
job.

If you want to override an analyzer-authored entry permanently, add
`provides_overridden: true` to that entry — the next rescan will preserve it.

## Install

After editing this pack for your project:

```bash
# Cursor
npm run install-pipeline -- --pack starter --project-root /path/to/your/project

# Claude Code
npm run install-pipeline:claude -- --pack starter --project-root /path/to/your/project
```

The installer:
- Copies `rules/` into the host's `.cursor/rules/` or `.claude/rules/`
- Copies `skills/` into the host's `.cursor/skills/` or `.claude/skills/`
- Splits `pipeline.starter.yaml` into runtime sibling YAMLs under
  `contexts/config/`
- Copies `project-context.starter.md` to `contexts/project-context.md`

After install, **run the analyzer** to populate `shared_paths` and friends:

```
@project-analyzer.md Analyze project
```

## Conventions for pack authors

Lifted from the IIQ pack — they apply equally to this template.

**Convention 1 — canonical layers at LLD generation time**

The `Layer:` field of every task should be one of the canonical keys in
`skills.layer_map`. Aliases are a safety net for human variance, NOT a
schema mechanism. Tell your LLD generator (custom or kernel default) to
constrain `Layer:` to the canonical list at generation time.

**Convention 2 — aliases document human variance, not schema growth**

When someone writes "ng18" instead of "Angular18", add `"ng18"` to that
entry's `aliases:` list. Do NOT add a new `layer_map` entry — duplicate
entries pointing at the same skill set is a duplication bug.

**Convention 3 — every concrete layer declares a `path_glob`**

Strategy A (file-path resolution) is the primary trigger. A layer without
`path_glob` can only be reached via Strategy B (Layer-string lookup), so
it won't compose into full-stack tasks automatically. Only `Test` (which
applies anywhere by file naming) should legitimately omit `path_glob`.

**Convention 4 — alias lists are short**

3–5 aliases per entry covers ~95% of phrasing variance. Past 8 entries,
either the canonical name is wrong (rename) or the layer is trying to be
two things (split).

---

## File map

```
packs/starter/
├── README.md                        ← this file
├── pipeline.starter.yaml            ← THE TRIGGER MAP (heart of the pack)
├── project-context.starter.md       ← prose context, loaded every run
├── rules/
│   ├── starter-project-scope.mdc        ← Tier 1, alwaysApply
│   └── starter-naming-conventions.mdc   ← Tier 1, alwaysApply
└── skills/
    ├── starter-angular18-standards.md   ← Tier 2, on Layer trigger
    ├── starter-angular19-standards.md   ← Tier 2, on Layer trigger
    ├── starter-react-standards.md       ← Tier 2, on Layer trigger
    ├── starter-vue3-standards.md        ← Tier 2, on Layer trigger
    ├── starter-javascript-standards.md  ← Tier 2, on Layer trigger
    ├── starter-typescript-standards.md  ← Tier 2, on Layer trigger
    └── starter-java-standards.md        ← Tier 2, on Layer trigger
```
