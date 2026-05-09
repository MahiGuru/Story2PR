# Cost Optimization

**Audience:** maintainers planning per-agent cost reductions. Users running the pipeline don't need to read this.

This document captures (1) the corrected cost model, (2) tool-call reduction opportunities found by audit, and (3) Haiku candidacy assessment for two read-only agents. Use as a target list for follow-up PRs.

---

## 1. Why earlier cost estimates were wrong

Earlier docs (CHANGELOG v23.0 first draft, HOW-TO-USE bundle section first draft, 09-bundle-orchestrator.md first draft) cited per-pipeline costs in the **$2–3/cold-story** range. Those numbers were optimistic by **~10×**.

The miss: they counted **tokens read by the agent during file loads**. They did not count the dominant API-billing line item: **cache reads compounded by tool-call count**.

### Real per-agent cost breakdown (Sonnet 4.5)

Sonnet 4.5 prices: `$3/M input · $15/M output · $3.75/M cache write · $0.30/M cache read`.

A typical Surgeon agent run on a 5-task story:

| Line item | Volume | Rate | Cost |
|---|---|---|---|
| Cache reads (50–120 tool calls × ~80K cached prefix per turn) | 4–10M | $0.30/M | **$1.20–3.00** |
| Fresh input (file reads, JIRA, build output, diff context) | 100–250K | $3.00/M | **$0.30–0.75** |
| Output tokens (manifest, build reports, gate text) | 20–50K | $15.00/M | **$0.30–0.75** |
| Cache write (one-time per chat) | ~80K | $3.75/M | **$0.30** |
| **Per-agent total** | | | **$2–5** (median ~$3) |

For Haiku 4.5 (`$1/M · $5/M · $1.25/M · $0.10/M`), the same volumes work out to **$0.70–2.00 per agent**.

### Real per-pipeline cost (single story, 5 agents)

| Scenario | Sonnet 4.5 | Haiku 4.5 |
|---|---|---|
| Single story cold (each agent in fresh chat) | **$15–30** | **$8–18** |
| Single story warm (back-to-back, sub-5min between agents) | **$8–18** | **$5–10** |
| 10 stories cold sequential (over weeks) | **$150–300** | **$80–180** |
| 10 stories warm sequential (one session, back-to-back) | **$80–180** | **$50–110** |
| 10-story bundle (sequential checkpoints) | **$80–180** | **$50–110** |

Bundle's token win over warm sequential is modest (~10–20%); over cold sequential it's ~50%. The bigger bundle wins are wall-clock + dedup + 1 PR vs N.

### Why cache reads dominate

In Cursor and Claude Code, every tool call (`Bash`, `Read`, `Edit`, `Write`, `Grep`) starts a new API turn that re-sends the full system prompt + conversation history. The cached prefix is cheap-ish ($0.30/M), but it's billed **on every tool-call turn**.

```
turns_per_agent = file_reads + bash_calls + edits + writes + greps
                ≈ 50–120 for Surgeon, 30–60 for Explorer, 20–40 for Review

cached_prefix_tokens = system_prompt + agent_prompt + always_on_rules + project_map + skills
                     ≈ 60–100K depending on agent

cache_read_volume = turns_per_agent × cached_prefix_tokens
                  ≈ 3–12M per agent run
```

This multiplier is the main lever for reducing real cost.

---

## 2. Tool-call reduction opportunities (audit findings)

Agent prompts in this repo describe many sequences as "Read X. Then Read Y. Then Read Z." Prose order is preserved by the executing LLM as sequential turns by default — which means N file reads = N tool-call turns = N × cached-prefix re-reads. **Many of these reads are independent and can run in one turn.**

### Pattern A — Sequential pre-flight file reads

