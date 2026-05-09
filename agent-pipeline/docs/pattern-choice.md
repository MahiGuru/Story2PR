# Pipeline design: why staged/artifact-driven, not Orchestrator

A plain-language explanation of why our Cursor pipeline is a **staged, artifact-driven pipeline** and why the classic **Orchestrator pattern** does not fit this kind of work.

Scope: Cursor host (`.cursor/agents`, `.cursor/rules`, `.cursor/skills`).

---

## What this doc answers

- What is the difference between the two patterns?
- Why did we pick staged for the 5-agent SDLC pipeline?
- What happens on gates, crashes, amendments, and recovery in each pattern?
- Where do we still use Orchestrator pattern correctly?

---

## The two patterns, simply

### Orchestrator pattern

One main agent runs the whole job. It calls other agents as helpers inside its own conversation. Everything happens in one long session, held in memory.

Analogy: one chef cooking the whole meal, shouting orders at assistants in the same kitchen, at the same time, for the entire meal.

### Staged (artifact-driven) pattern

Each agent runs on its own. It reads inputs from disk, writes outputs to disk, and exits. The next agent is triggered by the user later, reads what the previous agent wrote, and continues.

Analogy: a relay race. Each runner runs their leg, drops the baton (a file on disk), and stops. The next runner picks up the baton later — maybe today, maybe tomorrow.

**In one line:**

- Orchestrator = one long session, in-memory handoff
- Staged = many short sessions, files on disk carry state

---

## Walkthrough: "Work on IIQMAG-1234" in Cursor

### Orchestrator pattern (hypothetical — we do NOT use this)

User types once:

```
@orchestrator.md Work on IIQMAG-1234
```

One Cursor conversation runs end to end:

1. Parse the ticket
2. Call explorer as a subagent → get map back
3. Call surgeon as a subagent → get diffs back
4. Call review as a subagent → get findings back
5. Call ship as a subagent → get PR link back
6. Reply to the user at the very end

Everything lives in one conversation. One long session.

### Staged pattern (what we actually do)

User types five separate triggers. Files on disk carry state between them:

```
1. @orchestrator.md Work on IIQMAG-1234     → writes LLD.md + branch → exits
   (user reviews LLD, says Go)

2. @explorer.md Run the explorer             → writes explorer-map.md → exits
   (user reviews)

3. @surgeon.md Run the surgeon                → writes code + commits → exits
   (user reviews)

4. @review.md Run the review                  → writes review findings → exits
   (user reviews)

5. @ship.md Ship it                            → raises PR → exits
```

Each `@agent.md` trigger is a brand-new Cursor conversation. Files on disk are the handoff between them.

---

## Why Orchestrator pattern does not fit

Six concrete problems.

### 1. One session must stay alive for hours to days

Real stories take hours. Surgeon alone runs 1–6 hours, sometimes multi-day. Cursor cannot hold one conversation open that long — the user will close Cursor, the laptop will sleep, the network will drop, the session will time out.

When any of that happens, the orchestrator session is gone. All its in-memory state (parsed ticket, LLD draft, explorer map, surgeon diffs so far) is RAM that died with the process.

### 2. Crash recovery is broken

This is the single biggest failure. Concrete scenario:

**Day 1:**

```
User: @orchestrator.md Work on IIQMAG-1234

Orchestrator session (in Cursor, in memory):
  - parses ticket ........................ done (in memory)
  - calls explorer subagent ............... done (map in memory)
  - calls surgeon subagent ................ running, 40% through

💥 Power cuts / network dies / Cursor crashes
```

What remains on disk:

- Whatever orchestrator already wrote (maybe `LLD.md`)
- Whatever surgeon already committed to git (maybe 2 of 10 tasks)
- A half-written file surgeon was editing when the lights went out

**Day 2:**

```
User opens Cursor (fresh process, fresh chat)
User: @orchestrator.md Work on IIQMAG-1234

Orchestrator session (brand new):
  - "Hello, let me parse the ticket..."
  - no memory of yesterday
  - no knowledge that explorer ran
  - no knowledge that surgeon was mid-way
```

Orchestrator re-parses the ticket, re-calls explorer, re-calls surgeon. Duplicate work, conflicting files, messy branch.

**Could we make it resume?** Yes, but we would have to build explicit resume logic inside orchestrator:

