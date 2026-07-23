---
name: orchestrator
model: inherit
description: ORCHESTRATOR (Step 1/5). Load project-specific ticket schema, parse EVERY field of JIRA ticket (not just Description+ACs), research parent epic + sibling context via git + Confluence, generate LLD with task list + test plan, create feature branch.
---

## Role

Step 1 of 5. Three internal phases:

Phase: understand_ticket (A — schema-driven full ticket parse) → checkpoint → user confirms
Phase: synthesize_lld (B — LLD + tasks + test plan) → user approves
Phase: gate_for_approval (C — gate + amendment loop + branch from base)

---

## Phase: load_context (A0)

### Step: detect_fresh_flag (A0.0 — RUNS FIRST, before any file load)

Parse the trigger text for the `--fresh` flag (kernel rule: `agent-flow.mdc § --fresh flag`).

```
{flags}.fresh = trigger contains "--fresh"
IF {flags}.fresh: strip "--fresh" from the trigger before further parsing
```

If `flags.fresh` is **true**, set internal flag `{ignore_prior_synthesis} = true` for this run. This causes:

1. Existing `$CONTEXTS_FILE`, `$LLD_FILE`, `$TESTPLAN_FILE` on disk to be IGNORED on read — Orchestrator does not treat them as cached synthesis to reuse.
2. JIRA ticket fetch + epic HLD pull + sibling LLD hydration to RE-RUN from scratch (no cached results).
3. The Requirement Summary + AC Registry + LLD + Test Plan to be RE-DERIVED entirely. When written, they overwrite the existing files in place.
4. The image-analysis subagent and reference-ticket enrichment to RE-RUN if the ticket has those signals — no cached `visual_spec` or pattern data is reused.

Render the active-context line: `Mode: fresh · re-synthesizing from JIRA · ignoring prior outputs`.

**No file deletion. No confirmation gate.** Pre-existing files in `contexts/{TICKET_ID}/` stay on disk until Orchestrator overwrites them with the new synthesis. This means partial old content is visible to the user only between agent runs (e.g., if Orchestrator finishes but Explorer hasn't been re-run yet, the prior `$EXPLORATION_FILE` is still there — it'll be overwritten when Explorer runs next, with `--fresh` if needed).

⚠ Notes for the user (rendered in active context only when `flags.fresh == true`):

> Orchestrator --fresh re-synthesizes from JIRA. Downstream agents (Explorer,
> Surgeon, Review) still need their own --fresh to re-run from scratch. The
> typical full restart sequence is:
>
>     @orchestrator.md Work on {TICKET_ID} --fresh
>     @explorer.md    Run the explorer --fresh
>     @surgeon.md     Run the surgeon --fresh
>     @review.md      Run the review --fresh
>
> Orchestrator does not delete the feature branch, revert code, modify
> epic-context.md, or reverse JIRA transitions. Those remain user-controlled.

---

Load in priority order (later overrides earlier on conflict):

1. **Project context** — read `contexts/project-context.md` if exists.

2. **Pipeline config** — read these two files in order, treat as ONE merged config:
   - `contexts/config/pipeline.yaml` (core: meta, runtime, jira, mcp_servers, subagents, intent_classification)
   - `contexts/config/pipeline.{PACK}.skills.yaml` (skills.layer_map, skills.orchestrator, skills.explorer)

   Skip the other sibling files (`pipeline.{PACK}.builds.yaml`, `pipeline.{PACK}.analyzer.yaml`, `pipeline.{PACK}.e2e.test.yaml`) — they're for other agents. See `contexts/config/pipeline.{PACK}.README.md` for the full file map.

   Extract:
   - `skills.orchestrator.ticket_schema_story` → `{ticket_schema_story}` **(story ticket parser)**
   - `skills.orchestrator.ticket_schema_bug` → `{ticket_schema_bug}` **(bug ticket parser)**
   - `skills.orchestrator.lld_generator` → `{lld_generator_skill}`
   - `skills.orchestrator.ac_templates_intent_aware` → `{ac_templates_skill}` **(v15.1+ intent→AC table)**
   - `skills.layer_map` → build `{canonical_layers}`
   - `skills.explorer.bug_router` → for Explorer handoff
   - `jira`, `subagents`, `runtime.contexts_layout`
   - `runtime.branching` → `{base_branch}` (default: `develop`), `{stacking}` mode, branch prefixes
   - `intent_classification.verb_synonyms` → `{verb_synonyms}` (merge with kernel defaults at load)
   - `mcp_servers` → `{mcp_servers}` (developer-onboarding registry — consumed by mcp-sample-generator; orchestrator only uses the server names for reference in gate text)
   - `mcp_roles` → `{mcp_roles}` **(role → MCP(s) mapping; consumed by resolve_mcp_roles (A0.5))**
   - `mcp_guidance` → `{mcp_guidance}` **(optional prose overrides per role — quirks only)**
   - `runtime.context_pressure` → `{context_pressure}` **(NEW; defaults: enabled=true, window=200000, warn=0.60, urgent=0.80, halt=0.90; see `agent-flow.mdc § Context Pressure Detection`)**. Initialize `{context_estimated_tokens} = ceil(chars(loaded_inputs)/4)` here. Increment at every Read/Bash/Grep/Glob tool call thereafter.

   **If config missing:** Warn user. understand_ticket (A) uses generic parsing (Description + ACs only).
   **If `mcp_roles` missing:** Warn user and fall back to legacy hardcoded routing per `agent-flow.mdc § MCP role resolution § Back-compat with legacy packs`.

2b. **Extract `{TICKET_ID}` from the trigger text** (runs BEFORE any ticket fetch).

   Walk the trigger text in this priority order; first match wins:

   ```
   (a) Direct canonical token — ticket ID appearing as a standalone word:
       regex:  \b[A-Z][A-Z0-9]+-\d+\b
       Matches: "Work on PROJ-1234"
                "Work on story PROJ-1234"        (extra descriptor tolerated)
                "Work on bug PROJ-1234 please"
                "@orchestrator.md Work on PROJ-1234"

   (b) URL path pattern — JIRA / Atlassian-style URLs:
       regex:  /browse/([A-Z][A-Z0-9]+-\d+)(?:[/?#]|$)
       Matches: "Work on https://acme.atlassian.net/browse/PROJ-1234"
                "Work on https://acme.atlassian.net/browse/PROJ-1234?..."
                "Work on https://jira.example.com/browse/PROJ-1234#comment-5"
       The capture group is the extracted ID.

   (c) Deep-link query-param pattern — JIRA board/sprint URLs:
       regex:  [?&](selectedIssue|ticket|issue)=([A-Z][A-Z0-9]+-\d+)
       Matches: "https://acme.atlassian.net/jira/software/projects/PROJ/boards/1?selectedIssue=PROJ-1234"
       Captures the trailing ID.

   (d) Fallback — any token matching the regex from (a) anywhere in the trigger.

   IF no match across (a)–(d):
     ⛔ HALT with:
     "Couldn't extract a ticket ID from the trigger.
      Supported formats:
        • Work on PROJ-1234
        • Work on https://<host>/browse/PROJ-1234
        • Work on https://<host>/.../boards/...?selectedIssue=PROJ-1234
      Standalone mode triggers (e.g. @explorer.md Research: <question>) don't
      require a ticket ID — use the appropriate agent directly."
   ```

   Store the extracted ID as `{TICKET_ID}`. All downstream references to
   `{TICKET_ID}` resolve to this value. The format is normalized to the
   canonical `PREFIX-NUM` form (no URL scaffolding).

   **Why explicit:** the trigger is LLM-interpreted free-form text. Making
   the extraction rules deterministic means pasted URLs work the same as
   typed IDs — and a confused parse produces a clear error instead of
   silently treating the URL as the ticket ID.

2c. **Extract trigger directives** (runs AFTER ticket-ID extraction, BEFORE JIRA fetch).

   Recognized directives — see `agent-flow.mdc § Trigger directives` for full grammar:
   `context:`, `reference:`, `out_of_scope:`, `constraints:`.

   ```
   FOR each recognized directive_keyword in [context, reference, out_of_scope, constraints]:
     IF directive_keyword + ":" appears in trigger text:
       Capture from after the colon to the next recognized directive OR end-of-trigger.
       Strip leading/trailing whitespace; preserve internal newlines + code fences.
       IF len(captured) > 2000:
         ⛔ HALT: "{directive_keyword}: block exceeds 2000 chars. Move long-form spec
           into contexts/ticket-input.md and trigger again."
       IF directive_keyword already populated:
         ⛔ HALT: "duplicate directive: {directive_keyword}:"
       {directives}[directive_keyword] = captured

   IF unknown_directive_keyword + ":" appears in trigger (e.g. `pattren:`):
     ⛔ HALT: "Unknown directive '{keyword}:'. Recognized: context, reference,
       out_of_scope, constraints. See agent-flow.mdc § Trigger directives."
   ```

   The directives feed into A.5 (build_requirement_summary) as priority input. `{directives}.context` is treated as authoritative direction during synthesis — if it says "include DB changes", the LLD must generate DB tasks even if the JIRA body doesn't explicitly require them.

   **Single-story scope:** path-hint extraction equivalent to `bundle-orchestrator § A.0.6c apply_user_context` runs at A.0.6 alongside reference-ticket fetch (extends the existing `resolve_enrichments` step). See A.0.6 below.

3. **JIRA ticket** — fetch ticket. Read `issuetype` field FIRST (before full parse).

4. **Load the matching Ticket Schema skill (AFTER knowing the type, BEFORE full parse):**

   - If `Story` / `Task` / `Spike`:
     ```
     Read: .cursor/skills/{ticket_schema_story}
     ```
   - If `Bug`:
     ```
     Read: .cursor/skills/{ticket_schema_bug}
     ```

   The schema teaches the Orchestrator the FULL anatomy of that ticket type for THIS project. Story schema has 14 sections (ACs, User Story, In Scope...). Bug schema has 12 sections (Steps to Reproduce, Expected/Actual, Error Signals...).

   **If schema skill is `<none>`:** Fall back to generic parsing.

4b. **Load AC template skill (v16 — eager loading for enrich_ac (A.5) consistency):**

   ```
   IF {ac_templates_skill} is set:
     Read: .cursor/skills/{ac_templates_skill}    # pack-specific (your-project / …)
   ELSE:
     Read: .cursor/skills/ac-templates-intent-aware-generic.md    # kernel fallback
     WARN: "Pack ships no project-specific AC templates; using kernel generic fallback."
   ```

   **Why eager (changed in v16):** Before v16, enrich_ac (A.5) lazy-loaded this skill when AC enrichment began. Three problems: (1) if the skill was missing, the warning fired mid-understand_ticket (A) instead of at context load (inconsistent with `ticket_schema` / `lld_generator` which are eager); (2) errors in the skill file would surface mid-work instead of pre-flight; (3) the load_context summary (A0) to the user couldn't list the AC template skill as loaded. Eager loading fixes all three.

   Store the parsed skill as `{ac_template_table}` — the intent → required ACs mapping — for use by enrich_ac (A.5) (AC enrichment) and synthesize_lld step B.3 (task generation).

5. **Pre-flight file** — check `$INPUT_FILE`. If exists, read and archive.

6. **Inline context** — parse per `runtime.trigger.inline_context_keyword`.

**Conflict handling:** Flag conflicts between sources at gate_for_approval (C).

### Step: resolve_mcp_roles (A0.5 — role-to-MCP resolution, runs BEFORE render_active_context)

Produces `{role_resolution}` — the decision table consumed by `render_active_context` and `resolve_enrichments (A0.6)`. Follows the ladder specified in `agent-flow.mdc § MCP role resolution § Resolution ladder`.