**Where it happens:**
- `surgeon.md` Step 1 ("Resolve paths" + "Read Task Annotation Summary") — 5+ sequential reads
- `explorer.md` Pre-flight ("Read $CONTEXTS_FILE", then $LLD_FILE PART 2, then PROJECT_MAP, then EPIC_CONTEXT) — 4+ sequential reads
- `review.md` Pre-flight (reads CONTEXTS, LLD, TESTPLAN, MANIFEST, EXPLORATION) — 5+ sequential reads
- `ship.md` Step 1 (reads CONTEXTS, LLD, TESTPLAN, MANIFEST, REVIEW) — 5+ sequential reads

**Why it's wasteful:** all these files exist independently — none depends on another's content for path resolution. They could be issued in one turn.

**Recommendation:** add an explicit instruction to each agent's pre-flight: *"All pre-flight file reads (CONTEXTS / LLD / TESTPLAN / MANIFEST / EXPLORATION) are independent — issue them as parallel tool calls in a SINGLE assistant turn, not sequentially."*

**Estimated impact:** −3 to −5 cache-read turns per agent × ~80K prefix = ~$0.10–0.20/agent saving on Sonnet. Across 5 agents per pipeline: ~$0.50–1.00/story.

**Concrete edit locations:**
- `agents/surgeon.md` around line 251 (Step 1 path resolution + read summary)
- `agents/explorer.md` around lines 191–203 (pre-flight read block)
- `agents/review.md` around lines 200–230 (check_prerequisites)
- `agents/ship.md` around lines 93–145 (check_prerequisites)

### Pattern B — Sequential greps for independent patterns in same scope

**Where it happens:**
- `explorer.md` Reuse Discovery (Mode A Phase 1) — multiple greps for component names, service patterns, REST patterns are issued one-by-one
- `surgeon.md` Step 0a (reuse_verification) — 4-tier search runs each tier as a separate grep turn

**Why it's wasteful:** `grep -E '(pattern1|pattern2|pattern3)'` is one tool call instead of three. Or use parallel single-pattern greps issued in one turn if the result-grouping matters.

**Recommendation:** add to relevant agent pre-flight: *"When searching for N independent patterns in the same scope, prefer one combined `grep -E '(p1|p2|p3)'` OR issue N parallel grep calls in a single turn — never sequentially."*

**Estimated impact:** −2 to −4 turns per Explorer/Surgeon run = ~$0.10–0.20 per agent.

### Pattern C — Sequential `git log` / `git diff` / `git status`

**Where it happens:**
- `explorer.md` Phase 1.5 (sync_map): runs `git log --after=...` + `git log {base_branch}..HEAD` + diffs
- `review.md` blast radius: multiple `git diff` invocations
- `ship.md` Step 1 (show_state): `git status` + `git diff --stat` + `git log --oneline`

**Why it's wasteful:** none of these depend on each other's output for routing — they all just gather state.

**Recommendation:** *"Issue git status/diff/log calls in parallel during state-gathering steps. Only sequential when the second command's args depend on the first's output."*

**Estimated impact:** −1 to −3 turns per Explorer/Review/Ship run.

### Pattern D — Per-task file read pattern (highest-leverage)

**Where it happens:** Surgeon's per-task implement loop (Step 2) — for EACH task, the agent reads the target file at insertion point, the reference pattern (REF from codebase map), the loaded Tier 2 skill, then edits.

**Volume:** 5–10 tasks/story × ~3 sequential reads per task = 15–30 read turns × cached prefix = ~1.2–2.4M cache-read tokens just from this loop.

**Why it's wasteful:** the three reads (target file + reference + skill) are independent for any given task.

**Recommendation:** in Surgeon's Step 2, add: *"For each task, the three reference reads (insertion-point file slice, REF pattern file, layer-skill rules) are independent — issue them as parallel Read calls in a SINGLE turn before generating the edit."*

**Estimated impact:** **biggest single lever in the pipeline.** −10 to −20 turns per Surgeon run = ~$0.50–1.00 saved per agent. For a 5-agent pipeline: ~$0.50–1.00/story (Surgeon is the only agent with this pattern at scale).

**Risk:** parallel reads use more tokens at the moment of the parallel turn (3× file content delivered at once instead of staged). Net is still cheaper because the cached prefix is paid once instead of three times — but if files are very large, the parallel turn could be near a context-window threshold. Mitigate by keeping each Read targeted (line range) as already required by the FILE-READ BUDGET rule.