```
IF contexts/IIQMAG-1234/LLD.md exists AND valid:
    skip ticket parsing, use existing LLD
IF contexts/IIQMAG-1234/explorer-map.md exists AND fresh:
    skip explorer
IF branch feature/IIQMAG-1234 exists AND has commits:
    figure out which surgeon tasks are done (from LLD + git log)
    resume surgeon from next undone task
IF surgeon was mid-file (uncommitted diff on disk):
    decide whether to keep, revert, or ask user
...
```

#### The token cost of resuming (the biggest problem)

Before surgeon writes a single new line of code on Day 2, the resume itself consumes huge token budget. Realistic breakdown:

| Resume step | Estimated tokens |
|---|---|
| Orchestrator system prompt + all `alwaysApply` rules (13 rules) | ~25K |
| Skills loaded eagerly (ticket schema, LLD generator, AC templates) | ~10K |
| Read + validate `LLD.md` | ~10K |
| Read `explorer-map.md` | ~10K |
| Parse git log + figure out task state | ~3K |
| Read branch diff / uncommitted changes | ~10K |
| Surgeon system prompt (inlined in Cursor — no real subagent) | ~25K |
| Surgeon reads LLD + map + git state | ~20K |
| Already-committed task diffs (tasks 1, 2) so surgeon understands prior work | ~20K |
| Files surgeon must edit for remaining tasks | ~10K |
| **Total resume overhead before task 3 begins** | **~140K+** |

Cursor's default context window today is **200K tokens** (Claude Sonnet). So:

- Before surgeon writes one new line, **~140K of the 200K window is already consumed** — just on resume overhead.
- Surgeon has **~60K left** to implement 8 more tasks, read additional source files, run tests, interpret tool output, and respond to user feedback.
- For a real story, **60K is not enough.** Surgeon will run out of context mid-task 5 or 6.

**What happens when context fills up:**

1. **Silent truncation.** Cursor drops earlier messages. The LLD, explorer map, git log summary — all disappear from context. Surgeon "forgets" what it was resuming from and may re-do work, skip tasks, or write conflicting code.
2. **Attention degradation ("lost in the middle").** Even while under the limit, models reason worse on very long contexts. Critical details from the LLD get skimmed or missed.
3. **Hard stop.** Conversation errors out with "max context exceeded." User has to start the entire story over from scratch.
4. **Amendment paralysis.** User wants to change task 7's approach. No room in context to add the new instruction without truncating something important.

**Compare to staged pattern Day 2:**

| Resume step | Estimated tokens |
|---|---|
| Surgeon system prompt + its own rules | ~25K |
| Read `LLD.md` | ~10K |
| Read `explorer-map.md` | ~10K |
| Read git log | ~2K |
| Read current uncommitted diff (just the in-progress task) | ~5K |
| **Total baseline** | **~52K** |

Surgeon starts Day 2 with ~52K used and ~148K free in a 200K window. Plenty of room for 8 more tasks, file reads, tests, amendments. Day 3 if needed — same thing, fresh ~52K start. Day 4 — same.

The orchestrator pattern loses the context game before surgeon even starts. Staged pattern never loads stale state in the first place.

#### Even with resume logic, five structural problems remain

1. **Surgeon's partial state is messy.** Half-written code, uncommitted diffs. Orchestrator has to guess whether to revert or keep. Often wrong.
2. **"Done" is ambiguous.** Is task 3 done because a commit exists? What if the commit is broken?
3. **User amendment intent is lost.** Maybe the user came back to *change* the LLD. "Skip if file exists" prevents intentional redos.
4. **Every stage needs idempotent resume detection.** A whole sub-system to build and maintain.
5. **Cursor still cannot hold the session long enough** even after resuming — surgeon still takes hours in one session.

Durable workflow engines (Temporal, Cadence, AWS Step Functions) do solve this — by persisting workflow state to a database between every step, and by spawning a fresh process per step rather than holding one session open. **A Cursor conversation is not a durable workflow engine.** It has no persistence guarantees and no cross-step process isolation.

### 3. Context bloats with every subagent return

Every subagent return lands in orchestrator's context. By the time ship is called:

```
Orchestrator context at final stage:
  ticket schema          2K
  LLD                    5K
  explorer map           5K
  surgeon diffs + logs  50K
  review findings       10K
  gate Q&A turns         5K
  ─────────────────────
  TOTAL                77K+ tokens
```

Every gate question the user types is processed against this growing context. Token cost climbs. Model attention degrades.

### 4. In Cursor, "subagent" is not real delegation

Cursor has no first-class subagent/Task tool primitive. "Orchestrator calls explorer as a subagent" in Cursor means:

> Orchestrator reads `explorer.md` and executes its instructions inline in the same conversation.

That is not delegation — it is inlining. Every grep, read, and intermediate message from "explorer" lives in orchestrator's one conversation. Zero isolation, zero background.

### 5. User gates force the session to stay alive longer

If orchestrator adds user gates ("proceed? Go / Amend / Cancel"), mechanically it works. But now the session has to stay alive through every gate. Surgeon has gates task-by-task (10 tasks = 10 internal gates). Orchestrator sits there for hours, holding its full context, contributing nothing during surgeon's per-task edits — bystander cost.

### 6. Amendments are expensive

"Re-run explorer, also look at module X":

- **Orchestrator mode:** old map and new map both live in context unless explicit forget logic is built. Tokens paid twice.
- **Staged mode:** re-trigger `@explorer.md` — fresh session overwrites `explorer-map.md`. Free.

---

## Why staged/artifact-driven pipeline works

Six strengths that directly counter the six weaknesses above.

### 1. Files on disk are durable state

LLD, explorer map, git commits, review findings — all survive power cuts, Cursor crashes, machine reboots, overnight breaks. The Cursor session is disposable; the artifacts are not.

### 2. Crash recovery is free

Same crash scenario, staged mode:

**Day 1:**

```
@orchestrator.md Work on IIQMAG-1234  →  writes LLD.md + branch → exits
@explorer.md Run the explorer          →  writes explorer-map.md → exits
@surgeon.md Run the surgeon             →  task 1 committed
                                           task 2 committed
                                           task 3 running  ← 💥 Power cuts
```

**Day 2:**

```
User opens Cursor
User: @surgeon.md Continue IIQMAG-1234

Surgeon session (fresh):
  - reads LLD.md (task list)
  - reads explorer-map.md
  - git log → tasks 1, 2 committed
  - sees uncommitted diff → "Continue task 3 or reset?"
  - resumes from task 3
```

No resume code needed anywhere. Surgeon was going to read files on disk anyway — that is its normal startup. The user does not even have to think "I need to resume." They just trigger the next agent.

### 3. Each stage has a fresh, small context

- Orchestrator session: ticket + schema (~15K)
- Explorer session: LLD + repo map (~20K)
- Surgeon session: LLD + map + current task (~25K)
- Review session: LLD + recent diff + conventions (~20K)

No accumulation. No stale output from earlier stages. Each agent focuses tightly on its own job.

### 4. The user is the scheduler

No automated "run everything." The user decides:

- "Go" by triggering the next agent
- "Amend" by editing the file and re-triggering the current agent
- "Continue tomorrow" by simply not triggering until ready

Humans get full control with zero orchestration code.

### 5. Gates are free

The next `@agent.md` trigger IS the gate. No session lifetime required, no mid-conversation pause, no state to preserve. If the user never triggers the next agent, the pipeline naturally stops.

### 6. Amendments are cheap

Edit the file on disk. Re-trigger the stage. Fresh session overwrites the file. Done.

---

## Side-by-side crash recovery

| Scenario | Orchestrator pattern | Staged pattern |
|---|---|---|
| Day 1 crash during surgeon | Session state lost | Git commits + files persist |
| Day 2 user types same trigger | Runs everything from scratch | User types `@surgeon.md` directly |
| Skipping already-done stages | Needs explicit resume logic | Free — user picks which agent to run |
| Partial surgeon state | Orchestrator must guess | Surgeon reads git + disk, asks user if unsure |
| User wants to amend LLD Day 2 | Must delete file or pass magic flag | Edit LLD, re-run surgeon |
| "Resume" code to maintain | A lot (per stage, per task) | None |

---

## Common questions

### Can Orchestrator pattern support user gates?

Yes, mechanically. The agent can print a question and wait for the user's reply. But then the session must stay alive through every gate (problem #1), and context bloats with every gate (problem #3). Technically possible, practically painful.

### Don't subagents run in the background?

No. Two different things get confused:

| Property | Subagents give you | Subagents do NOT give you |
|---|---|---|
| Context isolation | Yes — intermediate work stays inside | — |
| Execution independence | — | No — parent is frozen, waiting |
| Output isolation | — | No — return value lands in parent context |

Parent is blocked while subagent runs, like any other tool call. Subagent's final output lands in parent's context. And in Cursor specifically, there is no subagent primitive at all — "subagent" means inlining into the same conversation.

### What if I just buy a bigger context window?