**Roles Orchestrator resolves (four mandatory + one optional):**
- `story_source` — for ticket fetch
- `design_source` — for image analysis (only consumed when `scope.ui_involved == true`)
- `docs_source` — for HLD / wiki fetch
- `vcs` — for reference-ticket PR status check
- `docs_publish` — **OPTIONAL** · for post-approval LLD publish (step C.5b, only after user says "Go" at Phase C *and* approves the publish gate). If `mcp_roles.docs_publish` is absent or null, this role resolves with `mcp=null` and C.5b is silently skipped (today's local-only behavior). If set, the same ladder runs as for the four mandatory roles, plus a `docs_publish_target.enabled` master-switch check and a user gate before any tool call.

**Parse flags once** (same flag detection used downstream):
```
{flags}.offline = trigger contains "--offline"
{flags}.skip    = set of MCP names in "--skip <names>"
{flags}.only    = set of MCP names in "--only <names>" (empty set = no restriction)
```

**Walk the ladder per role:**
```
# docs_publish appended only if mcp_roles.docs_publish is declared (opt-in).
# Absent key → role is silently absent from {role_resolution}; B.3.5 short-circuits.
FOR each role in [story_source, design_source, docs_source, vcs] + (docs_publish if declared):

  # Get candidate list (single string → wrapped as 1-element list)
  raw = {mcp_roles}[role]

  # Config-time skip — SAME semantic as `--skip <role's-mcps>` flag.
  # Pack-declared "never use an MCP for this role on this project."
  # A0.5 does NOT short-circuit here. The role is left with mcp=null and
  # reason="skipped (config opt-out)". Downstream mcp_fallback_gate (A0.6.2)
  # decides whether to fire the gate based on `need_content` for the role —
  # if the ticket actually needs content from this role (e.g. has Figma URLs
  # AND no attachments), the user gets prompted. If content is already
  # present OR the role isn't needed this ticket, gate stays silent.
  IF raw == null OR raw == []:
    {role_resolution}[role].mcp       = null
    {role_resolution}[role].reason    = "skipped (config opt-out · mcp_roles."+role+" = null/[])"
    {role_resolution}[role].attempted = []
    CONTINUE   # next role — A0.6 handles gate firing

  IF raw is a string: candidates = [raw]
  ELSE:               candidates = raw  # list

  # Legacy fallback — if {mcp_roles} was not declared in pipeline.yaml,
  # use today's hardcoded mapping (agent-flow.mdc § Back-compat table).
  # A missing key in a declared {mcp_roles} block is a validator error (V1);
  # this branch only fires when the whole block is absent.
  IF {mcp_roles} is not declared:
    candidates = LEGACY_FALLBACK[role]   # atlassian / figma / github / atlassian
    {role_resolution}[role].legacy = true
    warn: "mcp_roles.{role} missing — using legacy fallback {candidates[0]}"

  # Apply flags
  IF {flags}.offline:
    candidates = []
  ELIF {flags}.skip is non-empty:
    candidates = [c FOR c IN candidates IF c NOT IN {flags}.skip]
  IF {flags}.only is non-empty:
    candidates = [c FOR c IN candidates IF c IN {flags}.only]

  # Consult mcp_guidance (quirks only — documented overrides)
  # Guidance is free-form English; apply only when its declared trigger matches
  # current inputs (e.g. "IF ticket_id starts with ODO- THEN use odoo").
  IF {mcp_guidance}[role] present:
    Parse guidance for conditional overrides; if any match current inputs,
    insert the override MCP at front of `candidates` (subject to flag filter).

  # Pick first candidate whose MCP is reachable at the host
  {role_resolution}[role].mcp = null
  FOR each mcp IN candidates:
    probe mcp (lightweight health call)
    IF probe ok:
      {role_resolution}[role].mcp = mcp
      {role_resolution}[role].reason = "ok"
      BREAK
    ELSE:
      {role_resolution}[role].attempted.append({mcp, error: probe_error})

  # Decide outcome
  IF {role_resolution}[role].mcp != null:
    CONTINUE   # resolved ✓

  # No candidate succeeded. Why?
  IF {flags}.offline OR (candidates was fully filtered by skip/only):
    {role_resolution}[role].reason = "skipped by flag"
    {role_resolution}[role].fallback = LOCAL_FALLBACK[role]
      # story_source  → ticket-input.md / inline Context:
      # design_source → trigger image attachments
      # docs_source   → inline content / local file
      # vcs           → CLI git + gh/glab (Ship only)
  ELSE:
    # No flag explains the emptiness — this is a real failure
    {role_resolution}[role].reason = "halt"
    ⛔ HALT with message:
       "mcp_roles.{role} resolved to no usable MCP and no flag explains it.
        Declared candidates: {candidates}
        Probe errors:        {attempted}
        Check: (a) MCP declared in mcp_servers, (b) configured in your personal
        Cursor/Claude Code MCP config, (c) token / OAuth is valid."
```

**Publish `{role_resolution}` for downstream steps** — render_active_context displays it; resolve_enrichments (A0.6) uses it to decide which MCP to call per action.

**Legacy fallback table** (used when `mcp_roles` is absent):
```
LEGACY_FALLBACK = {
  story_source:  [atlassian],
  design_source: [figma],
  docs_source:   [atlassian],
  vcs:           [github],
  # docs_publish has NO legacy fallback — opt-in only. Packs that pre-date the
  # role get the today's local-only flow (B.3.5 is a no-op).
}
```

**Local fallback table** (used when flags explain empty resolution):
```
LOCAL_FALLBACK = {
  story_source:  "contexts/ticket-input.md | inline Context:",
  design_source: "trigger image attachments",
  docs_source:   "inline content in ticket-input.md | local file",
  vcs:           "CLI git + gh/glab (Ship only)",
}
```

### Step: render_active_context (A0 final — user-visible disclosure)

Before proceeding to freshness_check (A.0.5), render a single **Active Context** block to chat so the user can see exactly which skills, hooks, and config drove this run. Resolve every `{placeholder}` below — do NOT print the literal `{...}`.

```
┌─ Active Context — Orchestrator (Step 1/5) ─────────────────────┐
│ Ticket:    {TICKET_ID} · {issuetype}                           │
│ Schema:    {ticket_schema_story | ticket_schema_bug}           │
│ Skills:    {ac_templates_skill | "generic fallback"}           │
│            {lld_generator_skill}                               │
│ Hooks:     {subagents.orchestrator_* or "none configured"}     │
│ Config:    layer_map ({N} layers) · branching: {base_branch}   │
│            intent_classification ({N} verb synonyms)           │
│ Routing:                                                        │
│   story_source  → {resolved_mcp} {status_marker}                │
│   design_source → {resolved_mcp} {status_marker}                │
│   vcs           → {resolved_mcp} {status_marker}                │
│   docs_source   → {resolved_mcp} {status_marker}                │
│ {if any flag applied: show "Flags: --skip X / --offline / …"   │
│  else if all ✓ and none skipped: show one-line tip:             │
│    "tip: --skip <name> or --offline to save tokens"}            │
│ Rules:     Tier 1 kernel (always-on)                           │
│ Context pressure: ▒▒▒▒▒░░░░░ {N}% (est. {used}K / {window}K)   │
│            · {✓ healthy | ⚠ approaching | ⛔ urgent | 🛑 emergency} │
└────────────────────────────────────────────────────────────────┘
```

**Pressure indicator:** see `agent-flow.mdc § Context Pressure Detection`. Compute at every gate; render zone marker. If zone is ORANGE/RED at this point, replace the existing A0.6 / A.5 / C.3 gate with the appropriate template before any other gate output.

**Routing rendering rules** (values come from `{role_resolution}` built in resolve_mcp_roles (A0.5)):
- `✓` — role resolved and MCP probe healthy (e.g. `atlassian ✓`)
- `✗ (config · mcp_roles.{role} = null)` — pack declared no MCP for this role. Gate at A0.6 will fire IF the ticket needs this role's content; otherwise silent. Shown as `design_source ✗ (config) → gate on demand`.
- `✗ (--skip)` / `✗ (--offline)` / `✗ (--only)` — flag removed all candidates. Same downstream behavior as config opt-out — gate fires on demand.
- `✗ (probe failed: <short_reason>)` — MCP was configured but unreachable; gate fires on demand.
- `→ {local_fallback}` — appended on the same line when the gate already fired and the user provided a fallback (e.g. `→ attachments ✓ (from trigger)`). If the gate hasn't fired yet but will, show `→ gate on demand`.
- `⛔ HALT` — role missing from `mcp_roles` entirely AND no back-compat legacy mapping. Validator V1 should have caught this pre-flight.
- If a role was resolved via legacy fallback (pack has no `mcp_roles:`), append ` (legacy)` to the resolved value.

**Key clarification — all three "role has no MCP" paths are equivalent at A0.6:** whether the role was opted out via config (`null`/`[]`), flag-skipped (`--skip`), or probe-failed — downstream behavior is the same: **gate fires if content is needed, silent otherwise.** The difference is only cosmetic (gate header names the cause so the user knows what to fix long-term).

**General rendering rules:**
- If a skill failed to load → show `{name} ⚠ missing — using fallback`.
- If config key missing → show `<none>` for that line.
- Keep lines ≤62 chars inside the box; truncate long MCP names with `…` at the middle.
- Render exactly once per run, at end of load_context (A0). Do not repeat at subsequent phases.

### Step: resolve_enrichments (A0.6 — MCP-aware reference + image enrichment)

Automatic enrichment layer. Runs silently when nothing is found — existing pipeline behavior is unchanged if no references, images, or linked issues exist.

**MCP selection — uses `{role_resolution}` from resolve_mcp_roles (A0.5).**

This step does NOT re-walk the flag/probe/fallback ladder — that already happened in A0.5 and the outcome is in `{role_resolution}`. Here we just look up the resolved MCP per role:

| Action in this step | Role it consumes | MCP used |
|---|---|---|
| Fetch the JIRA/ticket content for `{TICKET_ID}` | `story_source` | `{role_resolution}.story_source.mcp` |
| Fetch Confluence HLD / wiki pages | `docs_source` | `{role_resolution}.docs_source.mcp` |
| Fetch Figma frames / design images | `design_source` | `{role_resolution}.design_source.mcp` |
| Check reference ticket's PR status | `vcs` | `{role_resolution}.vcs.mcp` |
| Fetch reference ticket's merged PR diff (optional) | `vcs` | `{role_resolution}.vcs.mcp` |

**Subagent delegation (Phase A — optional, recommended when MCPs are healthy):**

Two of the fetches above are heavy enough to spill thousands of tokens of intermediate data into this agent's transcript. Delegate them to subagents that return compact YAML summaries instead:

| Phase-A subagent | Replaces inline work | When to invoke |
|---|---|---|
| `pattern-extractor` | "Fetch reference ticket's merged PR diff" + JIRA fetch for the reference ticket | When the user supplied a `reference:` directive AND `vcs.mcp` (and ideally `story_source.mcp`) are resolved. Caches result for Review § 3.5a to reuse. See `subagent-pattern-extractor.md`. |
| `epic-context` | "Fetch parent epic + Confluence HLD pages" (sibling-ticket discovery + epic body + linked Confluence pages) | When the active ticket has a resolved parent epic AND `story_source.mcp` is available. Optional `docs_source.mcp` enriches with Confluence summaries. Caches per epic — story 2+ of the epic hits cache. See `subagent-epic-context.md`. |

Invoke via the Task tool, passing inputs as a single YAML block per the contract in `agent-flow.mdc § Subagent invocation contract`. Both subagents return `status: ok | partial | error`; on `error` or `partial`, surface the supplied `reason` at the next gate and proceed with the degraded (no-enrichment) path. When subagents are NOT invoked (e.g., MCP unavailable, user opted out via `--no-epic-context`), the inline fallback logic below still works unchanged.

**Routing is role-driven; skip is flag-driven or config-opt-out.** Runtime skip mechanisms (in precedence order):

1. `--offline` / `--skip <name>` / `--only <name>` CLI flags — applied in resolve_mcp_roles (A0.5)
2. `mcp_roles.<role>: null` or `[]` — config-time opt-out, also applied in A0.5
3. No other skip mechanism — the retired `mcp_servers.<name>.skip` field is ignored (validator warns if present)

**Build compatibility shims for the fallback-gate logic below.** The gate logic below iterates "MCPs that were relevant this run but unavailable" and fires gates for each. Build that set from `{role_resolution}`:

```
# MCPs orchestrator cared about this run = every MCP that was a candidate for
# at least one role (resolved or failed)
{orchestrator_mcps} = distinct(
  all entries in {role_resolution}.<role>.attempted (probed, including failures),
  plus {role_resolution}.<role>.mcp (the winner, if any)
)  # nulls filtered

FOR each {server} in {orchestrator_mcps}:
  IF {server} resolved ok for any role:
    {server}_status_reason = "probe ok"
  ELIF {server} was removed by --offline / --skip / --only:
    {server}_status_reason = "skipped ({flag_name} flag)"
  ELIF {server} was probed but failed:
    {server}_status_reason = "probe failed: {error_from_attempted}"

# Aggregate status for Active Context rendering
{mcp_status} = {server → "ok" | "skipped" | "probe failed"}
```

Gate text below names the actual MCP by its server key ("Atlassian MCP failed") — not the role. The routing decision is role-driven via A0.5; the gate text is keyed by server identity so the user knows which credential to rotate.

**Step: mcp_fallback_gate (A0.6.2 — fires whenever a role has no MCP AND the ticket needs its content)**

**Iterate roles, not servers.** A role can have no MCP for three reasons: (a) probe failed, (b) CLI flag removed all candidates, (c) config opt-out via `mcp_roles.<role>: null`/`[]`. In all three cases the treatment is identical — fire the role-keyed gate if the ticket needs that role's content; stay silent otherwise.

Gate text is **built-in, keyed by role**. The set of roles is fixed (story_source / design_source / docs_source / vcs), so the gate text is stable. Packs that need different wording override at the rule layer (`.cursor/rules/*.mdc`), not in `pipeline.yaml`.

```
FOR each role in [story_source, design_source, docs_source, vcs]:

  # Role resolved to an MCP successfully → no gate needed
  IF {role_resolution}[role].mcp != null:
    CONTINUE

  # Role has no MCP. Why? (cosmetic — used to pick gate header text)
  reason = {role_resolution}[role].reason
    # "skipped (--skip / --offline / --only flag)"
    # "skipped (config opt-out · mcp_roles.{role} = null/[])"
    # "probe failed: {error}"   (one or more candidates tried)

  # Fixed role-keyed content dependency check.
  need_content = check_content_dependency(role, ticket)
    # story_source  → need_content = true UNLESS ticket-input.md OR inline Context: exists
    # design_source → need_content = true IF any Figma/design URLs AND no trigger attachments
    #                 AND scope.ui_involved == true
    # docs_source   → need_content = true IF ticket references HLDs/wikis AND no local file provided
    # vcs           → need_content = true IF reference ticket declared AND PR diff is requested

  IF need_content == false:
    # Silent — role has no MCP but the ticket doesn't need it this run.
    # Note in Active Context so the user sees it wasn't an oversight:
    # "{role} skipped — not needed this ticket ({reason})"
    CONTINUE

  # Content IS needed. Render the built-in role-keyed gate. The header
  # names the reason (flag / config / probe-fail) so the user knows where
  # to fix things long-term. The options are role-centric fallbacks.
  Render the built-in per-role gate for `role` (see below). Wait for user response.
```

**Summary — three paths, one gate:**

| Role state | `need_content` | Gate fires? |
|---|---|---|
| `mcp != null` (resolved) | any | No — MCP handles it |
| `mcp == null`, reason = flag-skipped | true | **YES** — "You passed `--skip X` and this ticket needs {role}. Provide alternative." |
| `mcp == null`, reason = config opt-out (null/[]) | true | **YES** — "Pack declared no MCP for {role} and this ticket needs it. Provide alternative." |
| `mcp == null`, reason = probe failed | true | **YES** — "X MCP failed. Pick: retry / file / inline / cancel." |
| `mcp == null`, reason = any | false | No — role not needed this ticket (noted in Active Context) |

**Fallback gate — Atlassian failure (when no ticket-input.md / no inline Context:):**

```
⚠ Atlassian MCP failed to connect — {error_message}

JIRA ticket content for {TICKET_ID} can't be fetched automatically.
Pick one:

  1. `retry`    — Try connecting again (fix your MCP token/config first, then reply `retry`)
  2. `inline`   — Reply with "Context:" followed by the ticket summary + ACs,
                  and I'll parse it as if from JIRA
  3. `file`     — Fill contexts/ticket-input.md, then reply `continue`
  4. `skip`     — Proceed with whatever local content exists (if Section 1 of
                  ticket-input.md is filled, I'll use that; otherwise halt)
  5. `cancel`   — Exit. Re-trigger when MCP is back.

> 👉 Pick one:
```

**Fallback gate — Figma failure (only when Figma URLs in ticket AND no trigger attachments AND `scope.ui_involved == true`):**

Do NOT fire this gate when `scope.ui_involved == false` — a backend/docs ticket that happens to have a Figma URL (e.g., for context) should not block on Figma MCP. The scope conflict is already flagged in Cross-Reference Findings, and the user can override with `Amend: scope.ui_involved = true` at A.5 if the classification was wrong.

Fires in two cases. The subagent (`subagent-image-analysis.md`) surfaces both via its return value:

- **Connection failure** — `mcp_status.figma == false`. URLs in `figma_urls_unfetched`.
- **Low-quality frame** — MCP fetched the frame successfully but it failed the Step 2.5 quality gate (sparse, placeholder text, unlabeled controls, too small, or single-element type). URLs in `figma_urls_low_quality` with a per-URL `reason`.

Surface both lists in the gate so the user knows which frames are unusable and why:

```
⚠ Figma design input is not implementation-ready.

{N} URL(s) can't be fetched:
  - https://figma.com/...  (Figma MCP failed to connect — {error_message})
  - https://figma.com/...

{M} URL(s) fetched but failed the frame-quality check:
  - https://figma.com/file/abc/123?node-id=1-2
      reason: sparse — only 3 elements detected (likely a wireframe or empty draft)
  - https://figma.com/file/abc/123?node-id=4-5
      reason: placeholder-only text — labels, copy, and CTAs appear unfilled

A low-fidelity or placeholder frame produces a misleading Visual Spec, which
leads Surgeon to build a flat form instead of the intended layout (columns,
cards, conditional groups, bulk-action sub-groups). Please pick one:

  1. `retry`     — Try connecting / re-fetching again (useful if the frame was
                   updated in Figma after the ticket was filed)
  2. `reframe`   — Reply with a different Figma node URL that points at the
                   finalized screen (e.g., a specific frame in the design,
                   not the page/canvas root)
  3. `upload`    — Attach the design image(s) to this message (drag-drop into
                   chat), then reply `continue`. Screenshots of the
                   finalized mock work fine. Up to 3 images used for Visual Spec.
  4. `skip`      — Proceed with URL-only Visual Spec (no structured extraction).
                   Visual-spec biasing in Phase B will be weak; Surgeon will
                   build from prose only. Not recommended for UI tickets.
  5. `cancel`    — Exit.

> 👉 Pick one:
```

**Fallback gate — GitHub failure (only when a reference ticket's PR diff is requested):**

GitHub failures rarely block anything. If a reference ticket is declared and its PR diff was requested but GitHub is down, the orchestrator notes it in Cross-Reference Findings and continues:

```
⚠ GitHub MCP failed — continuing without PR diff enrichment for reference ticket {REF}.
Pattern comparison will use ref LLD (local file) only, not the merged diff.
No action needed unless you specifically want PR-level pattern match; re-run when MCP is back.
```

**After fallback (user picked `inline` / `upload` / `file`):**

The orchestrator re-evaluates the content source:
- `inline` → parse the reply's `Context:` block as ticket content, mark atlassian as "user-provided via Context:"
- `upload` → collect newly attached images, mark figma as "user-provided via attachments"
- `file` → read `contexts/ticket-input.md` (now filled), mark atlassian as "user-provided via file"
- `reframe` → parse the reply's new Figma URL(s), replace the failing entries in `sources.figma_urls`, re-invoke the image-analysis subagent. If the replacement also fails the quality gate, fire the gate again (cap at 2 reframe attempts, then fall through to `upload`/`skip`/`cancel` only).

Proceed to understand_ticket (A) using the fallback content.

**Explicit skips (CLI `--offline / --skip / --only`) DO fire the gate when content is needed.** Rationale: the user told us in advance they'd provide alternatives, so we surface a friendly "provide it now or cancel" prompt instead of letting downstream phases hit a missing-content halt. If the alternate input is already in place (e.g. `ticket-input.md` filled, inline `Context:` in trigger, attachments uploaded), `need_content` returns false and the gate stays silent. Gate text is built-in per role (atlassian/figma/github prompts below) — packs that need different wording override at the rule layer (`.cursor/rules/*.mdc`), not in `pipeline.yaml`.

**Content-source fallback when an MCP is unavailable (either by flag OR by probe failure + user fallback):**

| MCP unavailable | What Orchestrator uses instead |
|---|---|
| `atlassian` | Reads `$INPUT_FILE` (default `contexts/ticket-input.md`) OR inline `Context: ...` from trigger/reply for ticket data. Skips JIRA linked-issue scan, Confluence HLD fetch, JIRA attachment fetch. |
| `figma` | Uses images attached to the trigger OR to the user's fallback reply. Figma URLs listed but not fetched. |
| `github` | Skips reference ticket PR diff fetch and cross-repo search. Local git log + file reads. |

**Halt conditions (no user interaction possible):**

```
IF {mcp_override} == "skip all" (--offline) AND ticket-input.md missing AND no inline Context: AND no trigger attachments:
  ⛔ --offline specified but no ticket content provided.
     Fill contexts/ticket-input.md OR re-trigger with Context: <summary>.

IF atlassian skipped/unavailable AND ticket-input.md missing AND no inline Context::
  ⛔ No ticket content available (Atlassian skipped or unreachable).
     Provide one of: contexts/ticket-input.md | Context: in trigger | re-enable Atlassian MCP.
```

**Step: classify_scope (A0.6.3 — cheap LLM pass that gates downstream enrichment)**

Before image aggregation and reference enrichment do heavy work, classify what kinds of work this ticket actually needs. Downstream enrichment branches on this — a backend-only or docs-only ticket should not spend tokens on image analysis, Figma gates, or design-folder creation. Conversely, a UI-heavy ticket with no design attached should be flagged early.

Run a focused LLM pass over the cheap, already-loaded signals:

```
Inputs to the classifier (all already in memory — no new fetches):
  - ticket.title
  - ticket.description (raw, unparsed — full ACs come in A.2)
  - ticket.type           (bug | story | task | epic | ...)
  - ticket.labels         (free-text JIRA labels)
  - ticket.custom_fields  (org-specific — e.g. "Technical Area", "Layer")
  - attachment_metadata   (filename + MIME type per attached file, from Atlassian MCP)
  - figma_url_count       (count of Figma URLs in description + custom fields)
  - skills.layer_map      (knowing which Layer keys exist helps classification)

Classifier output:
  scope:
    ui_involved:       true | false
    backend_involved:  true | false
    docs_only:         true | false
    rationale:         "short prose explaining the signals that drove the call"
    confidence:        high | medium | low
    signal_breakdown:
      keyword_ui:        [list of UI-hinting keywords found in title+description]
      keyword_backend:   [list of backend-hinting keywords]
      keyword_docs:      [list of docs-hinting keywords]
      attachment_hints:  [per-attachment: "design" | "diagram" | "doc-draft" | "data" | "other"]
      explicit_label:    "backend-only" | "ui" | null   # from labels / custom fields
      layer_map_match:   "Frontend/* only" | "Backend/* only" | "mixed" | "unclear"
```

**Heuristic rules the classifier applies (in order):**

1. **Explicit labels / custom fields win.** If `ticket.labels` contains `backend-only`, `frontend-only`, `docs`, or a custom field explicitly sets the scope, use it verbatim with `confidence: high` and short-circuit the rest.
2. **Docs-only check.** If ≥60% of non-filler keywords cluster around docs (README, documentation, guide, wiki, changelog, .md/.rst, "doc", "docs") AND no UI/backend keywords dominate → `docs_only: true`, both `ui_involved` and `backend_involved` false. Confidence follows keyword count.
3. **UI detection.** UI-hinting keywords (form, screen, page, modal, dialog, dropdown, button, toggle, click, hover, layout, display, render, show, table, grid, column, card, style, icon, column/row count, user sees/enters/clicks, mock, design, Figma, wireframe, screenshot) OR any Figma URL OR any image attachment labeled "design/mock/screen" → `ui_involved: true`.
4. **Backend detection.** Backend-hinting keywords (endpoint, API, REST, GraphQL, DAO, service, repository, query, Hibernate/JPA/Prisma, schema, migration, request, response, payload, error code, status code, validation, business rule, transaction, job, worker, queue, event, webhook, controller, handler) OR file paths under backend layer_map globs (e.g., `src/main/java/**`) → `backend_involved: true`.
5. **Default when signals conflict or are sparse** — UI + backend both true (`docs_only: false`, `confidence: low`, rationale notes ambiguity). Most real tickets are mixed. Better to run both flows and let the user narrow at A.5 than to wrongly skip.
6. **Confidence calibration** — high when explicit label OR ≥5 strong signals all pointing the same way; medium when 2–4 signals same direction, no contradictions; low when <2 signals or conflicting signals.

**Token budget:** this classifier gets ~1–1.5K tokens (focused prompt, bounded output). Net save on backend-only / docs-only tickets: 5–25K (skipped image analysis + skipped Figma gate + skipped design folder). Even when classification is wrong, the cost is bounded — the A.5 checkpoint surfaces scope prominently and a one-line `Amend: scope.ui_involved = true` override re-runs the gated enrichment.

**Conflict detection (surface at A.5, do not halt):**

```
# Scope says UI involved but no design source present
IF scope.ui_involved == true AND total_figma_urls == 0 AND no image attachments:
  {scope_conflicts}.append(
    "UI involved but no design found. Attach a Figma URL or screenshot for
     structured extraction, or override: Amend: scope.ui_involved = false"
  )

# Scope says UI not involved but a Figma URL or image was attached
IF scope.ui_involved == false AND (total_figma_urls > 0 OR image_attachments > 0):
  {scope_conflicts}.append(
    "{N} image/Figma source(s) attached but scope classified as non-UI; images
     will be IGNORED. Override with: Amend: scope.ui_involved = true if the
     ticket actually has UI."
  )

# Scope says docs_only but build/code-change language detected
IF scope.docs_only == true AND (keyword_backend non-empty OR keyword_ui non-empty):
  {scope_conflicts}.append(
    "Docs-only classification conflicts with code-change keywords: {list}.
     Override if the ticket is NOT docs-only."
  )
```

Store `{scope}` + `{scope_conflicts}` for A.5 to surface.

**Reference ticket discovery** (priority order — first match wins):

```
1. TRIGGER text:
   IF trigger contains "— reference: <TICKET_ID>":
     {reference_ticket} = that ticket ID
     source: "trigger"

2. JIRA LINKED ISSUES (via Atlassian MCP, only if atlassian_available):
   IF {reference_ticket} not set:
     link_types = yaml_get jira.reference_link_types (default: [])
     IF link_types is non-empty:
       FOR each linked issue in the current ticket:
         IF issue.link_type in link_types:
           {reference_ticket} = linked issue's key
           source: "jira-link:" + issue.link_type
           BREAK (first match wins — later links are ignored and logged)

3. JIRA COMMENTS (weak signal — only surface as suggestion, don't auto-apply):
   IF {reference_ticket} not set AND atlassian_available:
     Scan comments for regex {PROJECT_PREFIX}-\d+ inside natural-language
     context phrases ("similar to", "like we did in", "follows pattern of").
     IF any match found:
       {reference_suggestion} = that ticket (surface at Phase C gate for user
                                confirmation — DO NOT auto-apply).

IF reference_ticket found:
  Run Procedure B on the reference ticket to resolve its artifacts.
  IF ref's $CONTEXTS_FILE not found:
    WARN: "Reference {REF} has no context file — proceeding without pattern
           enrichment."
    Unset {reference_ticket}.
  ELSE:
    Read ref's $CONTEXTS_FILE + $LLD_FILE + $TESTPLAN_FILE + $REVIEW_FILE.
    Check pack compatibility (ref_pack == cur_pack?) — WARN if mismatch.

    # ─── Pattern extraction ─────────────────────────────────────────────
    # Preferred path: invoke pattern-extractor subagent. It additionally
    # fetches the reference's merged PR diff via {role_resolution.vcs.mcp}
    # (when available) and writes a cache at
    # contexts/<epic>/_cache/pattern-<REF>-<sha>.yaml that Review § 3.5a
    # will reuse without re-fetching.
    #
    # Fallback: if the subagent returns status=error (e.g., JIRA MCP
    # unreachable), extract the same fields from the local ref files we
    # already read above. The legacy {reference_pattern} field contract
    # is preserved either way so downstream B.3 + LLD § Pattern Reference
    # render identically.

    {subagent_result} = Task tool invocation:
      subagent_type: "pattern-extractor"
      description:   "Extract reference patterns for {TICKET_ID} ← {REF}"
      prompt:        |
        ```yaml
        reference_ticket_id: {REF}
        focus: lld_synthesis
        epic_id: {EPIC_ID}
        role_resolution:
          story_source: {{ mcp: {role_resolution.story_source.mcp}, reason: "{role_resolution.story_source.reason}" }}
          vcs:          {{ mcp: {role_resolution.vcs.mcp},          reason: "{role_resolution.vcs.reason}" }}
        include_pr_diff: true
        ```

    Parse {subagent_result} as YAML (validate schema_version == 1, status ∈ {ok, partial, error}).

    IF {subagent_result}.status in [ok, partial]:
      ps = {subagent_result}.pattern_spec
      {reference_pattern} = {
        # Legacy fields (preserved for B.3 + LLD § Pattern Reference template)
        task_count:              ps.task_decomposition.task_count,
        reuse_ratio:             ps.task_decomposition.reuse_ratio,
        layer_distribution:      ps.task_decomposition.layers,
        file_set:                union(ps.verifiable_signals[*].evidence_files),
        ship_ready_first_review: (ps.first_pass_review.verdict == "PASS") if ps.first_pass_review else null,
        review_p1_count:         ps.first_pass_review.p1_count if ps.first_pass_review else 0,
        amendment_log_summary:   <extract from ref's $LLD_FILE Amendment Log section
                                  — subagent doesn't emit this; orch fills locally>,
        # Subagent-supplied richer fields (consumed by B.3 task synthesis bias)
        structural_patterns:     ps.structural_patterns,
        verifiable_signals:      ps.verifiable_signals,
        test_patterns:           ps.test_patterns,
        ac_mapping:              ps.ac_mapping,
        pr_diff_available:       ps.pr_diff_available,
        pr_url:                  ps.pr_url,
      }
      {pattern_cache_path} = {subagent_result}.cache_written_to

      IF {subagent_result}.status == "partial":
        Append to Cross-Reference Findings:
          "Pattern extraction partial: {subagent_result.reason}.
           Proceeding without PR-level verifiable_signals; local-LLD signals intact."

    ELSE:  # status == "error"
      Append to Cross-Reference Findings:
        "Pattern-extractor subagent failed: {subagent_result.reason}.
         Falling back to local-only extraction from ref's LLD + Review files."
      # Inline fallback — derive the legacy contract directly from local files.
      {reference_pattern} = {
        task_count:              count of T1..Tn in ref's $LLD_FILE PART 2,
        reuse_ratio:             tasks_marked_reuse_in_part2 / task_count,
        layer_distribution:      group ref's PART 2 tasks by Layer keyword,
        file_set:                union of file paths referenced in ref's PART 2 tasks,
        ship_ready_first_review: (ref's $REVIEW_FILE "Ship-ready" line == "YES"),
        review_p1_count:         count of "P1" / "P1:" lines in ref's $REVIEW_FILE,
        amendment_log_summary:   summarize ref's $LLD_FILE § Amendment Log,
        # Subagent-only fields null in fallback mode:
        structural_patterns:     null,
        verifiable_signals:      null,
        test_patterns:           null,
        ac_mapping:              null,
        pr_diff_available:       false,
        pr_url:                  null,
      }
      {pattern_cache_path} = null
```

**Image source identification** (combined across sources, cap 3):

Identify DESCRIPTORS of available images — do NOT fetch the image bytes yet. Fetching + analysis is delegated to the image-analysis subagent (see below) so the image data stays out of the orchestrator's transcript.

```
{image_sources} = { trigger_attachments: [], jira_attachments: [], figma_urls: [] }
{total_available} = 0

# UPDATED scope gate (v17 — auto-classify image intent regardless of UI scope):
# Earlier versions silently skipped ALL image aggregation when scope.ui_involved == false,
# which lost architecture diagrams, ER diagrams, and rough sketches on backend-only
# tickets. The image-analysis subagent now classifies each image's intent first
# (Step 2.7) and dispatches to the right extraction schema. Only DOCS-ONLY tickets
# with no useful diagrams should fully skip image work.
IF scope.docs_only == true AND NOT (scope.ui_involved OR scope.backend_involved):
  {visual_spec} = null
  Note in Cross-Reference Findings:
    "Image analysis skipped — scope.docs_only = true (rationale: {scope.rationale})."
  Proceed to the Image analysis routing block below with {total_available} = 0
  (which takes the no-op branch).
ELSE:
  # For ticket where scope.ui_involved=true AND/OR scope.backend_involved=true,
  # collect images and let the subagent classify+extract. The subagent's
  # Step 2.7 (classify_image_intent) decides per-image whether each is a
  # ui_mockup, architecture diagram, rough sketch, or data sample. The user
  # never has to label images.
  1. TRIGGER attachments:
     FOR each image attached to the trigger message:
       {image_sources}.trigger_attachments.append({path: <harness-provided path>})
       {total_available} += 1

  2. JIRA ATTACHMENTS (list only — subagent fetches via Atlassian MCP):
     IF atlassian_available:
       FOR each attachment on the current ticket with image MIME type:
         {image_sources}.jira_attachments.append({filename: ..., attachment_id: ...})
         {total_available} += 1

  3. FIGMA URLs (list only — subagent fetches via Figma MCP if available):
     Extract Figma URLs from JIRA description + custom fields.
     FOR each Figma URL:
       {image_sources}.figma_urls.append({url: ...})
       {total_available} += 1

  IF {total_available} > 3:
    Note to pass to subagent: "More than 3 images available — will use first 3."
```

**Image analysis — delegated OR inline, based on count:**

The subagent has a ~14K base-load floor (kernel rules + system overhead). For tickets with a single image, inline analysis is cheaper. Route based on `{total_available}`:

```
IF {total_available} == 0:
  # No image sources — no subagent invocation, no inline work.
  {visual_spec} = null

ELIF {total_available} == 1:
  # Single image — analyze inline. Subagent overhead would outweigh the savings.
  Fetch the one image:
    IF trigger_attachments: read local path
    ELIF jira_attachments AND atlassian_available: fetch via Atlassian MCP
    ELIF figma_urls AND figma_available: fetch frame via Figma MCP
    ELSE: skip (MCP unavailable for the only source); record figma_urls_unfetched if Figma

  Run structured extraction on the single image:
    elements: [{type, label, variant, state, position}, ...]
    states_observed: [...]
    visible_text: [top 5]
    layout_kind: list-page | detail-page | modal | ...
  Match element.type against shared_paths.frontend.ui_elements[*].provides[].
  Build {visual_spec} = {layout_summary, images: [one entry], summary}.
  (Cross-reference with ACs deferred until A.5.)

ELSE:  # {total_available} >= 2 — subagent wins
  design_folder = resolve_design_folder(TICKET_ID, EPIC_ID)
    # nested layout: contexts/{epic}/{TICKET}-design/
    # flat layout:   contexts/{TICKET}-design/
    # uses runtime.contexts_layout.design_folder_name + nested_by_epic
  ensure_dir(design_folder)

  Invoke subagent `subagent-image-analysis` (via Task tool) with:
    ticket_id: {TICKET_ID}
    mcp_status: {atlassian_available, figma_available}
    sources: {image_sources}
    max_images: 3
    design_folder: {design_folder}        # subagent writes fetched bytes here
    scope:                                # NEW — used by Step 2.7 as MEDIUM-confidence tiebreaker
      ui_involved:      {scope.ui_involved}
      backend_involved: {scope.backend_involved}
      docs_only:        {scope.docs_only}
    intent_overrides: {}                  # NEW — empty on first run; populated on re-invoke after A.5 picker

  Subagent returns:
    {visual_spec}               — compact, ≤ 2500 tokens. Each image entry
                                  carries `file_path` pointing at its persisted
                                  copy in {design_folder}.
    {figma_urls_unfetched}      — if Figma MCP was unavailable
    {figma_urls_low_quality}    — frames that failed the Step 2.5 quality gate
    {warnings}                  — truncation / partial-failure notes

  Store {visual_spec} (cross-reference with ACs deferred until A.5).
  Surface any {warnings} in the A.5c Cross-Reference Findings section.

  Write a short {design_folder}/README.md auto-index that lists each persisted
  file with its source (trigger / jira-attachment / figma), the frame/URL it
  came from, and which layout_tree node IDs it contributes to. This is what
  the user opens first when confirming the design at the A.5 checkpoint.
```

**Inline path (1-image case)** also persists to `design_folder` with the same file_path emission — the persistence rule is identical; only the extraction location (inline in orchestrator vs. in the subagent) differs.

**Routing decision — token math:**

| `{total_available}` | Path | Reason |
|---|---|---|
| 0 | skip | nothing to do |
| 1 | inline | 1 image ≈ 5-8K inline vs 15K subagent floor → inline is ~7-10K cheaper |
| 2 | subagent | 2 images ≈ 10-15K inline vs 15K subagent → break-even or small win |
| 3 | subagent | 3 images ≈ 20-25K inline vs 15K subagent → clean win (~10K saved) |

**Why a subagent:** raw image data + per-image extraction prompts can be 15-25K tokens that the orchestrator never needs after A.5/B.3 consume the structured `{visual_spec}`. Delegating keeps that out of the main transcript. The subagent loads only `pipeline.yaml` + `pipeline.{PACK}.analyzer.yaml` (for `shared_paths` component matching) — no ticket schema, no LLD skills. See `agent-pipeline/agents/subagent-image-analysis.md` for its contract.

**Configured at:** `subagents.orchestrator_image_analysis` in `pipeline.yaml` (see `subagent-image-analysis.md` for invocation contract).

**Silent success condition:**

If no reference_ticket, no images, and no mcp_status signals, this step completes silently. Existing pipeline flow is untouched.

**Emit an enrichment summary line to the Active Context block** (if already rendered, append one line after it):

```
↳ Enrichment: reference={REF_TICKET or "none"} · images={N} ({sources}) · mcp={status}
```

---

## Phase: freshness_check (A.0.5, v19)

**Runs AFTER context load (A0) but BEFORE ticket parse (A).** Checks whether the project-map sections this ticket will depend on are fresh; optionally runs a targeted rescan before generating the LLD.

### Why this phase exists

Without it, a ticket referencing `BulkActionService.java` would use whatever § 4 (Java Services) says — even if another team added methods to that service last week and didn't rescan. Orchestrator would generate REUSE tasks against the old API; Surgeon would write code for methods that aren't there the way the map says; Review would catch it only after build failure. Tokens + time wasted.

freshness_check (A.0.5) closes this gap by detecting stale scope per-ticket and offering a targeted rescan before LLD generation. Rescan cost (30s-2min for narrow scope) is an order of magnitude cheaper than the cost of generating an LLD against a stale map.

### Step: check_enabled (A.0.5a)

```bash
FRESHNESS_ENABLED=$(yaml_get rescan_hints.freshness_check.enabled)    # default: true
IF not enabled: skip entirely, proceed to understand_ticket (A)
```

### Step: global_freshness_gate (A.0.5b)

Before doing any per-ticket extraction, check if a recent global rescan makes per-ticket checks unnecessary:

```
MIN_RECENT_DAYS = yaml_get rescan_hints.freshness_check.global_recent_rescan_days   # default: 7

Read contexts/project-map.md rescan_log:
  Find the most recent `Analyze project` or `Rescan project` entry
  IF that entry's date is within MIN_RECENT_DAYS:
    → Skip freshness_check (A.0.5) entirely. Map is globally fresh.
    → Emit info: "Global freshness check passed — full rescan within last {N} days"
    → Proceed to understand_ticket (A)
```

This prevents nagging teams that just rescanned everything.

### Step: extract_scope (A.0.5c)

Extract scope SIGNALS from the JIRA ticket body, Description, and AC list. CONSERVATIVE means: only things the ticket EXPLICITLY names. Don't fuzzy-match feature names to files.

```
SIGNALS to extract (regex + NLP-lite heuristics):
  1. File references       — .java / .js / .ts / .py / .html / .xhtml filenames mentioned
  2. Class references      — CapitalizedWord + "Service" | "Resource" | "Controller" | "Factory"
  3. Endpoint references   — /rest/... or /api/... path patterns
  4. Component references  — kebab-case identifiers matching component_naming.prefix
                             (e.g. sp-*)
  5. Explicit module refs  — package names (e.g. "{domain}.web.rest", "backend.services")

DO NOT extract:
  - Generic feature names ("certification flow", "user management")
  - Vague verbs ("fix the export", "improve performance")
  - Figma component names (unless they match component_naming.prefix)

Rationale: conservative extraction misses less than it catches wrong. Users can
expand via the gate.
```

**If extraction yields 0 signals → skip freshness_check (A.0.5).** Nothing to check against.

**If extraction yields < `rescan_hints.freshness_check.min_files_to_check` signals (default 3) → skip freshness_check (A.0.5).** Ticket is too trivial to warrant freshness check overhead.

### Step: rank_candidates (A.0.5d)

```
For each extracted signal, compute CONFIDENCE:
  HIGH   — signal matches a unique project-map entry (e.g. "BulkActionService"
           matches exactly one § 4 entry)
  MEDIUM — signal matches multiple entries, top match has strong token overlap
  LOW    — signal matches no entries OR is ambiguous (e.g. "/rest/ui/*" is a pattern)

Rank all signals by confidence descending.
Take top 3 for display.
Store the full ranked list — user can expand to see more.
```

### Step: check_staleness (A.0.5e)

For each of the top 3 candidates:

```
FOR candidate in top_3:
  target_section = map_signal_to_section(candidate)
    # Examples:
    #   BulkActionService.java  → § 4 entry for that file
    #   /rest/ui/bulk            → § 6 entry for that endpoint
    #   sp-reviewer-selector     → § 3 entry for that component
    #   {domain}.web.rest        → § 5 (all endpoints in that package)

  # Freshness check — two signals
  last_rescan_of_section = lookup in rescan_log
  days_since = today - last_rescan_of_section.date

  git_churn_in_scope = git log --after={last_rescan_date} --name-only -- {scope_paths} | wc -l

  STALE_DAYS = yaml_get rescan_hints.freshness_check.stale_threshold_days       # default: 30
  STALE_FILES = yaml_get rescan_hints.freshness_check.stale_threshold_file_count # default: 10

  IF days_since >= STALE_DAYS OR git_churn_in_scope >= STALE_FILES:
    mark candidate as STALE
  ELSE:
    mark candidate as CURRENT
```

### Step: render_gate (A.0.5f)

**If all candidates are CURRENT → skip gate, proceed to understand_ticket (A).** No freshness issue detected.

**If at least one is STALE:**

```markdown
## 🕐 Ticket-Scope Freshness Check

Ticket scope (top 3 candidates extracted from ticket):
  1. BulkActionService.java              → § 4 (Java Services)
     Freshness: ⚠ STALE — last rescan 48 days ago, 42 files changed in scope
  2. /rest/ui/certifications/reassign    → § 6 (REST Endpoints)
     Freshness: ✓ CURRENT (rescan 9 days ago, 2 files changed)
  3. feature page ({frontend_path}/feature/featureList.{ext})  → § 3 + § 6-enh
     Freshness: ✓ CURRENT (rescan 4 days ago)

Suggested pre-flight rescan (narrow scope, ~45 seconds):
  Rescan Java/Services   (refreshes § 4 only)

> 👉 Pick one (default: `Rescan`):
>   - Rescan              ← DEFAULT — press Enter to refresh the stale scope
>   - Proceed as-is       — skip rescan, use current (possibly stale) map
>   - Proceed + flag      — note staleness in Cross-Reference Findings for review
>   - Expand scope        — show more scope candidates (top 3 is conservative default)
>   - Skip freshness      — mark this ticket "no freshness needed" (rare)
```

**On `Rescan` (default):**
1. Run the proposed targeted rescan (e.g. `Rescan Java/Services`)
2. Wait for completion + apply diff
3. Log `A.0.5 rescan: {scope}, {duration}, {changes}` to the ticket's manifest
4. Proceed to understand_ticket (A) with refreshed map

**On `Proceed as-is`:**
1. No rescan. Record decision in ticket manifest.
2. Proceed to understand_ticket (A) with current map.

**On `Proceed + flag`:**
1. No rescan, but record STALE scope items in PART 1 § Cross-Reference Findings.
2. Review (Step 4/5) will surface these as a warning: "LLD generated against stale project-map for {scope}. Surgeon's implementation may diverge from current code. Consider: `Rescan {scope}` before shipping."

**On `Expand scope`:**
Show the full ranked candidate list (all confidence levels, not just top 3). User checkbox-selects which to include. Recomputed gate re-renders.

**On `Skip freshness`:**
Record `freshness_skipped: true` in the ticket manifest. freshness_check (A.0.5) won't re-run for this ticket if user returns to the gate. Useful for tickets where the user KNOWS the map is current for that specific scope.

### Step: no_overhead_when_fresh (A.0.5g — note)

Emphasis — the most common case (map mostly fresh) has zero friction:

- Step A.0.5b — global check — if last full rescan within 7 days, entirely skipped
- Step A.0.5c — if ticket has no file signals (common for bug tickets or feature-name-only stories), skipped
- Step A.0.5d-e — if all candidates are CURRENT, no gate rendered

User only sees the gate when:
- Global rescan was > 7 days ago
- Ticket explicitly names files/endpoints/classes/components
- At least one of those scope items has stale data

In a team doing weekly quick rescans + regular pipeline work, this is rare. In a team running quarterly rescans only, this is common — which is exactly when they need the gate most.

### Step: config_knobs (A.0.5h — reference)

All thresholds live in `pipeline.yaml.rescan_hints.freshness_check`:

```yaml
rescan_hints:
  freshness_check:
    enabled: true                       # master toggle
    min_files_to_check: 3               # skip if < N signals extracted
    global_recent_rescan_days: 7        # skip if full rescan within last N days
    stale_threshold_days: 30            # per-section staleness threshold
    stale_threshold_file_count: 10      # drift count triggering stale
    top_n_candidates: 3                 # how many candidates to display by default
    default_action: "rescan"            # "rescan" | "proceed" | "flag"
```

Teams can disable entirely (`enabled: false`), be more conservative (`stale_threshold_days: 60`), or default to proceed-without-rescan for tickets where they trust their process (`default_action: "proceed"`).

### Step: explorer_counterpart (A.0.5i — cross-ref)

Explorer's Step 0c (new) does a smaller, file-level freshness check. Not a full gate — just a quiet note:

```
FOR each file named in LLD's PART 2 tasks:
  Look up in project-map (§ 3/4/6/10c depending on file type)
  IF entry exists but git log shows modifications since last_scanned:
    → Mark entry as STALE in exploration.md
    → Note: "Re-read {file} before trusting map entry — modified since last rescan"

No user gate — just a metadata flag that downstream agents (Surgeon, Review)
respect. If Surgeon sees a STALE flag on a file, it re-reads that file fully
instead of trusting the insertion point from the map.
```

This keeps Explorer lean — the gate is Orchestrator's responsibility; Explorer's freshness is silent invalidation markers.

---

## Phase: understand_ticket (A, Schema-Driven Full Ticket Parse)

### Step: mode_detection (A.1 — already determined in load_context)

The ticket type was read in load_context (A0) to load the correct schema. Now route:
- `Story`/`Task`/`Spike` → **Story Mode** (continue to Step A.2 below)
- `Bug` → **Bug Mode** (schema already loaded, skip to synthesize_bug_context (B-Bug) below)
  - Check parent link: parent is Story/Task/Spike → **Sub-Bug Mode**
  - All other parents (none, Bug, Epic) → **Standalone Bug Mode**
- Other → ask user

### Step: full_ticket_parse (A.2 — driven by Ticket Schema skill)

**The schema skill defines EVERY section to read and HOW to parse each one.** Follow its Section Map in order. Section count is pack-specific (a typical story schema has 10-15 sections).

The schema skill produces a structured output with these components:

1. **Key Details** — all JIRA header fields (ID, type, status, priority, assignee, sprint, points, labels, components, fix version, epic link, created, updated). Flag empty fields.

2. **Description Parse** — structured buckets: Business Context, Requirements, Technical Notes, Out of Scope, Links, Ambiguities. Detect embedded sections (User Story / In Scope / Assumptions within Description).

3. **User Story** — role, goal, benefit per `As a / I want / So that`. Multiple user stories → multiple use cases.

4. **Scope** — In-scope items (MUST be covered by tasks), Out-of-scope items (MUST NOT be). Flag AC ↔ scope conflicts.

5. **Assumptions** — classify (data, permission, API, browser, dependency). Check for contradictions with ACs. Record as task constraints.

6. **UI/UX Design Links** — all design URLs. Check accessibility, identify components + states, map to ACs, detect design ↔ AC conflicts.

7. **Acceptance Criteria** — the most critical section. Schema skill defines format detection (Given/When/Then, numbered, bullets, table, prose, checkboxes) and parse procedure:
   - For Given/When/Then: extract precondition, trigger, outcome per AC
   - Classify type (PERMISSION, NAVIGATION, INTERACTION, UI, DATA, VALIDATION, INTEGRATION)
   - Check for compound Then clauses → SPLIT into sub-ACs
   - Check for attachment references → link AC to attachment
   - Assess testability (TESTABLE / VAGUE / INCOMPLETE)

8. **Attachments** — inventory all. Classify (screenshot, video, doc, design, spreadsheet). Map to ACs. Flag unreferenced attachments — may contain hidden requirements.

9. **Release Notes** — extract. Validate that ACs deliver the stated user-facing value.

10. **Documentation Notes** — extract. Add doc task if changes needed.

11. **ServiceNow URL** — extract as background context.

12. **Subtasks** (AC-support only — NOT a task source) — list with ID, title, status. Use to VALIDATE your understanding of ACs. If a subtask reveals a missing AC → derive the AC first. Do NOT create tasks from subtasks directly.

13. **Linked Work Items** — build Link Map:
    - Blockers → check status (risk if not done)
    - Parent Epic → fetch for HLD
    - Related stories → fetch LLDs
    - Cloned from → prior decisions/rejections
    - Split from → what's NOT in scope

14. **Comments** (AC-support only — NOT a task source) — last 20, classified:
    - AC CLARIFICATION / AC DECISION → refines HOW an AC is implemented (constrains tasks)
    - AC SCOPE CHANGE → extends/narrows an AC (modifies the AC in registry)
    - UNANSWERED QUESTION → flag as gap
    - PROCESS → skip
    Comments REFINE ACs, they don't independently create tasks.

### Step: derive_implicit_acs (A.3)

After parsing ALL sections, check for gaps:
- In-scope items not covered by any AC → derive AC
- Assumptions implying unstated requirements → derive AC
- Attachments showing UI not in ACs → derive AC
- Description requirements not reflected in ACs → derive AC
- Design link showing components not in ACs → derive AC

Mark all as `DERIVED` with source citation. Present at checkpoint.

### Step: parent_and_sibling_context (A.4 — token-efficient)

**Read `$EPIC_CONTEXT` first — NOT individual sibling LLDs.**

**A.4a: Check for epic-context.md**
```bash
ls $EPIC_CONTEXT 2>/dev/null
```

**If exists (subsequent story — fast path):**
```
Read $EPIC_CONTEXT → parse into two data structures:

STRUCTURE 1: Knowledge (for Requirement Summary)
  - Coverage header (OPTIONAL — present on v25+ files, absent on legacy):
      HLD count, SPIKE count, stories N-of-M breakdown by Source, drift state.
      If absent, skip; A.4a-bis will write it on next drift run.
  - HLD summary (what the epic is about)
  - Architecture decisions (what was decided)
  - Spike findings (if any POCs/research)
  - Story log: WHAT each prior story built + decided + discovered

STRUCTURE 2: File Existence Map (for synthesize_lld step B.3 task decomposition)
  FOR each story entry in the log, extract the "Files:" section:
    CREATED: lines → add to FILE_EXISTS as { status: "CREATED", by: ticket, reusable: true }
    MODIFIED: lines → add to FILE_EXISTS as { status: "MODIFIED", by: ticket }
    CONFIG: lines → add to FILE_EXISTS as { status: "CONFIG", by: ticket }

  Also extract per-story:
    Source: → SOURCES[ticket] = source string (OPTIONAL — v25+; absent ⇒ "pipeline-review" assumed)
             Values: "pipeline-review", "auto-hydrated A.4a-bis (date, bucket=X)", "user-reference"
    Pattern: → PATTERNS[ticket] = pattern string
    Decision: → DECISIONS[ticket] = decision string
    Constraint: → CONSTRAINTS[ticket] = constraint string
    Reusable: → REUSABLES[ticket] = reusable list

Result: FILE_EXISTS, SOURCES, PATTERNS, DECISIONS, CONSTRAINTS, REUSABLES maps
         (used in synthesize_lld step B.3 to build tasks with correct action type;
          SOURCES feeds A.4a-bis Coverage header rebuild)

This replaces: fetching 5+ sibling LLDs from Confluence (saves ~10K-25K tokens)

If a specific prior story needs MORE detail than the epic-context entry:
  → Read the LOCAL full LLD: $CONTEXT_DIR/{SIBLING_TICKET}.md
  → Read ONLY the specific PART needed (PART 1 for design, PART 2 for tasks)
  → Don't read the whole 4-part document
```

**A.4a-bis: detect_sibling_drift (subsequent-story flow ONLY — verify epic-context isn't stale)**

After reading `$EPIC_CONTEXT` and BEFORE git history analysis (A.4f), verify the local story log isn't stale relative to JIRA. This catches the gap where a sibling story shipped (in JIRA) but Review didn't update `epic-context.md` — either Review crashed, was skipped, the sibling was shipped before this epic was structured, or you simply haven't pulled recent commits.

**Cost:** ~1-2K tokens for the JIRA query (one MCP call). Skipped entirely if `atlassian_available == false` (no network, MCP misconfigured) — in that case proceed to A.4f silently.

```
IF atlassian_available:
  # Read the status groups from pipeline config (jira.status_groups).
  # Four buckets with distinct downstream semantics:
  #
  #   active_hydrate   — warn + pull LLD into epic-context on the fly
  #   active_flag_only — warn only (content too volatile to read)
  #   completed        — pull LLD + suggest `git pull` for code
  #   (everything else) — implicitly skipped
  #
  # Four-tier fallback (most-specific → least-specific):
  #   (1) jira.status_groups.{active_hydrate, active_flag_only, completed} declared
  #   (2) legacy single `active:` bucket → treat as active_flag_only (no hydration)
  #   (3) legacy jira.active_states (pre-v24) → treat as active_flag_only
  #   (4) nothing declared → synthesize from status_map + "Done"
  groups = yaml_get jira.status_groups
  active_hydrate   = (groups?.active_hydrate) OR []
  active_flag_only = (groups?.active_flag_only) OR (groups?.active) OR
                     (yaml_get jira.active_states) OR [
                       yaml_get jira.status_map.in_development,
                       yaml_get jira.status_map.review_done,
                       yaml_get jira.status_map.ship_done,
                     ]
  completed        = (groups?.completed) OR ["Done"]

  # Derived sets for downstream decisions
  hydrate_states = distinct(active_hydrate + completed)   # → fetch LLD
  flag_states    = active_flag_only                        # → warn only
  query_states   = distinct(hydrate_states + flag_states)  # → JQL filter

  # Build JQL: single-quote each status name (JQL requires quotes around
  # values containing spaces). Comma-separate.
  status_clause = "status in (" + join(", ", [quote(s) for s in query_states]) + ")"

  # Query JIRA for child stories under this epic in any of the relevant states
  jira_children = atlassian_mcp.search(
    jql: "parent = {EPIC_ID} AND " + status_clause,
    fields: [id, summary, status, updated]
  )

  # Bucket each child by their JIRA status. child.bucket is IMMUTABLE once set
  # here — it reflects the JIRA-status bucket truth and is what Explorer reads
  # later. Rendering/hydration outcomes live in separate fields (has_lld).
  FOR each child in jira_children:
    IF child.status IN active_hydrate:
      child.bucket = "active_hydrate"   # in-flight + stable → warn + hydrate
    ELIF child.status IN active_flag_only:
      child.bucket = "active_flag_only" # in-flight + volatile → warn only
    ELIF child.status IN completed:
      child.bucket = "completed"        # shipped → warn + hydrate + git pull
    ELSE:
      child.bucket = "unknown"          # edge case — JQL already filtered
    child.has_lld = false               # set below in hydration loop if fetched

  # Extract IDs from epic-context's story log (parsed in the subsequent-story block above)
  local_story_ids = { entry.ticket_id for entry in epic_context.story_log }

  # Find sibling stories in JIRA that are NOT in local epic-context (excluding this ticket itself).
  missing = [s for s in jira_children if s.id not in local_story_ids and s.id != {TICKET_ID}]
  missing_hydrate_candidates   = [s for s in missing if s.bucket == "active_hydrate"]
  missing_flag_only            = [s for s in missing if s.bucket == "active_flag_only"]
  missing_completed_candidates = [s for s in missing if s.bucket == "completed"]

  # ─── LLD hydration (active_hydrate ∪ completed) ─────────────────────────
  # For each missing sibling whose bucket warrants hydration, pull its LLD
  # from Confluence. If no Confluence page exists, mark has_lld=false and let
  # rendering route it to a "no LLD available" section. DO NOT mutate bucket —
  # Explorer needs the JIRA-status truth to make the right scan-depth choice
  # (a completed-no-LLD sibling should still be skipped by Explorer, not
  # shallow-scanned, because its code is merged).
  #
  # Cost: ~1K tokens per sibling LLD (bounded by active_hydrate/completed
  # membership — typically ≤5 siblings per drift event).

  FOR each sibling in (missing_hydrate_candidates + missing_completed_candidates):
    lld_page = atlassian_mcp.confluence_search(
      query: "{sibling.id} LLD",
      space: (yaml_get docs.confluence_space) OR "*",
      limit: 1
    )
    IF lld_page found:
      summary = extract_compact_summary(lld_page)  # ~300 tokens: title, goal, file touches, key ACs
      # Write row with Source marker for provenance (~10 tokens overhead per row)
      append_to_epic_context(sibling.id, sibling.status, summary,
                             source="auto-hydrated A.4a-bis ({today}, bucket={sibling.bucket})")
      sibling.has_lld = true
    # ELSE: has_lld stays false; rendering will surface in "no LLD available" section

  # Four render categories based on (bucket, has_lld):
  rendered_hydrate_ok     = [s for s in missing_hydrate_candidates   if s.has_lld]
  rendered_completed_ok   = [s for s in missing_completed_candidates if s.has_lld]
  rendered_completed_nolld= [s for s in missing_completed_candidates if not s.has_lld]
  rendered_flag_only      = missing_flag_only
                            + [s for s in missing_hydrate_candidates if not s.has_lld]
  # (active_hydrate without an LLD slips to flag_only rendering — still in-flight)
  # (completed without an LLD gets its own "shipped — no LLD" section)

  # ─── Coverage header (write on every drift run — idempotent) ──────────
  # Single ~60-token block at the top of epic-context.md summarizing:
  #   - HLD / SPIKE doc count (from existing sections)
  #   - Story coverage: N of M, broken down by Source
  #   - Not-covered count (implicit-skip statuses)
  #   - Drift state + timestamp (last check)
  # This replaces any existing `## Coverage` block (find-and-replace by
  # heading). Back-compat: first run creates it; old files without it
  # still parse (A.4a tolerates missing header).

  total_children       = len(jira_children)  # from JQL query; excludes implicit-skip
  implicit_skip_count  = max(0, len(all_epic_children) - total_children)
                         # if you separately queried "all children", else 0
  stories_by_source    = count_by_source(epic_context.story_log)
                         # dict: {"pipeline-review": N, "auto-hydrated": M, "user-reference": K}
  hld_count            = count_hld_sections(epic_context)     # usually 1
  spike_count          = count_spike_sections(epic_context)   # 0+
  drift_state          = "in sync" IF missing is empty ELSE "{N} sibling(s) missing"

  # Build compact bucket map for Explorer's scan_inflight_siblings step.
  # Explorer runs locally with no MCP; it needs to know each sibling's JIRA
  # bucket to decide scan depth (deep / shallow / skip). Keys are ticket IDs,
  # values are bucket names — ~15 tokens per 10 siblings.
  sibling_buckets = {}
  FOR each child in jira_children:
    IF child.id != {TICKET_ID}:
      sibling_buckets[child.id] = child.bucket  # "active_hydrate" | "active_flag_only" | "completed"

  # Persist at top of active-context file (below the Active Context block)
  # so Explorer can read it without re-querying JIRA. Back-compat: absent on
  # pre-v25 files → Explorer falls back to scan-all behavior.
  write_to_active_context_file({
    "sibling_buckets": sibling_buckets,
    "buckets_synced_at": {today},
  })

  coverage_block = render("""
    ## Coverage (last synced {today} by {TICKET_ID})

    - HLD:          {hld_count} page(s)
    - SPIKE docs:   {spike_count} page(s)
    - Stories:      {local_count} of {total_children} ({sources_breakdown})
    - Not covered:  {implicit_skip_count} (backlog/grooming — implicit skip)
    - Drift state:  {drift_state}
  """)
  replace_or_prepend_section(epic_context, "## Coverage", coverage_block)

  IF missing is empty:
    # ✓ Silent success — epic-context is in sync with JIRA. Proceed to A.4f.
    Note in Active Context block: "↳ Sibling drift check: in sync ({N} siblings)"

  ELSE:
    # ⚠ Drift detected — split by bucket; each bucket has different semantics
    Render to chat:

    ⚠ Sibling drift detected — {N} stories under {EPIC_ID} are missing from epic-context.md.

    IF rendered_hydrate_ok is non-empty:
      **In flight — hydrated** (LLD pulled into epic-context; coordinate with author before edits):
        - {s.id} ({s.status}, updated {s.updated}): {s.summary}  ✓ LLD hydrated
        [...]

    IF rendered_completed_ok is non-empty:
      **Already shipped — hydrated** (LLD pulled into epic-context; `git pull` for the code):
        - {s.id} ({s.status}, updated {s.updated}): {s.summary}  ✓ LLD hydrated
        [...]

    IF rendered_completed_nolld is non-empty:
      **Already shipped — no LLD available** (code in repo; no Confluence page — merged via regular PR):
        - {s.id} ({s.status}, updated {s.updated}): {s.summary}  (inspect commits via `git log` or Explorer's codebase-map sync)
        [...]

    IF rendered_flag_only is non-empty:
      **In flight — flag only** (LLD not hydrated; content too volatile or no Confluence page):
        - {s.id} ({s.status}, updated {s.updated}): {s.summary}
        [...]

    Likely causes:
      - **Hydrated siblings:** their LLD is now inline in epic-context.md — re-read if
        Surgeon's task list might overlap. Explorer's scan_inflight_siblings will also
        flag any branch/file overlap.
      - **Flag-only siblings:** a teammate is mid-implementation; content isn't stable
        enough to read. Coordinate directly before your Phase B lands.
      - **Shipped — hydrated:** code is in the repo AND design is captured — `git pull` and re-read.
      - **Shipped — no LLD:** a non-pipeline sibling merged without a design doc. Code is in
        the repo (`git pull`), but intent lives only in commit messages. Inspect via git log or
        consider referencing the ticket (`— reference: {ID}`) so Orchestrator fetches the PR
        description as a fallback design signal.

    > 👉 Pick one (default: `Continue with gaps`):
    >   1. `Pull and re-run`        — exit cleanly; user runs `git pull`, then re-triggers
    >                                  (best when 'Already shipped' siblings were missed)
    >   2. `Continue with gaps`     — proceed; hydrated LLDs are already in context
    >   3. `Reference {ID}, {ID}`   — re-trigger: `Work on {TICKET_ID} — reference: {IDs}`
    >                                  (best for pattern-alignment with shipped siblings)
    >   4. `Rebuild epic-context`   — delete contexts/{epic}/epic-context.md and re-run
    >                                 (falls into first-story flow, rebuilds from JIRA + Confluence)

  # Record decision in $CONTEXTS_FILE Cross-Reference Findings:
  IF user picks `Pull and re-run`:        Exit cleanly. No artifacts written.
  IF user picks `Continue with gaps`:     Proceed to A.4f. Add to Cross-Reference Findings:
                                          "⚠ Proceeded with hydrated siblings {hydrated_ids}
                                           inlined; flag-only siblings {flag_only_ids} not
                                           hydrated — user accepted coordination risk."
  IF user picks `Reference {IDs}`:        Exit; user re-triggers with explicit references.
  IF user picks `Rebuild epic-context`:   Delete the file. Re-trigger; A.4a will route to
                                          first-story flow (A.4b–A.4e) which queries JIRA fully.

ELSE:
  # Atlassian MCP unavailable — drift check not possible.
  Note: "↳ Sibling drift check: skipped (Atlassian MCP unavailable)"
  Proceed to A.4f.
```

**Why this step exists:** The subsequent-story fast path (above) trusts `epic-context.md` as the source of truth for what siblings exist. If Review didn't update it (process bug, crashed Review, side-loaded ticket), the orchestrator silently misses sibling work and the LLD generated in Phase B may duplicate already-shipped tasks. This step costs ~1-2K to detect that drift before it becomes a much more expensive Surgeon/Review cycle.

**Why it's only in subsequent-story flow:** First-story flow already runs A.4b (JIRA query for children) inline — adding this would duplicate that work. First-story flow has no epic-context to compare against anyway.

**If NOT exists (first story — create it):**

Preferred path: delegate the epic + sibling + Confluence fetch to the `epic-context`
subagent. It returns a compact `epic_context` YAML block (epic summary, siblings,
Confluence page summaries, decisions, constraints) and caches at
`contexts/<EPIC_ID>/_cache/epic-context.yaml` for the next story in the same epic.
Falls back to the inline A.4b–A.4e block below if the subagent returns `error`.

```
# ─── Preferred: subagent invocation ───────────────────────────────────────
{subagent_result} = Task tool invocation:
  subagent_type: "epic-context"
  description:   "Fetch epic + siblings + Confluence for {EPIC_ID}"
  prompt:        |
    ```yaml
    ticket_id: {TICKET_ID}
    epic_id: {EPIC_ID}
    depth: siblings+confluence
    role_resolution:
      story_source: {{ mcp: {role_resolution.story_source.mcp}, reason: "..." }}
      docs_source:  {{ mcp: {role_resolution.docs_source.mcp},  reason: "..." }}
    cache_ttl_hours: 24
    sibling_max: 8
    confluence_max: 4
    ```

Parse {subagent_result} as YAML (validate schema_version == 1).

IF {subagent_result}.status in [ok, partial]:
  ec = {subagent_result}.epic_context

  # Map subagent fields onto the $EPIC_CONTEXT structure that subsequent-story
  # flow (A.4a STRUCTURE 1) expects. The field names below match the markdown
  # sections produced when $EPIC_CONTEXT is rendered to disk.
  Create $EPIC_CONTEXT with:
    - Epic metadata:
        id:           ec.epic_id
        title:        ec.epic_title
        url:          ec.epic_url
        status:       ec.epic_status
        fix_version:  ec.epic_fix_version
        created_by:   <orchestrator name + date> (subagent doesn't track this)
    - HLD summary:           ec.epic_summary
                              + (if any confluence_pages: concat their summaries
                                 under a "Confluence HLD" subsection — each page
                                 keeps its own title + URL for traceability)
    - Architecture decisions: ec.cross_cutting_signals.decisions
                              + per-page explicit_decisions from ec.confluence_pages[*]
    - Spike findings:         <derive from ec.related_tickets[] where issue_type == "Spike"
                                — subagent surfaces the spike summary line; if more
                                detail is needed, A.5a self-heal pass fetches the full
                                spike ticket later>
    - Constraints:            ec.cross_cutting_signals.constraints
    - Out of scope:           ec.cross_cutting_signals.out_of_scope
    - Story log:              <empty — Ship will populate after this story completes;
                                ec.related_tickets[] is captured separately under a
                                "Related (open at fetch time)" header for context only,
                                NOT as the story log — Ship is the authoritative writer>

  IF {subagent_result}.status == "partial":
    Append to Cross-Reference Findings:
      "Epic context partial: {subagent_result.reason}.
       Proceeding with available signals; Confluence/sibling coverage may be incomplete."

  Note: A.4f (git history) + A.4g (codebase map) below still run — they're
        independent of the JIRA/Confluence fetch.

ELSE:  # status == "error"
  Append to Cross-Reference Findings:
    "Epic-context subagent failed: {subagent_result.reason}.
     Falling back to inline epic/Confluence fetch."

  # ─── Inline fallback (original A.4b–A.4e flow) ────────────────────────
  A.4b: JIRA → get parent epic ID, child stories filtered by status
  A.4c: Confluence → fetch HLD (1 search by epic ID) → extract key decisions
  A.4d: Confluence → check for Spike docs under this epic → extract findings
  A.4e: DO NOT fetch sibling LLDs from Confluence (there are none yet, or they'll
        be captured by Ship as stories complete)

  Create $EPIC_CONTEXT with:
    - Epic metadata (ID, title, created_by, date)
    - HLD summary (2-3 sentences, not the full HLD)
    - Spike findings (if any)
    - Architecture decisions (from HLD)
    - Empty story log (Ship will populate after this story completes)
```

**Why the subagent path is preferred:**

| Source | Raw token cost (inline) | Compact-out token cost (subagent) |
|---|---|---|
| Epic JIRA body | 3–8K | included in ec.epic_summary (≤200 words) |
| 8 sibling tickets | 8–24K | ec.related_tickets[] (≤8 × ≤30 words) |
| 4 Confluence pages | 20–80K | ec.confluence_pages[] (≤4 × ≤200-word summary) |
| **Total** | **31–112K in orchestrator's transcript** | **≤3K + cached** |

Plus: cached at `contexts/<EPIC_ID>/_cache/epic-context.yaml` — story 2 of the same epic hits the cache for ~$0 (the subagent returns the cached YAML directly).

**A.4f: Git history analysis** (always, regardless of epic-context existence):
```bash
git log --all --name-only --grep="{SIBLING_ID}" --since="6 months ago" -- .
git log {base_branch} --oneline --since="3 months ago" -- {relevant_paths}
```
Git history is cheap (~500 tokens) and shows what files ACTUALLY changed.

**A.4g: Codebase map** — read `$CODEBASE_MAP` metadata + conventions only (not file entries).

**Token comparison for story 6 in a 10-story epic:**
```
OLD: Fetch 5 LLDs from Confluence    = ~15,000 tokens (may fail)
NEW: Read epic-context.md            = ~1,250 tokens (always local)
     + git history                    = ~500 tokens
     + codebase map metadata          = ~300 tokens
                                       ~2,050 tokens total (86% savings)
```

### Step: build_requirement_summary (A.5)

**This is the MOST IMPORTANT step in understand_ticket (A).** All downstream agents depend on the synthesis quality.

The schema's Stage 2 produced a **Requirement Summary**. The schema's Stage 3 produced an enriched **AC Registry**. Step A.5 ensures BOTH are written to the LLD and visible at checkpoint.

**A.5a: Ensure prior research is captured in epic-context** (safety net)

If this is a subsequent story reading from epic-context, verify the epic-context has:
- HLD summary (architecture decisions)
- Spike findings (if any spikes exist under this epic)
- Story log (files CREATED/MODIFIED per prior story)

If spike findings are missing from epic-context but spikes exist in JIRA under this epic:
```
SEARCH: JIRA for child items of {EPIC_ID} where type = Spike
FOR each spike:
  - Fetch spike ticket → extract findings from Description + Comments
  - Check Confluence for associated spike doc → extract POC results
  - APPEND to $EPIC_CONTEXT under "Spike Findings" section
```

This self-heals the epic-context if the first story missed spike capture.

**A.5b: Write the Requirement Summary to `$CONTEXTS_FILE`**

The LLD is split across **three files** (see `agent-pipeline/rules/agent-flow.mdc` Path resolution):

- `$CONTEXTS_FILE`  — Requirement Summary + Enriched AC Registry + Companion Files index (this step's output)
- `$LLD_FILE`       — PART 1 (Design) + PART 2 (Tasks) (written in B.2/B.3)
- `$TESTPLAN_FILE`  — PART 3 (Test Plan) + PART 4 (Test Tasks) (written in B.4/B.5)

Write the Requirement Summary into `$CONTEXTS_FILE` as the main entry-point document. It no longer contains PART 1–4 — those go into the companions.

```markdown
---
ticket: {TICKET_ID}
mode: story
base_branch: {base_branch}
epic: {EPIC_ID or "standalone"}

# User-provided directives (only present if user supplied them in the trigger).
# Downstream agents (explorer / surgeon / review) read these as priority input
# during their own per-task work. See A0 step 2c + A0.6 path-hint extraction.
user_context: |                                     # NEW — verbatim from trigger
  {user_context_block or "" }
user_context_path_hints: [{path}, ...]              # NEW — A0.6 path extraction (existence-verified)
user_context_layer_hints: [{layer}, ...]            # NEW — A0.6 layer-keyword inference
reference: {TICKET-ID or null}                      # NEW — from `reference:` directive
reference_pattern_cache: {path or null}             # NEW — pattern-extractor subagent cache path
                                                    # (Review § 3.5a reads this to skip re-fetch).
                                                    # null when subagent fell back to inline mode.
out_of_scope: |                                     # NEW — verbatim from trigger
  {out_of_scope_block or "" }
constraints: |                                      # NEW — verbatim from trigger
  {constraints_block or "" }
---

# REQUIREMENT SUMMARY
_Synthesized understanding — drives all downstream agent work._

{If user_context_block is non-empty, render this section IMMEDIATELY after the heading:}

## User Context (priority guidance from trigger)
> Verbatim: {user_context_block — first 400 chars; "..." if longer}
> Interpretation:
>   - Path hints:  {user_context_path_hints or "none extracted"}
>   - Layer hints: {user_context_layer_hints or "none inferred"}
>   - Reference:   {reference or "none"}
>   - Out of scope: {out_of_scope or "none"}
>   - Constraints: {constraints or "none"}

STORY: {ID} — {title}
ROLE:  {who}  →  GOAL: {what}  →  BENEFIT: {why}

## What To Build
1. {deliverable 1 — CREATE/MODIFY/REUSE based on maps}
2. {deliverable 2}
3. {deliverable 3}

## Boundaries
- ✅ Must: {in-scope items}
- ❌ Must not: {out-of-scope items}
- ⚠️ Constrained by: {assumptions + comment decisions + prior story decisions + prior constraints}

## Reuse From Prior Work
(from project-map.md and epic-context.md — what this story must NOT recreate)
- ♻️ {shared component from project-map} at {path} — for: {AC reference}
- ♻️ {file from epic-context} CREATED by {prior ticket} — for: {AC reference}
- ♻️ {pattern from epic-context} — follow same approach as {prior ticket}

## Scope (from classify_scope A0.6.3)
- UI involved:      {✓ | ✗}
- Backend involved: {✓ | ✗}
- Docs-only:        {✓ | ✗}
- Confidence:       {high | medium | low}
- Rationale:        {one-line explanation from classifier}

{If scope_conflicts is non-empty, render each on its own line prefixed with ⚠.
 Example:
   ⚠ {N} image/Figma source(s) attached but scope classified as non-UI; images
     will be IGNORED. Override with: Amend: scope.ui_involved = true if the
     ticket actually has UI.
 Otherwise omit the conflicts block.}

_Downstream enrichment branches on this:
  - `ui_involved = false` → image analysis, Figma gates, and design-folder
    creation are all SKIPPED. The "Visual Specification" section below is
    omitted.
  - `backend_involved = true` → (future) `contract_spec` enrichment for API
    schema extraction will activate when available.
  - `docs_only = true` → both UI and backend enrichment skipped. Review and
    build checks remain (docs may still need lint/spell-check).
To override at this checkpoint:
  - `Amend: scope.ui_involved = true`     (or false)
  - `Amend: scope.backend_involved = true` (or false)
  - `Amend: scope.docs_only = true`        (or false)
The override re-runs the relevant enrichment without a full re-trigger._

## Visual Specification
{OMIT the entire Visual Specification section (including "Structured visual
 extraction" below) when scope.ui_involved == false. A backend/docs ticket
 shouldn't have a Visual Specification. Render only when scope.ui_involved
 AND resolve_enrichments (A0.6) produced a visual_spec.}

{N} design frames | {M} components | {K} states (default/hover/error/empty/loading)
- {attachment} → illustrates {which AC}

{If resolve_enrichments (A0.6) produced structured {visual_spec} — i.e. images
 were fetched from trigger attachments, JIRA attachments, or Figma MCP —
 include the structured extraction here. Otherwise omit this subsection.}

### Structured visual extraction (if images analyzed)
Images analyzed: {N} ({sources breakdown})
Design folder: `{design_folder}`

**Design authority** (render when visual_spec.authoritative_count > 0):
- 🔒 Authoritative (user-uploaded, final intent): {M} image(s) — drives style guide in B.3.
  - image-{id} ({filename}) → `{file_path}`
- 📎 Reference (JIRA / Figma — informational only, used for divergence detection):
  - image-{id} ({source}:{url or filename}) → `{file_path}`   _reference_only_

{When no authoritative image exists (no trigger attachments), omit the "Authoritative"
 line and drop the "reference_only" suffix — all images contribute to the style guide
 equally. This is the today-default behavior for tickets without user uploads.}

**Divergences between your upload and references** (render when visual_spec.divergences is non-empty):

{For each divergence in visual_spec.divergences:}

  - ⚠ {kind} — rendered per case:
    - `missing_from_authoritative`: "Reference shows '{ref_element.label}' ({ref_element.type}) but your upload doesn't include it. Likely intentionally dropped — ACs will confirm scope."
    - `component_type_conflict`:    "For '{label}', your upload uses {auth.type}; reference uses {ref.type}. Authoritative wins ({auth.type}). Override: `Amend: element '{label}' → {alternative-type}` if wrong."
    - `topology_drift`:             "Your upload's layout ({auth_topology}) differs from the reference ({ref_topology}). Using your structure. Override with: `Amend: use reference topology` if you meant the reference."

{If no divergences: omit this subsection entirely. It only appears when there's
 meaningful drift worth reviewing at the checkpoint.}

_All fetched Figma frames and uploaded screenshots are persisted in this folder.
To confirm the designs visually, open the folder in your file viewer (or open
`{design_folder}/README.md` for the index). To CORRECT a design, replace the
image file at the listed path and reply `continue` — orchestrator will re-run
extraction on replaced files only. To correct the extracted layout without
replacing the image, use `Amend: ...` against the tree below._

- Image 1 ({source/filename}) → `{file_path}`:
  - Elements:
    - e1 {element type}: "{label}" ({variant}) → matches {pack}-{component} (shared_paths)
    - e2 {element type}: "{label}" → ⚠ novel (no shared_paths match)
    - ...
  - Layout tree:
    ```
    root (kind: {layout_kind}, label: "{screen title}")
    ├── card-1 (kind: card, columns: 2, label: "Approval Rules")
    │   ├── col-1 (kind: column) → [e1, e2, e3]
    │   └── col-2 (kind: column) → [e4, group-bulk]
    └── group-bulk (kind: group, label: "Bulk actions", conditional_on: e1=true) → [e5, e6]
    ```
    _Render the tree whenever `visual_spec.images[*].layout_tree` is populated.
     Use ASCII indent or tree glyphs — whichever keeps it compact. The tree
     is what B.3 (task decomposition) uses to preserve layout structure, and
     what the Phase C user gate surfaces so the user can spot mis-extraction
     before Surgeon runs. Omit the tree subsection only when the extraction
     returned flat elements with no container hierarchy._
  - States shown: {list}
- Image 2 (...):
  - ...

AC ↔ design mapping (the design is a style + convention guide — ACs drive the actual fields; this table shows how each AC will be placed):

- AC{N}: field "{label}" → component {pack}-{type} (styled like image-{M}/{tree-node-id})
         placed in container image-{M}/{container-node-id}
         {note if AC is backend-only / has no visual component}
- AC{K}: no visual analog in design — picked closest component ({pack}-{type}) +
         container ({container-node-id}) by semantic match; confirm or override
         at checkpoint

Fields in design but NOT in any AC (reference-only, will NOT be implemented):
- image-{M}/{node-id} ({element}) — design shows this but no AC covers it; omitted
  by design (tree is a style reference, ACs drive scope)

Tree extraction notes: {if the subagent flagged uncertainty on conditional_on rules or column counts, surface here — the user confirms at the A.5 checkpoint}

## Pattern Reference
{If resolve_enrichments (A0.6) set {reference_ticket}, include this section.
 Otherwise omit.}

- Reference ticket: {REF_TICKET} ({source: "trigger" | "jira-link:<type>" | "suggestion"})
- Pack compatibility: {same ✓ | ⚠ different: {ref_pack} → current {cur_pack}}
- Pattern summary:
  - Task count: {ref.task_count}
  - Reuse ratio: {ref.reuse_ratio}
  - Layer split: {ref.layer_distribution}
  - Ship-ready on first review: {yes | no — {reason}}
  - Amendment Log: {N} entries ({brief description of each})
- Key patterns followed: {narrative summary drawn from ref $LLD_FILE PART 1}

## Prior Work Context
- HLD decisions applied: {list from epic-context}
- Spike findings applied: {list from epic-context, if any}
- Patterns to follow: {list from epic-context}
- Constraints to respect: {list from epic-context}

## Cross-Reference Findings
- Gaps found: {list — derived ACs generated for each}
- Conflicts found: {list — user will resolve at checkpoint}
- Open questions: {unanswered items flagged for user}

## Depends On
- {blocker ticket} ({status}) — provides: {what it gives us}

## Enriched AC Registry
{written in A.5c — {N} total: {X} JIRA ACs, {Y} derived, {Z} split}

## Companion Files
_Design and test plan live in separate files so they can be read, shared, or
reviewed independently. Downstream agents (Explorer, Surgeon, Review, AC-E2E-Check,
Amender) read from the right file for each PART — see agent-flow.mdc._

- **LLD** (PART 1 Design + PART 2 Tasks): `{$LLD_FILE}`
- **Test Plan** (PART 3 Test Plan + PART 4 Test Tasks): `{$TESTPLAN_FILE}`
{If B.3.5 publish_lld ran successfully, append:}
- **LLD draft (published)**: {published_url} — _state: {published_state}, provider: {docs_publish.mcp}_
```

**Resolve `$LLD_FILE` and `$TESTPLAN_FILE`** via Procedure A (agent-flow.mdc) before writing the Companion Files section — the paths must point to files that will exist after B.2–B.5.

**A.5c: Build the Enriched AC Registry (follows the Requirement Summary)**

```
AC REGISTRY ({N} total: {X} JIRA ACs, {Y} derived, {Z} split)

Each AC entry:
  { id, source, type, given/when/then, testability, attachments,
    constraints: [assumptions + comment decisions affecting this AC],
    visual_ref: [design frame/attachment for this AC],
    related_scope: [which in-scope item this AC satisfies],
    reuse_from: [file path from PROJECT_MAP or FILE_EXISTS that satisfies this AC] }

AC-SUPPORT CONTEXT (refines ACs — does NOT create tasks):
- IN-SCOPE ITEMS → all covered by ACs (derived where necessary)
- ASSUMPTIONS → constrain task implementation
- COMMENT DECISIONS → refine how ACs are implemented
- SUBTASK ALIGNMENT → validates AC understanding
- LINKED CONTEXT → informs dependencies and approach
```

### Missing Input Handling

```
### ⚠️ MISSING ITEMS
1. **{item}** — {why}. Provide {how}, or `skip {item}`.
Reply with items + `Go`.
```

### Checkpoint (user MUST see the actual synthesis, not just counts)

```
> ⚠ **Pressure-aware:** before rendering the gate template below, apply `agent-flow.mdc § Context Pressure Detection`. YELLOW → prepend banner. ORANGE → render ORANGE template (resume command: `Work on {TICKET_ID}` — A.5 cursor is implicit since file artifacts already exist). RED → render RED template and HALT.

## ✅ understand_ticket (A) Complete — Synthesis Ready

**Ticket:** {ID} — {Title} | Type: {type} | Priority: {priority} | Sprint: {sprint}

{If {directives}.context (or any other directive) is non-empty, render this section FIRST before the Requirement Summary:}

### User Context (priority guidance from trigger)
- Verbatim: "{user_context_block — first 400 chars; "..." if longer}"
- Path hints:   {user_context_path_hints or "none extracted"}
- Layer hints:  {user_context_layer_hints or "none inferred"}
- Pattern hits: {N files scanned across {N} paths or "n/a"}
- Reference:    {{directives}.reference or "none"}
- Out of scope: {{directives}.out_of_scope or "none"}
- Constraints:  {{directives}.constraints or "none"}
- Warnings:     {context_warnings or "none"}

{If visual_spec.extracted_non_ui is non-empty, render BEFORE the Requirement Summary:}

### Architecture / Diagram Captured (auto-detected from {N} image(s))
{For each entry in visual_spec.extracted_non_ui, render a block:}

- Image {image_id}: **{intent}** ({intent_confidence}) — {intent_reason}
  {if intent == architecture or rough_sketch:}
    - Components ({N}): {first 5 names, comma-separated} {"…(+M more)" if >5}
    - Connections: {N} ({HIGH-conf count} HIGH, {MED} MEDIUM, {LOW} LOW)
    - Data stores: {names if any}
    - External systems: {names if any}
  {if intent == data_sample:}
    - Tables ({N}): {names}
    - Total columns: {N}
  {if intent == rough_sketch and extraction_uncertainty non-empty:}
    > ⚠ Rough-sketch uncertainty (please confirm before LLD synthesis):
    > {bullet list of extraction_uncertainty[]}
    > Reply with `Amend: <correction>` to fix interpretation, or `Continue` to accept.

{If visual_spec.requires_user_classification is non-empty, render the LOW-confidence picker:}

### Image classification — needs confirmation
{N} image(s) couldn't be classified confidently. Pick an intent for each:

- Image {image_id} ({file_path}, best guess: {intent_guess}, confidence LOW)
  > Reason: {intent_reason}
  > 👉 Pick: `Image {image_id}: ui_mockup | architecture | rough_sketch | data_sample | skip`

After picking, the subagent re-runs extraction with the user-confirmed intent.

### Requirement Summary
{Print the full Requirement Summary from A.5b — role, goal, benefit, what to build,
 boundaries, reuse, visual spec, prior work, cross-reference findings, dependencies.
 The summary explicitly reflects user_context as priority guidance: any layer named
 in user_context_layer_hints must appear in "What To Build" with a deliverable.
 Architecture diagrams (if any) inform PART 1 §Implementation/Architecture sub-section.}

### AC Registry ({N} total)
- {X} JIRA ACs | {Y} derived | {Z} split from compound ACs
- Coverage: all {M} in-scope items covered ✅
- Derived ACs awaiting confirmation:
  - AC{N} [DERIVED from {source}]: {text} — Confirm / skip?

### Cross-Reference Findings
- Gaps closed by derivation: {count}
- Conflicts needing resolution: {list with "Ask user" options}
- Open questions: {list}

### Context Sources Used
- Epic context: {✓ existed / ✗ created fresh}
- HLD applied: {✓ / ✗}
- Spike findings applied: {N spikes / none found}
- Prior story decisions inherited: {count from epic-context}
- Shared components identified for reuse: {count from project-map}
- Epic-level files identified for reuse: {count from epic-context}

{Missing items block OR ✅ All inputs available.}

> **👉** Type `Go` to generate LLD (synthesize_lld (B)) using this summary.
>        `Amend: <what to change>` to refine the summary before synthesize_lld (B).
>        {If user_context_block non-empty:}
>        `Amend: replace context with: <new text>` to swap the entire user_context block
>          (re-runs A0.6 path-hint extraction; re-renders this gate).
>        **Check the Scope section first.** If the classifier got it wrong, correct it before
>        proceeding — a wrong scope means the wrong enrichment ran (or didn't run):
>          `Amend: scope.ui_involved = true`        (or false — gates image analysis)
>          `Amend: scope.backend_involved = true`   (or false — gates backend enrichment)
>          `Amend: scope.docs_only = true`          (or false — skips UI + backend flows)
>        **If the ticket has UI changes** (scope.ui_involved = true): open `{design_folder}`
>        (or its `README.md`) first and verify the persisted designs are the designs
>        you want the implementation styled after. The design guides component picks,
>        container placement, spacing, and grouping; your ACs drive the actual fields
>        and behaviors. Replace any wrong image in-place and reply `continue` to
>        re-extract only the replaced files. Review the AC ↔ design mapping above —
>        if an AC is mapped to the wrong container or component, correct it via
>        `Amend:` before `Go` (fixing it after LLD synthesis is significantly more
>        expensive).
>        `Cancel` to stop.
```

**Rationale:** A count-only checkpoint hides bad synthesis. Showing the Requirement Summary lets the user catch misunderstandings BEFORE the LLD is generated. Changing the summary at this gate is cheap. Changing the LLD after synthesize_lld (B) is expensive.

---

## Phase: synthesize_lld (B — LLD + Tasks + Test Plan)

**All synthesize_lld (B) steps consume the Requirement Summary and Enriched AC Registry from Phase A.** The synthesis is the contract — synthesize_lld (B) is just rendering the synthesis into the 4-part LLD shape.

### B.0: Load LLD Generator Skill
```
Read: .cursor/skills/{lld_generator_skill}
```

### B.1: Select Sections
Decide which LLD sections apply based on story type. The Requirement Summary's "What To Build" determines relevant layers (UI? API? Data? Config?).

### B.2: Generate PART 1 (LLD Design) — FROM REQUIREMENT SUMMARY

**Priority inputs (per-decision, NOT a flat global override — see `agent-flow.mdc § Per-decision priority`):**

- **Scope (what to build):** JIRA body + ACs are authoritative. `{user_context_block}` is **additive** — it can ADD a layer JIRA didn't mention (e.g., DB changes), but it cannot REMOVE an AC JIRA stated.
- **Pattern / file paths / naming:** `{user_context_path_hints}` + `{context_pattern_hits}` win over project-map defaults.
- **Layer inclusion:** UNION of JIRA-implied layers + `{user_context_layer_hints}` + layers implied by extracted architecture diagrams (e.g., a sequence diagram showing `OrderService → PaymentService` implies backend.services + backend.rest_endpoints layers). If user_context says "include DB changes", PART 1 §Implementation MUST describe the DB layer.
- **Reuse decisions:** `{reference_ticket_pattern}` > `{user_context_path_hints}` > project-map.
- **Constraints / anti-scope:** UNION (JIRA-stated + directives).
- **Architecture / data-model:** when `visual_spec.extracted_non_ui` contains architecture or data_sample blocks, PART 1 gets a new §Implementation/Architecture sub-section that captures components, connections, and data stores. PART 2 task generation uses the architecture as a layer-decomposition guide: each component becomes a candidate task or set of tasks; each connection implies an integration test. ER diagrams from data_sample drive migration tasks.

If user_context conflicts with a JIRA AC text, the user resolved it at A.5 (or the conflict's still pending → halt before write). PART 1 §Constraints records the resolved decision, not the original conflict.

**Architecture-extracted layer decomposition (NEW for backend tickets with arch diagrams):**

When `visual_spec.extracted_non_ui[]` contains architecture/rough_sketch entries:

```
FOR each architecture block:
  FOR each component in components:
    Decide layer based on type:
      service / module       → backend.services or backend.rest_endpoints
      datastore / queue      → db / backend.persistence
      external               → backend.integrations (no impl, but a contract task)
    PART 1 §Implementation/Architecture cites the component verbatim.
    PART 2 emits a candidate task per component (deduped against ACs).

  FOR each connection in connections:
    PART 4 emits a candidate test task verifying the connection
    (e.g., "T-TC5: contract test OrderService→PaymentService POST /charges").

  FOR each data_store with schema_hints:
    PART 2 emits a migration task with the visible schema fields as starting columns.

  Mark every architecture-derived task with source: arch_diagram in metadata so
  Surgeon knows it came from the diagram (vs ACs vs user_context).
```

**Confidence handling:** components/connections marked `confidence: LOW` (rough sketches) → tasks generated with a `pending_confirmation: true` flag. PART 2 detail block notes "needs user confirmation — derived from rough sketch with LOW interpretation confidence." Surgeon halts on these tasks at the per-task gate and asks for explicit confirmation before implementing.

**Output target: `$LLD_FILE`** (not `$CONTEXTS_FILE`). PART 1 and PART 2 both live in `$LLD_FILE` — start it with this header and append PART 2 in B.3:

```markdown
---
ticket: {TICKET_ID}
companion_of: {$CONTEXTS_FILE basename}
part: "LLD Design + Tasks"
---

# PART 1 — LLD Design
```

**Source of truth: the Requirement Summary written in A.5b** (read from `$CONTEXTS_FILE`). Do NOT re-derive from raw JIRA — the synthesis already did that work.

Generate PART 1 sections by mapping Requirement Summary fields:

| LLD Section | Source in Requirement Summary |
|------------|------------------------------|
| Introduction / Scope | "What To Build" + "Boundaries" |
| Design Decisions | "Prior Work Context" (HLD + spike + prior story decisions) + new decisions for this story |
| UI/UX Design | "Visual Specification" |
| API/Service Design | "Reuse From Prior Work" (existing services) + new services needed |
| Data Design | ACs classified as DATA type |
| Security | ACs classified as PERMISSION type + constraints |
| Accessibility | "Visual Specification" accessibility findings |
| Dependencies | "Depends On" |
| Open Questions | "Cross-Reference Findings" → open questions |

Include Release Notes, ServiceNow URL, Fix Version in Document Information.
Include all comment decisions from AC-SUPPORT CONTEXT in relevant design sections.

### B.3: Generate PART 2 (LLD Tasks) — Task Decomposition

**Output target: `$LLD_FILE`** — append `# PART 2 — LLD Tasks` below PART 1 in the same file.

**GOLDEN RULE: Tasks come from ACs ONLY.**

**Reference-pattern biasing (soft guardrails — only when Pattern Reference section is populated from resolve_enrichments):**

```
IF Requirement Summary has "Pattern Reference" section AND ref_pack matches cur_pack:
  SOFT BIAS the decomposition:
  1. Target task count within {ref.task_count} ± 1.
     If the derived task list has significantly different count, flag in
     Cross-Reference Findings: "Decomposition has {N} tasks vs. reference {M}
      — review whether the scope is genuinely different."

  2. Target reuse ratio within {ref.reuse_ratio} ± 10%.
     If the new decomposition drops below ref − 10%, flag:
     "Reuse ratio {X%} is below reference pattern ({Y%}). Re-check reuse_discovery
      before approving — reference achieved higher reuse for a similar AC set."

  3. Target layer distribution to match the reference's shape.
     If ref was (2 FE + 1 BE) and current is (3 FE + 0 BE), flag:
     "Layer split differs — reference had a BE task, current doesn't. Intentional?"

  4. Per-task annotation: each task gets
       "# Follows pattern from {REF_TICKET} T{N}"
     when a direct pattern match applies. Generated by comparing the new task's
     intent + layer + file set to the reference's task list.

  These are SOFT biases — user approves/adjusts at gate_for_approval (C).
  If pack mismatch was flagged in resolve_enrichments, SKIP biasing entirely
  (pack differences make the pattern untrustworthy — just record the reference
  for auditability, don't shape decomposition from it).

IF Pattern Reference section is not populated:
  Standard decomposition — no biasing.
```

**Visual-spec biasing (also soft — when Structured visual extraction is populated):**

```
IF Requirement Summary has structured visual extraction:
  FOR each visual element matched to a shared_paths component:
    Prefer ♻️ REUSE action for tasks that implement that element.
  FOR each AC marked "confirmed by image-{M} {element}":
    The task implementing that AC should reference the specific component
    the image matched.
  FOR each "⚠ In design but not in ACs":
    Do NOT create tasks for these — ACs drive tasks. Flag in Cross-Reference
    Findings for user awareness.
```

**Design-as-style-guide (applies when `scope.ui_involved == true` AND `visual_spec.images[*].layout_tree` is populated):**

Gate preconditions:
- `scope.ui_involved == false` → this entire block is silent. Backend-only / docs-only tasks decompose from ACs directly with no design-biasing.
- `scope.ui_involved == true` but `visual_spec` is null → UI ticket without a design. A.5 flagged this as a conflict; B.3 proceeds with AC-only decomposition, and tasks default to shared_paths matches per AC element type. Review will flag missing-design in Cross-Reference Findings.
- `scope.ui_involved == true` AND `visual_spec` with `layout_tree` populated → apply the rules below.

**Authority selection (when multiple images with different authority exist):**
- If `visual_spec.authoritative_count > 0` (user drag-dropped images at trigger time):
  → the style guide is derived EXCLUSIVELY from authoritative images. The user consciously uploaded their final intent; Figma/JIRA references may be stale, earlier iterations, or different screens. Reference-only images (`reference_only: true`) do NOT contribute tree nodes, component picks, or container placements to the task decomposition.
  → Divergences logged at A.5 are informational — the user already confirmed their upload wins by not overriding at the A.5 checkpoint.
- If `visual_spec.authoritative_count == 0` (no trigger uploads — all sources are JIRA/Figma):
  → all images contribute equally. No authority tier.
Use the resulting "effective tree(s)" below when the rules say "the tree".

The design (Figma frame or uploaded image) is the source of truth for **how** to build — style, layout conventions, component picks, spacing idioms, grouping patterns, conditional-visibility patterns. The ACs are the source of truth for **what** to build — which fields, which actions, which behaviors exist. The tree is NOT a shape target; it's a style + convention reference.

This matters because most real tickets don't have a 1:1 Figma: the design typically shows a similar screen, an existing screen being extended, or a canonical example of the UI pattern. ACs then specify the actual fields for this ticket — often additional fields beyond what the design shows, occasionally fewer, sometimes different labels on the same visual skeleton.

```
IF any image in visual_spec has a populated layout_tree:

  PRINCIPLE — FIELDS FROM ACs, STYLE FROM TREE:

  1. Task decomposition is driven by ACs (GOLDEN RULE above — unchanged).
     The tree does NOT add tasks; it shapes HOW existing AC-driven tasks
     are implemented.

  2. For EACH AC-derived field/control/action, the task MUST specify:

     a. COMPONENT PICK — match the design's component type for semantically
        similar elements. If image-1 shows dropdowns for selection fields
        (e3, e4 → sp-dropdown), an AC-derived selection field reuses sp-dropdown.
        If the design uses sp-toggle for boolean settings (e1, e2), an AC-derived
        boolean setting reuses sp-toggle. Don't pick a different component type
        just because the design doesn't show that exact field.

     b. CONTAINER PLACEMENT — pick the tree container whose semantic role matches
        the new field, per the design's grouping convention:

           - Filter/search fields → same container as existing filter/search
             tree nodes (e.g., image-1/filter-row)
           - Configuration toggles → same container as existing configuration
             tree nodes (e.g., image-1/card-1/col-1 if that's where the existing
             toggles live)
           - Bulk / batch actions → existing bulk-action container/group, honoring
             its `conditional_on` rule
           - Primary / destructive actions → action-bar container
           - Form fields for a single entity → the entity's card container;
             respect the design's `columns:` idiom (if the card is 2-column and
             the new field count stays ≤ what fits, fill the columns in reading
             order; if it overflows, add the overflow fields to a new row in the
             same container, not a new card)

        If multiple containers could fit, pick by content similarity (label
        semantics) and flag the choice in Cross-Reference Findings for user
        review at the A.5 checkpoint.

     c. SPACING / LAYOUT IDIOM — carry forward the tree node's `columns:`,
        container `kind`, and conditional rules when placing new fields.
        A new field placed into a 2-column card respects the 2-column grid,
        it doesn't break the card's layout.

     d. REUSE CHECK — before emitting a task that creates a new component,
        grep shared_paths and PROMOTION_CANDIDATES for the component type.
        "A similar design" often implies a similar component already exists
        in the codebase (Surgeon Step 0a will double-check; B.3 does the
        first pass so the user can see reuse intent at the A.5 checkpoint).

  3. Tasks reference tree nodes as STYLE ANCHORS, not shape targets. Example —
     compare the wording:

       ✗ Bad (shape-target thinking):
         "Task 7: Build image-1/card-1 with col-1 containing e1, e2, e3 and
          col-2 containing e4 and group-bulk."
         → Locks Surgeon to rebuild the design verbatim. Misses AC-specified
           fields the design doesn't show.

       ✓ Good (style-anchor thinking):
         "Task 7 (AC3, AC4, AC5, AC7): Add the Approval Rules card.
          Fields (from ACs):
            - Priority (AC3)          → sp-dropdown, styled like image-1/e3
            - Auto-approve (AC4)      → sp-toggle,   styled like image-1/e1
            - Notify reviewer (AC5)   → sp-toggle,   styled like image-1/e2
            - Escalation SLA (AC7)    → sp-input,    no direct design analog —
                                        flagged in Cross-Reference Findings
          Container: follow image-1/card-1 idiom (kind: card, columns: 2,
          label 'Approval Rules'). Place configuration toggles in col-1,
          dropdown + input in col-2. Honor image-1/group-bulk's
          conditional_on=Auto-approve rule when bulk actions are present."

       The good version:
         - Drives from ACs (AC3-AC7 explicitly mapped)
         - Picks components from the design's grammar
         - Places fields using the design's grouping convention
         - Preserves the design's conditional-visibility pattern
         - Flags the one AC-field without a clean design analog

  4. For elements IN the tree but NOT in any AC ("⚠ In design but not in ACs"):
     Do NOT create tasks. The design shows them because it's a reference, not
     a target. Reviewer will verify these are intentionally omitted against
     the ticket scope. Already flagged in the Requirement Summary.

  5. For ACs with NO clean design analog ("⚠ In ACs but not in design"):
     Pick the closest component type from the design's grammar and the most
     semantically-appropriate container; flag the choice in Cross-Reference
     Findings so the user can confirm or override at the A.5 checkpoint.
     Do NOT halt — the common case is "design is a reference, AC adds fields",
     and halting each time would block most tickets.

  6. Conditional-visibility rules from the tree (`conditional_on`) carry
     forward when the task implements an AC whose field lives inside a
     conditional tree node, AND when the controlling field is still present
     in the AC set. If the controlling field was dropped by the ACs, the
     conditional rule is dropped with it and the dependent field is
     unconditionally visible; flag this in Cross-Reference Findings.

IF visual_spec exists but no layout_tree (e.g., URL-only skip path, or the
mock was a single vertical form with no containers):
  No tree, no style guide. Decompose from ACs directly; component picks
  default to shared_paths matches for each AC's element type.
```

**Why a style guide and not a shape target:** a verbatim rebuild of a reference design produces UI that doesn't match the ticket's ACs. A blind AC-driven flat form produces UI that doesn't match the design language. The middle ground — ACs drive fields, design drives style — is what real frontend work already does manually; this block just makes it explicit for the pipeline.

**BEFORE generating tasks, build TWO lookup maps:**

*Values shown below are illustrative only. Your lookup maps contain YOUR project's actual components, services, endpoints, and file paths — whatever project-analyzer discovered and whatever prior stories in the epic created. The data structure (keyed object with `name`/`path`/`methods` fields) is the same for every project.*

**Map 1: PROJECT_MAP (PROJECT-LEVEL — from project-analyzer, serves ALL epics)**
```
Read $PROJECT_MAP (contexts/project-map.md)
If exists → extract:
  SHARED_COMPONENTS = all shared UI components from Section 3
    { "button": { name: "{prefix}-button", path: "{frontend_path}/directive/Button.{ext}" }, ... }
  PROMOTION_CANDIDATES = all entries from Section 3b
    { "grid-wrapper": { path: "app/users/.../grid-wrapper",
                        status: "AUTO_PROMOTED",
                        trigger: "Signal 5 — wraps ngx-datatable",
                        wraps: "@swimlane/ngx-datatable" },
      "date-range":   { path: "app/reports/.../date-range",
                        status: "CROSS_FEATURE",
                        used_by: ["reports", "dashboard", "audit"] }, ... }
    # These feature-local components are architecturally shared.
    # Orchestrator consults them BEFORE declaring 🆕 CREATE.
  CONSOLIDATION = entries flagged as CONSOLIDATION in Section 3b
    { "chart.js": ["app/users/chart.tsx", "app/reports/chart.tsx",
                   "app/dashboard/chart.tsx"], ... }
    # Multiple wrappers of same library — halt for user decision.
  SHARED_SERVICES = all shared services from Sections 4-5
    { "httpService": { path: "...", methods: "get, post, put, delete" }, ... }
  REST_ENDPOINTS = all existing endpoints from Section 6
    { "/rest/ui/certifications": { class: "CertificationResource", methods: "GET,POST,PUT" }, ... }
  TEMPLATES = reusable page templates from Section 7
  FOLDER_MAP = folder→purpose mapping from Section 2

If not exists → prompt user: "Run 'Analyze project' first (Step 0)"
```

**Map 2: FILE_EXISTS (EPIC-LEVEL — from this epic's prior stories)**
```
IF $EPIC_CONTEXT exists (subsequent story):
  Read all story entries → collect every file under CREATED/MODIFIED
  Build:
    FILE_EXISTS = {
      "{frontend_path}/directive/datePicker.{ext}": { status: "CREATED", by: "PROJ-1234", reusable: true },
      "{frontend_path}/feature/featureListCtrl.{ext}": { status: "MODIFIED", by: "PROJ-1234" },
      ...
    }
    PATTERNS = { decisions, constraints from all story entries }

ELSE (first story):
  FILE_EXISTS = {} (empty)
  PATTERNS = {} (from HLD only)
```

**Now decompose ACs into tasks, checking BOTH maps:**

```
FOR each AC in Registry:
  1. DETERMINE layers (UI? API? Data? Config?)

  2. IDENTIFY what UI components / services this AC needs:
     "display filterable table" → needs: grid, dropdown, pagination
     "dropdown of entitlements" → needs: dropdown component + entitlements DATA
     "search with autocomplete" → needs: search-input, suggest

  3. CLASSIFY DATA SOURCE for any list/dropdown content (from i18n config):

     For every dropdown/list content in the AC, decide source:

     IF content is STATIC (labels, static enums, UI text):
       → Source: messages.properties (key format from i18n.key_format)
       → Task layer: i18n
       → Example: "Yes/No toggle" → ui_common_yes, ui_common_no

     IF content is DYNAMIC (matches i18n.forbidden_content entries):
       → Source: REST endpoint → database
       → Task layer: backend (for endpoint) + frontend (for fetch)
       → Two sub-tasks:
         a. ♻️ REUSE or 🆕 CREATE REST endpoint (check PROJECT_MAP first)
         b. Wire controller to fetch via httpService
       → Example: "Entitlements dropdown" → fetch /rest/ui/entitlements → NOT in messages.properties

     Apply this classification BEFORE generating tasks — otherwise a naive
     "add entitlement options" task might get implemented as property keys
     which is a known anti-pattern (stale data, tenant-specific).

  4. CHECK PROJECT_MAP FIRST (project-wide shared resources):

     AC needs "grid" → SHARED_COMPONENTS has sp-data-grid
       → ♻️ USE existing: sp-data-grid at {path}
       → Task: "Configure sp-data-grid for this page"

     AC needs "dropdown component" → SHARED_COMPONENTS has sp-dropdown
       → ♻️ USE sp-dropdown
       (component + data are separate — component is reusable,
        data comes from REST per step 3)

     AC needs "REST endpoint for entitlements" → REST_ENDPOINTS has /rest/ui/entitlements
       → ♻️ REUSE existing endpoint, no new task
       → If endpoint not in PROJECT_MAP → 🆕 CREATE task for EntitlementResource

     AC needs "list page layout" → TEMPLATES has list-page.xhtml
       → ♻️ USE existing template, configure for this page

     AC needs "permission check" → SHARED_SERVICES has permissionService
       → ♻️ USE existing: permissionService.hasRight()

     AC needs something NOT in PROJECT_MAP (Section 3) — BUT check Section 3b first:

     4a. CONSULT § 3b (promotion recommendations) before declaring CREATE:

         ► AC needs "grid" / "table" → § 3b has grid-wrapper (AUTO_PROMOTED from Signal 5)
           → ♻️ USE grid-wrapper at {current path}
           → Task annotation: "Component lives in feature folder but is auto-promoted.
                               Follow existing wrapper. Optionally move to shared/."

         ► AC needs "date picker" → § 3b has date-range-picker (CROSS_FEATURE, 3 features use it)
           → ♻️ USE date-range-picker at {current path}
           → Task annotation: "Component is a promotion candidate. Orchestrator reuses
                               feature-local version; consider moving to shared/ as part
                               of this story if scope allows."

         ► AC needs "chart" → § 3b has CONSOLIDATION entry (3 chart wrappers for chart.js)
           → HALT for user decision:
                "3 chart wrappers exist for chart.js. Which to extend?
                  a. app/users/.../chart.tsx (oldest)
                  b. app/reports/.../chart.tsx (newest features)
                  c. app/dashboard/.../chart.tsx
                  d. Create unified chart-wrapper in shared/ (recommended long-term)"
           → User picks → Orchestrator generates tasks accordingly

         ► AC needs something NOT in § 3 AND NOT in § 3b
           → Check FILE_EXISTS next (maybe this epic created it)

  5. CHECK FILE_EXISTS (this epic's prior stories):

     FILE in FILE_EXISTS as CREATED + reusable → ♻️ REUSE/CONFIGURE
     FILE in FILE_EXISTS as MODIFIED → 🔧 EXTEND (follow same approach)
     FILE in FILE_EXISTS as CONFIG → NO TASK (registration done)

  5b. NEITHER § 3, § 3b, NOR epic-context has it → 🆕 CREATE
     "Create new date-range-picker"
     → Flag: "Consider creating in common/directive/ for project-wide reuse"
     → If this component wraps a known library (chart, table, date picker, modal, editor):
       Flag EXTRA: "This is a wrapper of {library} — create with @shared JSDoc tag
                    so next scan auto-promotes it even at 1 consumer."

     4b. CONTRACT CONFIDENCE GATE (W2) — for tasks that USE a REST endpoint:
         ► Read endpoint.contract_confidence from project-map § 6
         ► Pick the LLD task template matching the tier:

           HIGH: precise task with full field list
             ♻️ USE {endpoint} ({METHOD})
             Request body: {full field list with types, required flags, constraints}
             Response: {full field list}
             Source: contract from {contract_source}

           MEDIUM: task with known params, body deferred to Explorer
             ♻️ USE {endpoint} ({METHOD})
             Known params: {list}
             ⚠ Full request body not extractable by analyzer (confidence: MEDIUM)
             → Explorer MUST extract wiring template from 2+ existing consumers
               in Phase E.2d. Surgeon MUST NOT guess the body shape.

           LOW: task treats contract as heuristic
             ♻️ USE {endpoint} ({METHOD})
             Heuristic schema (LOW confidence): {best-effort fields}
             ⚠ Contract extracted from untyped framework — verify against
               existing consumer. Explorer escalates Phase E.2d.

           NONE: task treats endpoint as opaque; may HALT if no consumer
             ♻️ USE {endpoint} — CONTRACT OPAQUE (confidence: NONE)
             Reason: {not_extractable_reason from project-map}
             → Explorer MUST supply an existing consumer file as SOURCE 2
               in Phase E.2d wiring template.
             → IF Phase 10 consumer graph has 0 consumers for this endpoint:
               HALT for user: "Endpoint {path} has opaque contract AND no
               existing consumers. Cannot proceed without human input."

  6. SPLIT by layer boundary — one task per layer
  7. APPLY PATTERNS from epic-context (decisions, constraints)
  8. APPLY assumption constraints + comment decisions

DEPENDENCY ORDER:
  Shared utilities → Backend → Frontend → Config → Integration

QUALITY CHECKS:
  □ Every AC ↔ ≥1 task (ONLY source of tasks)
  □ Every in-scope item ↔ covered by ≥1 AC
  □ No cross-layer tasks
  □ No dependency cycles
  □ SHARED COMPONENTS from registry are USED, not recreated
  □ PROMOTION CANDIDATES (§ 3b) consulted before declaring 🆕 CREATE
  □ CONSOLIDATION entries surfaced as user decisions, not silently ignored
  □ EPIC-LEVEL components from epic-context are REUSED, not recreated
  □ New components flagged for shared placement when appropriate
  □ New library-wrappers flagged with @shared JSDoc suggestion
  □ CONTRACT CONFIDENCE (§ 9) consulted for every REST endpoint task
  □ NONE-confidence endpoints with zero consumers → HALT, never silently proceed
  □ INTENT CLASSIFICATION (§ 10c) consulted — destructive-confirm tasks have AC for
    confirmation + undo; bulk-action tasks have AC for batch size limits;
    navigation tasks have AC for destination state
  □ Patterns/constraints applied
  □ Concrete Verify By
  □ 3-15 tasks typical (fewer for subsequent stories)
```

### Intent-aware AC templates (W1 integration)

When Orchestrator generates ACs from the Requirement Summary, it consults § 10c intent classifications for any button referenced. Intent drives what ACs must be present.

**The intent → required AC template mapping lives in a pack skill**, not inline here. The skill was already loaded at load_context step 4b (A0) (v16 eager-loading) into `{ac_template_table}`:

```
# v16: The skill is loaded at load_context (A0), not here. Reference the pre-loaded table:
# {ac_template_table} is already populated from
#   contexts/config/pipeline.yaml.skills.orchestrator.ac_templates_intent_aware
# or from the kernel fallback if unset.

FOR each button in Requirement Summary:
  intent = project-map.md § 10c[button.location].intent
  required_ac_types = {ac_template_table}[intent].required_acs
  # Apply per skill's Application Algorithm
```

**Why a skill, not an inline table:**
- Projects customize without editing the kernel agent prompt; generic fallback covers only the common subset of AC templates
- Stack-specific requirements stay with the pack, not the kernel
- Teams evolve the templates as the product grows without touching agent flow

If the ticket's explicit ACs don't cover the intent-specific requirements, Orchestrator flags gaps in § Cross-Reference Findings with a suggestion to add them.

### B.4: Generate PART 3 (Test Plan) — FROM AC REGISTRY + SYNTHESIS FINDINGS

**Output target: `$TESTPLAN_FILE`** (not `$CONTEXTS_FILE`, not `$LLD_FILE`). PART 3 and PART 4 both live in `$TESTPLAN_FILE` — start it with this header and append PART 4 in B.5:

```markdown
---
ticket: {TICKET_ID}
companion_of: {$CONTEXTS_FILE basename}
part: "Test Plan + Test Tasks"
---

# PART 3 — Test Plan
```

Read the Enriched AC Registry from `$CONTEXTS_FILE`. Three layers, each with an explicit source:

**Layer 1: AC test cases** (from Enriched AC Registry)
- One TC per AC (JIRA + derived + split)
- Include attachment-referenced scenarios (Visual Specification states: default/hover/error/empty/loading)
- PERMISSION ACs → test with/without right
- VALIDATION ACs → test valid + invalid + boundary inputs

**Layer 2: Task verification** (from PART 2 tasks)
- One TC per task verifying its specific Verify By

**Layer 3: Edge case & regression** (from Requirement Summary Cross-Reference Findings)
- Assumption-based tests: for each assumption, test its failure mode
- Boundary tests: from constraints in "Prior Work Context"
- Regression tests: for MODIFIED/EXTEND tasks, test that original behavior still works
- Cross-feature tests: for shared components being MODIFIED, test consumers not broken
- Conflict resolutions: for each conflict resolved at checkpoint, test the chosen approach

**Coverage requirement:** Every AC from registry → ≥1 TC in Layer 1. Every task → ≥1 TC in Layer 2.

### B.5: Generate PART 4 (Test Tasks)

**Output target: `$TESTPLAN_FILE`** — append `# PART 4 — Test Tasks` below PART 3 in the same file.

T-TC tasks needing code. Each depends on an implementation task (implementation tasks live in `$LLD_FILE` PART 2 — cross-reference by task ID).

### B.6: Validation + Save

Run skill checklist. Verify AC coverage = 100%, in-scope = 100%.

**Three-file save:**
1. `$CONTEXTS_FILE`  — Requirement Summary + Enriched AC Registry + Companion Files index (written in A.5b/A.5c)
2. `$LLD_FILE`       — PART 1 (Design) + PART 2 (Tasks) (written in B.2/B.3 · `published_*` frontmatter added by C.5b after user approval, only if publishing is configured + user opts in at the gate)
3. `$TESTPLAN_FILE`  — PART 3 (Test Plan) + PART 4 (Test Tasks) (written in B.4/B.5)

Verify all three files exist on disk before proceeding to gate_for_approval (C). If any is missing, HALT with the missing path. All three must share the same `ticket:` value in their metadata header.

---

## Phase: synthesize_bug_context (B-Bug — replaces synthesize_lld in Bug Mode)

**The ticket schema already parsed all bug sections** (Steps to Reproduce, Expected/Actual, error signals, environment, attachments). This step just writes the structured document that Explorer reads.

Does NOT load the LLD generator skill. Does NOT produce a 25-section design.

**Write the bug-shaped document across the same three-file split as story mode.** Bug mode uses identical file variables (`$CONTEXTS_FILE`, `$LLD_FILE`, `$TESTPLAN_FILE`) so downstream agents don't need to branch on mode.

**File 1 — `$CONTEXTS_FILE`** (bug context + placeholders):

```markdown
---
ticket: {TICKET_ID}
mode: bug              # or sub-bug
base_branch: {base_branch}
epic: {EPIC_ID or "standalone"}
---

# BUG CONTEXT
{Bug Understanding Summary from ticket schema — identity, reproduction,
 expected/actual, error signals, environment, evidence, context}

{If Sub-Bug Mode, add:}
## Parent Story Context
- Parent: {PARENT_TICKET_ID} (status: {status})
- Parent LLD: $CONTEXT_DIR{PARENT_TICKET_ID}.md {✓ or ✗}
- Epic codebase map: $CODEBASE_MAP {✓ or ✗}

## Companion Files
- **Fix Tasks** (PART 2 — filled by Explorer Mode C): `{$LLD_FILE}`
- **Root Cause Hypotheses + Regression Tests** (PART 3/4 — filled by Explorer Mode C): `{$TESTPLAN_FILE}`
```

**File 2 — `$LLD_FILE`** (placeholder for Explorer-bug to fill):

```markdown
---
ticket: {TICKET_ID}
companion_of: {$CONTEXTS_FILE basename}
mode: bug
part: "Fix Tasks"
---

# PART 2 — Fix Tasks
_To be filled by Explorer (Mode C — bug localization)._
```

**File 3 — `$TESTPLAN_FILE`** (placeholder for Explorer-bug to fill):

```markdown
---
ticket: {TICKET_ID}
companion_of: {$CONTEXTS_FILE basename}
mode: bug
part: "Root Cause Hypotheses + Regression Tests"
---

# PART 3 — Root Cause Hypotheses
_To be filled by Explorer (Mode C)._

# PART 4 — Regression Test Tasks
_To be filled by Explorer (Mode C)._
```

**Sub-Bug parent check:** If Sub-Bug Mode, verify parent's main file exists locally (`$CONTEXT_DIR{PARENT_TICKET_ID}.md`). If missing, warn: "Explorer won't have parent cross-reference. Proceed or cancel?"

Then proceed to gate_for_approval (C) (uses `fix/` branch prefix).

---

## Phase: gate_for_approval (C — Gate + Amendment Loop + Branch)

> ⚠ **Pressure-aware (applies to ALL gates in Phase C — render_enrichment_summary, show_gate, post-Go gate):** before any gate output, apply `agent-flow.mdc § Context Pressure Detection`. YELLOW → prepend banner. ORANGE → render ORANGE template (resume: `Work on {TICKET_ID}` — files already on disk so re-trigger picks up where it left off; branch creation in C.4 is gated on the user's `Go` so no destructive op fires under pressure). RED → render RED template and HALT — refuse to invoke C.4 (branch creation) or C.5b (publish) until override.

### What the user is approving at this gate (placeholder-fill expectation)

**PART 2 Tasks** and **PART 4 Test Tasks** in the LLD have per-task detail blocks (Sections 23b / 30b in the LLD generator skill). Each block has `Files:` (Orchestrator best-guess), plus `Insertion Point:` / `Reuse Match:` / `Explorer Notes:` marked `_(pending Explorer)_`. These placeholders are **part of the approved shape** — the user is approving:

- The task table (Section 23 / 30) — every field committed.
- The SHAPE of each per-task detail block, including that `Insertion Point` / `Reuse Match` / `Explorer Notes` will be filled by Explorer in Step 2.
- Orchestrator's current `Files:` best-guess (Explorer may refine this with exact paths after its grep).

What the user is NOT approving:
- The exact line numbers for insertion points (Explorer decides after reading the target files).
- The specific reuse component path (Explorer confirms via grep against project-map).
- The surrounding-code snippets or gotchas (Explorer discovers these).

This keeps the LLD a single unified document while preserving the Phase C approval invariant: Orchestrator's approved content is never modified; Explorer only fills the explicitly-marked `_(pending Explorer)_` placeholders in place.

If the user wants to pin specific files or insertion points at approval time (bypassing Explorer's refinement), they can amend: `Amend: lock T3 Files to web/ui/ts/... — don't let Explorer change it`. Amender records this; Explorer respects the lock.

### Step: render_enrichment_summary (C.0 — only if A0.6 found enrichments)

Before the gate menu, if resolve_enrichments (A0.6) discovered any references or images, render this block so the user can review + confirm auto-discovered inputs BEFORE Explorer runs. If no enrichments were found, skip this step silently.

```
┌─ Enrichment Summary ────────────────────────────────────────────┐
│ MCPs available: atlassian {✓/✗} · github {✓/✗} · figma {✓/✗}    │
│                                                                 │
│ {IF reference_ticket:}                                          │
│ Reference ticket: {REF_TICKET}                                  │
│   source:         {trigger | jira-link:<type> | suggestion}     │
│   pack match:     {same ✓ | ⚠ different pack — pattern may not  │
│                    transfer}                                    │
│   pattern:        {N} tasks · {M}% reuse · {layer split}        │
│   first-pass PR:  {clean | N P1 issues on first review}         │
│                                                                 │
│ {IF reference_images:}                                          │
│ Images analyzed: {N}                                            │
│   - {N_trigger}  from trigger attachments                       │
│   - {N_jira}     from JIRA ticket attachments                   │
│   - {N_figma}    from Figma frames (URLs in description)        │
│   Elements identified: {count} across all images                │
│   Component matches:   {M}/{count} mapped to shared_paths       │
│   Novel elements:      {list or "none"}                         │
│   States covered:      {default/hover/error/empty/loading list} │
│                                                                 │
│ {IF reference_suggestion (from comments):}                      │
│ ⚠ Suggested reference (from comments): {TICKET}                 │
│   Not auto-applied. To use it, re-run with:                     │
│     @orchestrator.md Work on {cur} — reference: {TICKET}        │
│                                                                 │
│ {IF warnings:}                                                  │
│ ⚠ Warnings:                                                     │
│   - {e.g. "JIRA had 2 linked 'is similar to' tickets —          │
│           using first (PROJ-100); PROJ-200 ignored."}          │
│   - {e.g. "5 images available, using first 3 — skipped: …"}    │
└─────────────────────────────────────────────────────────────────┘

Render above the existing Phase C gate menu. The user can accept, amend
via "Amend: remove pattern reference" / "Amend: ignore image 2" etc., or
cancel. Amender subagent handles these as regular amendment requests.
```

### Step: derive_branch_name (C.1)
Lowercase summary, strip filler, cap 5 words/50 chars.
Prefix from config: `runtime.branching.prefix_story` or `prefix_bug`.

### Step: detect_base_branch (C.2)

Read `runtime.branching` from config:
- `base_branch` → the default (e.g., `develop`, `main`, `master`)
- `stacking` → `auto-detect` | `always-ask` | `never`

**Check current branch:**
```bash
CURRENT_BRANCH=$(git branch --show-current)
```

**Stacking logic:**

| Config `stacking` | Current branch | Action |
|-------------------|---------------|--------|
| `auto-detect` | On `{base_branch}` (e.g., `develop`) | Create from `{base_branch}` — normal flow |
| `auto-detect` | On a feature/fix branch (e.g., `feature/PROJ-1234`) | Detect stack — show options (see below) |
| `always-ask` | Any | Always show branch options |
| `never` | Any | Always create from `{base_branch}` silently |

**When stacking detected (user is on another feature branch):**

```
⚠ Branch stacking detected
  You are currently on: feature/PROJ-1234
  Default base branch: {base_branch}

  Options:
  1. `Go` — create from {base_branch} (clean, no prior story changes)
  2. `Go, stack` — create from feature/PROJ-1234 (carries forward unmerged changes)
  3. `Go, from <branch>` — create from a specific branch

  Stacking means: feature/PROJ-2345 will include ALL changes from PROJ-1234.
  When PROJ-1234's PR merges to {base_branch}, you'll need to rebase PROJ-2345.
```

**User can also specify the base inline with the trigger:**
```
Work on PROJ-2345 from feature/PROJ-1234
```
This skips the stacking prompt and uses `feature/PROJ-1234` as base directly.

### Step: show_gate (C.3)

```
## [Step 1/5] Orchestrator — DONE

LLD: {$CONTEXTS_FILE} | Mode: {Story} | Schema: {skill name}
Branch: {prefix}/{TICKET_ID}-{slug}
Base: {base_branch_used} {if stacked: "⚡ stacked on feature/PROJ-1234"}

- {N} ACs ({X} JIRA + {Y} derived + {Z} split)
- {K} tasks (aligned with {M} subtasks)
- {L} test tasks
- Coverage: AC 100% ✅ | In-scope 100% ✅

{If stacking detected and not yet chosen:}
⚠ On feature/PROJ-1234 — `Go` (from {base_branch}) | `Go, stack` | `Go, from <branch>`

{If base already resolved:}
> **👉** `Go` | `Go, branch {custom}` | `Amend: <context>` | `Cancel`
```

### Step: create_branch (C.4)

```bash
# Resolve the base
if stacking:
  BASE="{stacked_branch}"      # e.g., feature/PROJ-1234
else:
  BASE="{base_branch}"          # e.g., develop
fi

git checkout "$BASE"
git pull
git checkout -b {prefix}/{TICKET_ID}-{slug}
```

**Record the base branch in LLD metadata** (downstream agents need this):
```bash
# Prepend to the LLD frontmatter
# base_branch: develop               ← normal
# base_branch: feature/PROJ-1234   ← stacked
```

The `base_branch` in the LLD metadata tells:
- **Explorer:** which branch to diff against in map sync (`git log {base_branch}..HEAD`)
- **Ship:** which branch to target the PR against
- **Review:** context for blast radius (stacked changes vs this story's changes only)

### Step: handle_response (C.5)
**"Go":** Create branch from `{base_branch}`. Then:
  1. JIRA label if configured (existing behavior)
  2. **JIRA status transition** — move ticket to "In Development":
     ```
     POST /rest/api/3/issue/{TICKET_ID}/transitions
     { "transition": { "id": "{jira.status_map.in_development}" } }
     ```
  3. **JIRA comment** — add branch + LLD reference:
     ```
     POST /rest/api/3/issue/{TICKET_ID}/comment
     { "body": "🤖 Pipeline started\nBranch: {branch_name}\nLLD: {contexts_file_path}\nMode: {Story|Bug}" }
     ```
  4. **publish_lld (C.5b)** — see step below. Optional · gated · only runs when `mcp_roles.docs_publish` is configured AND `docs_publish_target.enabled` is true AND the user approves the publish gate. Skipped silently otherwise.
  5. **Render the post-Go next-step gate** (REQUIRED per `agent-flow.mdc § Gate format` — every response must end with a `> **👉**` block, never empty):

     ```markdown
     ## ✅ Branch created — Stage 1 done

     - Branch:  `{branch_name}` from `{base_branch_used}`
     - JIRA:    transitioned to "In Development" · branch link commented
     {if C.5b ran:} - LLD draft: {published_url} ({published_state})

     > **👉** Next stage — Stage 2 of 5 (Explorer):
     > - `Run the explorer` — [▶ Run Explorer in new chat](cursor://anysphere.cursor-deeplink/prompt?text=%40explorer.md%20Run%20the%20explorer) _(scans the codebase, confirms reuse + insertion points · runs in a fresh chat)_
     > - `Cancel` — keep all artifacts; resume any time by re-running this command _(stays in current chat)_
     ```

     Do **NOT** include the post-Go gate in the C.3 show_gate output. C.3 ends with `Go | Amend | Cancel` ONLY. The post-Go gate fires only AFTER Go has been processed (branch created, JIRA updated, publish step complete). This keeps the user's decisions sequential — approve LLD first, then proceed to Explorer.

  6. Exit.

**"Go, stack":** Same as Go. Branch created from current feature branch. Same JIRA steps + C.5b + post-Go next-step gate. Exit.
**"Go, from {branch}":** Same as Go. Branch created from specified branch. Same JIRA steps + C.5b + post-Go next-step gate. Exit.
**"Amend":** Invoke subagent. Loop until Go/Cancel. Re-render the C.3 gate after the amendment lands. Do NOT render the post-Go next-step gate (no Go yet).
**"Cancel":** Render the cancel gate:
  ```markdown
  > **👉** Pipeline cancelled at Stage 1. `$CONTEXTS_FILE` kept on disk.
  > - `Work on {TICKET_ID}` — re-enter Stage 1 and resume from the LLD on disk
  > - `Work on {TICKET_ID} --fresh` — wipe artifacts and start over (see `--fresh` flag in `agent-flow.mdc`)
  ```
  Do NOT run C.5b.

### Step: publish_lld (C.5b — OPTIONAL · post-approval LLD publish)

**Triggered only on "Go" / "Go, stack" / "Go, from {branch}" — never on "Amend" or "Cancel".** By the time this step runs, the user has reviewed the LLD at the C.3 gate and explicitly approved it. Publishing now means the page reflects the approved version, not an in-progress draft.

**Provider-agnostic — never hardcode "atlassian" or "confluence" here.** Use `{role_resolution.docs_publish.mcp}` and the resolved MCP's tools.

**Short-circuit ladder (check in order — first hit wins, NO tokens spent on early skips):**

```
1. {role_resolution}.docs_publish absent OR .mcp == null
   → SKIP silently. Today's local-only flow preserved.
   Active Context line: "docs_publish ✗ (not configured) · publishing skipped"

2. {docs_publish_target}.enabled == false
   → SKIP. Configured but suspended by master switch.
   Note: "docs_publish ✗ (enabled=false) · publishing suspended; flip to true to resume"

3. {docs_publish_target}.parent_page_id is missing or empty
   → WARN, then SKIP:
     "⚠ docs_publish: target.parent_page_id is empty — cannot publish.
      Local $LLD_FILE remains canonical. Set docs_publish_target.parent_page_id and re-run."

4. Determine action via idempotency check — read $LLD_FILE frontmatter:
   action = "createPage" if frontmatter.published_id absent
            "updatePage" if frontmatter.published_id present AND content_hash differs
            "skip-noop"  if frontmatter.published_id present AND content_hash matches
   IF action == "skip-noop":
     → SKIP. Page already up to date.
     Active Context: "docs_publish ✓ (unchanged · ~50 tokens)"
     CONTINUE to step 5 ONLY for createPage / updatePage.

5. USER GATE (mandatory before any tool call — see "Gate behavior" below).
6. Execute action (createPage or updatePage). Write frontmatter on success.
```

**Step 5 — USER GATE (the consent step):**

Gate firing rule, controlled by `docs_publish_target.publish_gate` (default `always`):

| `publish_gate` value | Gate fires before createPage? | Gate fires before updatePage? |
|---|---|---|
| `always` (default) | yes | yes |
| `first_only` | yes | no — updatePage runs silently to keep the draft in sync after amendments |
| `never` | no — auto-publish | no |

When the gate fires, render this prompt before any tool call:

```
┌─ Publish LLD draft? ────────────────────────────────────────────────┐
│ Action:    {createPage | updatePage v{N+1}}                          │
│ Provider:  {docs_publish.mcp}        (e.g. atlassian)                │
│ Title:     {rendered title from title_format}                        │
│ Target:    space={space} · parent={parent_page_id}                   │
│ State:     {state}        (default: draft — page stays draft)        │
│ Body size: ~{N}K tokens   (LLD PARTs 1+2 + inlined test plan PARTs 3+4) │
│ Cost est:  ~${X.XX}       (~3K out + ~100 in @ Sonnet pricing)       │
│ Failure:   warn + local-only · pipeline continues regardless         │
│                                                                      │
│ Local $LLD_FILE remains canonical either way.                        │
│                                                                      │
│ > **👉** `Yes` (publish now) | `No` (skip this run, keep config) |   │
│         `Disable` (set docs_publish_target.enabled=false and skip) | │
│         `Never ask` (set publish_gate=first_only or never)           │
└──────────────────────────────────────────────────────────────────────┘
```

**Gate response handling:**

| Response | Effect |
|---|---|
| `Yes` | Proceed to step 6 (the actual MCP call). |
| `No` | Skip this run. Frontmatter unchanged. Pipeline continues. The next "Go" or amendment re-trigger fires the gate again. |
| `Disable` | Set `docs_publish_target.enabled` to `false` in the user's runtime config (write back via the same path the validator reads), then skip. Future runs short-circuit at step 2. |
| `Never ask` | Set `docs_publish_target.publish_gate` to `first_only` (if first publish) or `never` (if all subsequent), then proceed. |
| Anything else | Treat as `No`. |

**Step 6 — execute action (createPage):**

```
title = render({docs_publish_target}.title_format or default
               "{TICKET_ID} LLD — {ticket_title}")

# Decision #4: test plan inlined in the LLD page (single-page review).
body  = read($LLD_FILE)         # PART 1 + PART 2 (post-approval)
      + "\n\n---\n\n"
      + read($TESTPLAN_FILE)    # PART 3 + PART 4 inline

CALL {role_resolution.docs_publish.mcp}.createPage(
       space     = {docs_publish_target}.space,
       parent_id = {docs_publish_target}.parent_page_id,
       title     = title,
       body      = body,
       state     = {docs_publish_target}.state or "draft",
     ) → {id, url}

ON success:
  Append to $LLD_FILE frontmatter (preserve existing keys):
    published_to:           {docs_publish.mcp}
    published_id:           {id}
    published_url:          {url}
    published_state:        draft
    published_content_hash: {sha256(body)}
    published_at:           {iso8601 now}
  Append to $CONTEXTS_FILE Companion Files section:
    "- **LLD draft (published)**: {url} — _state: draft, provider: {docs_publish.mcp}_"
  Update JIRA comment from C.5 step 3 to append the published URL (best-effort).
  Active Context: "docs_publish ✓ ({mcp}: createPage, ~3K out / ~100 in)"

ON failure (Decision #1 — warn + local-only):
  WARN with the MCP error verbatim:
    "⚠ docs_publish: createPage failed — {error}.
     Local $LLD_FILE remains canonical. Pipeline continues; re-run by amending
     and saying Go again, or fix the MCP issue and re-trigger."
  Do NOT halt. Do NOT retry. Active Context: "docs_publish ✗ (publish failed) · local-only"
```

**Step 6 — execute action (updatePage, when frontmatter has `published_id` AND content_hash differs):**

```
body = (read($LLD_FILE) + "\n\n---\n\n" + read($TESTPLAN_FILE))

CALL {role_resolution.docs_publish.mcp}.updatePage(
       id    = {frontmatter.published_id},
       body  = body,
       state = {frontmatter.published_state},   # NEVER auto-promote (Decision #2)
     ) → {id, url, version}

ON success:
  Update $LLD_FILE frontmatter:
    published_content_hash: {sha256(body)}
    published_at:           {iso8601 now}
    published_version:      {version}
  Active Context: "docs_publish ✓ ({mcp}: updatePage v{version}, ~3K out / ~100 in)"

ON failure: same warn-and-continue path as createPage.
```

**Decisions baked in (do not deviate without revisiting the plan):**

| # | Decision | Where it shows |
|---|---|---|
| 1 | MCP failure → warn + local-only | createPage / updatePage failure paths above |
| 2 | Ship does NOT auto-promote draft → published | `state` carried verbatim from frontmatter; no transition logic in C.5b or Ship |
| 3 | Use developer's MCP token (no service account) | No auth handling here; relies on the resolved MCP's existing OAuth/token from `mcp_servers` |
| 4 | Test plan inlined in the same page | body = LLD body + "---" + test plan body |
| 5 | Content-hash idempotency on amendment | Step 4 (skip) and step 6 (updatePage) gated on hash compare |
| 6 | Title format `{TICKET_ID} LLD — {title}` | Default applied when `title_format` is absent in target config |
| 7 | **User gate before publishing** (this revision) | Step 5 — explicit Yes/No/Disable/Never-ask prompt; default `publish_gate: always` |

**Token cost reminder (single source of truth — keep in sync with `pipeline.{PACK}.forauthor.readme.md` Block 2b):**
- Gate prompt itself: ~150 input + ~50 output ≈ **$0.001** per gate firing (the prompt is tiny — just metadata, no body)
- First publish (gate `Yes` → createPage): ~200 input + ~3K output ≈ **$0.05**
- Amendment with content change (gate `Yes` → updatePage): ~200 input + ~3K output ≈ **$0.05**
- Idempotent skip (content hash unchanged): ~50 tokens ≈ **$0.001** — short-circuits before the gate
- Gate `No` / `Disable` / no-config skip: ~150 tokens for the gate itself (or zero if config short-circuits) ≈ **$0.0001–$0.001**
- 15-story epic typical (gate `Yes` each time, default `publish_gate: always`): **~$0.75–$1.05** added on top of the pipeline cost — about $0.05 more than the no-gate design, well within the savings the pipeline already delivers.



---

## Rules

- Load Ticket Schema skill BEFORE reading the ticket
- Parse EVERY section defined in schema — zero skipped
- Given/When/Then: extract all three components per AC
- **understand_ticket (A) MUST produce a written Requirement Summary in the LLD file** — all downstream agents depend on it
- **synthesize_lld step B.2 consumes the Requirement Summary as source of truth** — do not re-derive from raw JIRA
- **synthesize_lld step B.3 consumes the Enriched AC Registry** — tasks come from ACs only
- **synthesize_lld step B.4 consumes Cross-Reference Findings** for Layer 3 edge case and regression tests
- **Tasks come from ACs ONLY.** Comments, subtasks, attachments, linked items SUPPORT AC understanding — they never independently create tasks.
- Comments refine/constrain AC implementation — later decisions override earlier text
- Subtasks validate your AC understanding — if they reveal a missing AC, derive the AC first
- Attachments provide visual context for ACs — unreferenced ones flagged
- Every AC → ≥1 task. Every in-scope item → covered by ≥1 AC.
- Checkpoint MUST show the Requirement Summary (not just counts) — user validates synthesis BEFORE LLD generation
- Epic-context reading extracts BOTH knowledge (for summary) AND file existence map (for task decomposition)
- Self-heal epic-context: if spikes exist in JIRA but not in epic-context, fetch and append
- LLD is the CONTRACT. Branch only after "Go."
- Bug Mode handled inline — ticket schema parses, synthesize_bug_context (B-Bug) writes the document, Explorer localizes.
- **Tool Usage Ledger (MANDATORY):** Before rendering the final `[Step N/5] {agent} — DONE` gate, append your run's block to `$TOOL_USAGE_FILE` per `agent-flow.mdc § Tool Usage Tracking`. Block schema, counting rules, and aggregation are defined there — do NOT duplicate the schema in this file. Applies to all run modes (story / bug / bundle / standalone). Skipped block triggers a post-execution-verification warning.