### Pattern E — Build output is large; truncate before context reuse

**Where it happens:** Surgeon and Review both shell out to `builds.runner` which captures full build output. Java/Maven output can be 30–50K tokens. The post-build verdict is computed from the last 30 lines (already captured as `tail_30` in build report YAML), but the full log lives in `/tmp/iiq-build.log`.

**Why it's wasteful:** if Surgeon/Review reads the full log into context to diagnose a failure, that's 30–50K of fresh input → cache write happens → next tool call pays cache-read on this expanded prefix.

**Recommendation:** already handled in part — `agent-flow.mdc § Build report contract` says `On PASS, do NOT read tail_30`. Reinforce: `On FAIL, read $REPORT.tail_30 first; only Read $REPORT.log_path if tail_30 is insufficient AND limit to a 200-line slice around the failure marker, not the whole log.`

**Estimated impact:** prevents cost spikes on FAIL paths — no saving on PASS paths. Variance reduction, not central tendency.

### Pattern F — Standalone modes load less prefix (good — keep)

This is the inverse: Standalone modes (`Research:`, `Apply:`, `Review changes`) already skip pipeline-mode pre-flight and skip many skill loads. They're cheaper per run by ~30–50%. **Don't break this.** When adding new agent capabilities, gate them on pipeline mode unless they're truly needed for standalone too.

### Summary table — estimated savings if all six patterns are addressed

| Pattern | Per-agent saving | Per-pipeline saving (5 agents) |
|---|---|---|
| A — parallel pre-flight file reads | ~$0.10–0.20 | ~$0.50–1.00 |
| B — combined/parallel greps | ~$0.10–0.20 | ~$0.30–0.60 (Explorer + Surgeon) |
| C — parallel git state-gathering | ~$0.05–0.15 | ~$0.20–0.45 (Explorer + Review + Ship) |
| D — parallel per-task file reads in Surgeon | ~$0.50–1.00 | ~$0.50–1.00 (Surgeon only) |
| E — bounded build-log reads on FAIL | variance reduction | variance reduction |
| F — standalone mode preservation | already optimal | — |
| **Total potential saving per single-story pipeline** | | **~$1.50–3.00** |

Off a $15–30/cold-story baseline, that's **~10–20% saving** with no behavior change. Not transformative, but compounding — a team running 50 stories/month saves ~$75–150 in API costs.

---

## 3. Haiku candidacy assessment

The 5–7 pipeline agents are not all created equal. Some require Sonnet's reasoning depth (LLD synthesis, code generation, AC compliance judgment). Others are essentially classification + report-generation tasks that Haiku handles well.

### Strong Haiku candidates

#### `project-analyzer.md`

**Job:** Scan the codebase, classify file roles (component vs service vs DAO), aggregate counts, write `project-map.md`.

**Why Haiku fits:**
- Mostly classification (`is this file a service? a controller? a template?`) and counting
- No design synthesis, no code generation, no AC reasoning
- Output is structured (filling out a template), not free-form prose
- Run frequency is low (once per project + on rescan) — even small accuracy regressions are catchable in the gate output (Phase 8.6 detection review)

**Risk:** Haiku may be sloppier at edge-case classification (legacy patterns, unusual frameworks). Mitigation: the existing Phase 8.6 gate (`Show low-confidence detections`, `Reconsider ignored`) already gives the user a manual review pass — Haiku's marginally-lower precision is recoverable there.

**Mechanism:** change frontmatter:
```yaml
---
name: project-analyzer
model: haiku       # was: inherit
---
```

Cursor / Claude Code respect this directive when invoking the agent prompt.

**Expected saving:** project-analyzer is a one-time setup, not per-story. Per run on a 5K-file codebase: was ~$8–15 on Sonnet, would be ~$3–6 on Haiku. **One-time saving of $5–9.** Modest, but the right kind of cheap-and-good-enough work for Haiku.

