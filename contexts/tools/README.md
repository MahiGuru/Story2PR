# `tools/`

Pipeline tooling — all Node.js, zero runtime deps at the project side.

| File | Purpose |
|------|---------|
| `validate.mjs` | Validator (10 checks) + catalog emitter. Discovers skills/agents in both `.cursor/` and `.claude/` layouts. |
| `mcp-sample-generator.mjs` | Writes `mcp.sample.json` + `mcp.sample.README.md` from `pipeline.yaml` (per-host path tables included) |
| `install.mjs` | Installer. `--target cursor` (default) writes `.cursor/` with `.mdc` rules + flat skills; `--target claude` writes `.claude/` with `.md` rules + dir-per-skill `SKILL.md` files. |
| `help.mjs` | Prints the available commands (`node contexts/tools/help.mjs`, or `npm run help` from the release dir) |
| `vendor/js-yaml.mjs` | Vendored single-file ESM build of js-yaml 4.1.x (MIT, see `vendor/LICENSE-js-yaml`). This is why tools work without `npm install` at the project side. |

Tools import `js-yaml` from `./vendor/js-yaml.mjs` rather than npm, so **you do not need a `package.json` or `node_modules/` in your project** to run them. Everything works with plain `node`.

---

## Validator (`validate.mjs`)

Runs 10 checks against `pipeline.yaml` and regenerates the Layer Map Catalog on demand. Run from your project root:

| Command | What it does |
|---------|-------------|
| `node contexts/tools/validate.mjs` | Run 10 checks, print report |
| `node contexts/tools/validate.mjs --quiet` | CI mode (silent on success) |
| `node contexts/tools/validate.mjs --update-catalog` | Run checks + write `_catalog.md` |
| `node contexts/tools/validate.mjs --emit-catalog` | Print catalog to stdout without writing |
| `node contexts/tools/validate.mjs --config <path>` | Validate a specific config file |
| `node contexts/tools/validate.mjs --repo-root <path>` | Override repo root |

Exit codes: 0 = pass, 1 = errors, 2 = env problem.

---

## MCP sample generator (`mcp-sample-generator.mjs`)

Reads `mcp_servers:` from `pipeline.yaml` and writes two files to `contexts/config/`:

| File | Purpose |
|------|---------|
| `mcp.sample.json` | Reference JSON with placeholder tokens. Developers copy entries into their own MCP config. |
| `mcp.sample.README.md` | Setup instructions — where to put the entries (per-host path table), what tokens to get, per-server notes. |

The pipeline does **NOT** write to Cursor's or Claude Code's personal MCP config files. Each developer owns their personal MCP config. The sample is a committed reference; each developer copies from it.

| Command | What it does |
|---------|-------------|
| `node contexts/tools/mcp-sample-generator.mjs --project-root .` | Regenerate `mcp.sample.json` + `mcp.sample.README.md` |

Auth-aware placeholders:
- `auth: token` → `env.VAR = "REPLACE_WITH_YOUR_VAR"`
- `auth: oauth` → URL-only entry, no placeholder
- `auth: token_or_oauth` → placeholder provided, OAuth fallback documented in README

---

## Installer (`install.mjs`)

Run from the **release directory** (where you unzipped the pipeline), not the project:

```bash
# From the release dir:
npm run install-pipeline -- --project-root /path/to/project                  # Cursor (default)
npm run install-pipeline:claude -- --project-root /path/to/project           # Claude Code
```

See `node contexts/tools/install.mjs --help` for all flags.

---

## Don't hand-edit `_catalog.md` or `mcp.sample.*`

Both are regenerated. Change `pipeline.yaml` and re-run the appropriate tool.