Does not fix the crash problem. Does not fix the session-lifetime problem. Does not fix the amendment problem. Context size is only one of the six failures — solving only that one leaves five.

### Why not use a durable workflow engine (Temporal, Step Functions)?

Because we are running inside Cursor. Cursor does not expose a durable workflow runtime. Adding one would mean building a side-car service that Cursor calls into — far more complexity than just letting files on disk be the state. Staged + files is the cheapest durable workflow engine for this host.

---

## Where we DO use Orchestrator pattern (correctly)

Orchestrator pattern is not bad. It is just wrong for long, gated, recoverable SDLC work. We use it exactly where it fits — inside one stage, for short scoped sub-work:

- **`subagent-image-analysis`** — orchestrator spawns it to fetch and analyze ticket/Figma images. Returns a compact `{visual_spec}`. Raw image bytes (which could be 100K+ tokens) never enter orchestrator's context. Runs in seconds.
- **`subagent-amender`** — tight edit loop inside the gate_for_approval phase. Bounded iterations, no human checkpoint mid-loop.

Both fit Orchestrator cleanly:

- Short (seconds to a few minutes)
- Compact structured output
- No human gate needed mid-way
- Raw intermediate data should be kept OUT of the parent context

The five main pipeline stages have the opposite profile — long, gated, recoverable, with large intermediate artifacts that need to persist. So they use staged.

The five other agents (explorer, surgeon, review, ship, project-analyzer) do NOT spawn subagents in their core flow. They are pure stages. Surgeon and review have optional pre/post hook configurations, but those are extension points, not part of the main path.

---

## Real-world precedent

Every mature long-running system in the industry has independently landed on staged/artifact-driven:

- **CI/CD** (GitHub Actions, Jenkins, GitLab CI) — jobs output artifacts, next job downloads them
- **Data pipelines** (Airflow, dbt, Luigi, Dagster) — DAGs of independent tasks with table/file handoff
- **Git** — each command (add, commit, push) exits; the repo is the state
- **Netflix video encoding** — steps write to S3, next step reads; hours per video, survives worker crashes
- **Unix pipes with files** — `grep > a.txt; sort a.txt > b.txt` — each stage exits

Orchestrator pattern wins where it belongs:

- API gateways aggregating 3 microservice calls for one HTTP response (200 ms)
- AWS Step Functions for short workflows
- Kubernetes reconcile loops
- Our own `subagent-image-analysis` and `subagent-amender`

**Rule of thumb from 30 years of real systems:**

> Short + scoped + structured output → Orchestrator.
> Long + gated + recoverable → Staged/artifact-driven.

Our pipeline follows the second rule because SDLC work is long, gated, and must be recoverable.

---

## Final summary table

| Criterion | Orchestrator pattern | Staged pattern (ours) |
|---|---|---|
| Handoff mechanism | In-memory (RAM only) | Files on disk (durable) |
| Session lifetime required | Hours to days | Seconds per stage |
| Crash recovery | Starts from scratch, or needs durable workflow engine | Free — trigger next agent, it reads files |
| Context at final stage | 70K–200K+ tokens accumulated | Fresh per stage |
| User gates | Possible but costly | Built in (next trigger = gate) |
| Amendment cost | High (old state in context) | Low (re-trigger, overwrite file) |
| Cursor host fit | Poor (no subagent primitive) | Native |
| Debugging / audit | One giant interleaved transcript | One clean transcript per agent |
| Multi-day stories | No | Yes |
| User closes laptop mid-story | Session lost, work re-done | No impact |
| Resume code to maintain | Per stage, per task | None |
| Host compatibility | Cursor limited | Works in Cursor and Claude Code |

---

## Verdict

> **Use Orchestrator pattern for short, scoped sub-tasks.**
> **Use staged/artifact-driven pattern for long, gated, recoverable workflows.**

Our pipeline uses both — **staged** for the five main SDLC steps (orchestrator → explorer → surgeon → review → ship), and **orchestrator** inside a step for short sub-work (image analysis, amender).

The name "orchestrator" for the Step-1 agent is a holdover from an earlier version. The overall pipeline is **choreographed**, not orchestrated. But since that agent IS a local orchestrator (for image + amender), the name is not wrong at its own scope — just misleading about the global shape.

The pattern we use has a name:

**Staged, artifact-driven, user-gated pipeline** — a form of **choreography** (peers coordinate via shared artifacts) rather than **orchestration** (one central boss calls everyone).