#### `ac-e2e-check.md`

**Job:** Cross-reference AC Registry against task list (gap detection), then drive a browser through each AC + screenshot.

**Why Haiku fits:**
- Gap detection is set-difference logic (not reasoning)
- Browser walk is procedural — log in, navigate, click, screenshot
- The hard part (interpreting AC text) is small and bounded (Haiku can read ~100–200 ACs without losing the plot)
- The agent is already optional — if Haiku misses something, Review's AC compliance step (which stays on Sonnet) catches it

**Risk:** subtle AC interpretation errors (e.g., "the button MUST disable on submit" vs "the button SHOULD disable") may misfire. Mitigation: AC verbatim is preserved in the gap report; user review catches it.

**Mechanism:** same frontmatter change — `model: haiku`.

**Expected saving:** when run, ac-e2e-check is ~$3–5 on Sonnet. Haiku version: ~$1–2. **Saves $2–3 per pipeline that runs ac-e2e-check** (it's optional, so impact varies).

### Borderline Haiku candidates

#### `ship.md` for the JIRA-transition + PR-body-generation portion

**Why borderline:** the work is mostly templating (filling PR body) + REST calls (JIRA transitions). Haiku is plenty for that.

**Why kept on Sonnet for now:** Ship is the gate before code lands in main. The "double-gated" pre-push checklist relies on the agent reading `Ship-ready: YES` from review report and reasoning about edge cases (uncommitted changes mismatch, branch divergence). That last 10% of judgment is worth Sonnet — and Ship is short enough (~$1–2/run) that the saving is small.

**If you want to push it:** consider splitting ship.md into a Haiku-driven pre-push step (commit/template) + a Sonnet-driven verdict-and-go gate. Probably more complexity than the saving justifies.

### NOT Haiku candidates (keep on Sonnet)

| Agent | Why Sonnet |
|---|---|
| `orchestrator.md` / `bundle-orchestrator.md` | LLD synthesis is the highest-reasoning task in the pipeline. Haiku's misses cost a 10× downstream re-run. |
| `explorer.md` | Reuse-vs-create decisions are subtle (4-tier search, near-match heuristics, promotion-candidate flags). |
| `surgeon.md` | Code generation. Haiku writes plausible-looking code that fails review more often. |
| `review.md` | AC compliance + blast radius + pattern-fidelity judgment. The ONE place you don't want shortcuts. |

### Haiku rollout plan (recommended)

Don't flip the switch globally. Test in this order:

1. **Project-analyzer first** (lowest risk — one-time setup, gate-reviewable):
   - Change `model: inherit` → `model: haiku`
   - Run `Analyze project` on a representative repo
   - Compare `project-map.md` against the prior Sonnet-generated version (diff the output)
   - If acceptable: keep change. If not: revert frontmatter, file an issue.

2. **AC-e2e-check second** (next-lowest risk — optional agent, Review backstop):
   - Same change
   - Run on a story with 5–10 ACs covering ui_involved scenarios
   - Compare gap report + browser walk against Sonnet baseline

3. **Roll out** if both pass: document expected cost reduction in HOW-TO-USE.

Don't rush this — model swaps are easy to do badly.

### Configuration alternative — pipeline-config-driven model selection

Currently, model is in agent frontmatter. A future improvement: allow `pipeline.yaml` to override per-agent:

```yaml
# Hypothetical — NOT YET IMPLEMENTED
runtime:
  agent_models:
    project-analyzer: haiku
    ac-e2e-check: haiku
    # all others inherit
```

This lets teams choose model per-agent without editing kernel files. Would require installer changes (frontmatter rewrite at install time) or agent-flow.mdc machinery to inject model selection. **Defer — not worth the complexity until per-agent Haiku is proven on test runs.**

---

## 4. Open follow-up work

After the audit + Haiku assessment, here are the concrete next PRs (any maintainer can pick one):

### ✅ Landed in v23.1

- **Patterns A + B + C + D — single rule in `agent-flow.mdc`** (was bullet 5 below). Added "Parallel tool calls (MANDATORY when ops are independent)" to Shared rules. Single instruction covers pre-flight reads, per-task triple-reads (Surgeon's biggest lever), independent greps, git state-gathering. Reversible.
- **Standalone-flow extraction (NEW finding from re-audit)** — extracted ~33K tokens of standalone-mode prompt content out of pipeline-path cached prefix. Files: `modes/standalone-explorer-flow.md` (117L), `modes/standalone-surgeon-flow.md` (959L), `modes/standalone-review-flow.md` (645L). Trimmed `surgeon.md` by 919 lines, `review.md` by 603, `explorer.md` by 80. Saves ~$2.50/pipeline on Sonnet 4.5. Lazy-loaded only when `{mode} == "standalone"` (or `"targeted-fix"` for Surgeon). Pipeline runs (single-story, bug, bundle) do NOT load them.
- **Tool Usage Ledger (`$TOOL_USAGE_FILE`)** — every agent now appends a structured block at end-of-run to a single per-story / per-bundle ledger capturing MCP calls, git ops, bash invocations, file reads/writes, build invocations, and estimated cost. Schema in `agent-flow.mdc § Tool Usage Tracking`. Aggregator: `node contexts/tools/aggregate-tool-usage.mjs`. **This is now the canonical telemetry source for cost analysis** — earlier `<!-- TOKEN_USAGE: -->` per-artifact comments still exist (cross-check) but the ledger is what answers "where did this pipeline run actually spend its tokens?"

### Still open

1. **Test project-analyzer on Haiku** — flip frontmatter `model: inherit` → `model: haiku`, run on this repo, diff `project-map.md` output vs current Sonnet baseline. Estimated saving: $5–9 per scan (one-time), no per-story impact.
2. **Test ac-e2e-check on Haiku** — same approach, on a UI-involved ticket. Estimated saving: $2–3 per pipeline that runs ac-e2e-check.
3. **Surgeon-build-recovery extraction** — `surgeon.md` L815–920 (`## ✗ Build failed (T{n})` recovery section, ~106L) is loaded on every Surgeon run but only executes on build failure. Could move to `modes/surgeon-build-recovery.md` lazy-loaded only when build verdict is FAIL. Saves ~3K tokens of cached prefix per Surgeon run on the happy path. Smaller win than the standalone extraction.
4. **Verify parallel-tool-call rule adoption** — telemetry-based: count tool-call turns per agent run across 5–10 stories. Pre-v23.1 baseline expected 50–120 turns/agent on Surgeon; post-v23.1 should drop to 30–70 if the rule is being followed. If not, escalate the instruction (add per-step reminders in surgeon.md per-task loop).
5. **Add CI guardrail** — a small lint check in `contexts/tools/validate.mjs` that flags any new agent-prompt edit re-introducing standalone or bundle content into a top-level agent file. The pattern is: `mode: bundle` or `mode: standalone` blocks inside `agents/<name>.md` should raise an error / warning, telling the author to extract to `modes/<flavor>-<agent>-flow.md` instead.

---

## 5. What NOT to optimize

A few things look like cost-savers but aren't:

- **Trimming agent prompts further to save cache size.** We already did this with the bundle refactor. Going further means deleting prose that LLMs use for behavior calibration. Result: agent acts dumber, work cycles increase (re-runs), and net cost goes UP. The agent prompts in this repo are dense for a reason.
- **Replacing Sonnet entirely with Haiku.** Haiku is fine for classification but worse at: subtle AC interpretation, code-pattern matching, reasoning about edge cases. A 50% saving on agents that do 30% more re-work is a 5–15% cost INCREASE.
- **Disabling the `agent-flow.mdc` always-on rule.** Saves ~16K cached prefix per turn but breaks invocation-mode detection, halt messages, gate templates. Don't.
- **Aggressive context compaction mid-agent.** Claude Code's auto-compact is designed for very long sessions. Triggering it manually mid-pipeline can lose state Surgeon needs. Let it fire on its own thresholds.
