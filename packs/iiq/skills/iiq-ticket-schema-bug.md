---
name: iiq-ticket-schema-bug
description: IIQ Bug ticket anatomy + bug understanding synthesis. Parse all 12 sections, ANALYZE TOGETHER to produce a Bug Understanding Summary, build Bug Verification Registry from that understanding. The summary is what Phase B-Bug reads.
---

# IIQ Bug Schema

**Load in Phase A, BEFORE reading the ticket. Skip for Story/Task/Spike.**

Three stages:
1. **PARSE** — read all 12 sections, extract raw data
2. **SYNTHESIZE** — analyze together, produce Bug Understanding Summary
3. **REGISTER** — build Bug Verification Registry enriched by synthesis

---

## Stage 1: PARSE (read all 12 sections)

| # | Section | Where in JIRA | Extract |
|---|---------|---------------|---------|
| 1 | Key Details | Header/sidebar | ID, type, status, priority, **severity** (P0-P3), assignee, **affects version**, **found in** (prod/staging/dev), labels, components, epic link, parent. |
| 2 | Summary | Title field | One-line bug description (often the best single-sentence summary). |
| 3 | Description | Description field | What's broken, context, prior investigation, related ticket refs. |
| 4 | Steps to Reproduce | Description section or custom field | Numbered steps. **If missing → STOP, ask user.** |
| 5 | Expected Behavior | Description section or custom field | What SHOULD happen. Flag if vague. |
| 6 | Actual Behavior | Description section or custom field | What DOES happen. Extract error messages, visual/data/timing symptoms. |
| 7 | Environment | Description section or custom field | IIQ version, browser, OS, user role, data state. |
| 8 | Attachments | Attachments panel | Screenshots (map to repro step), videos (note bug timestamp), logs (extract stack traces), HAR files (failed requests). |
| 9 | Error Messages / Stack Traces | Description, attachments, custom field | VERBATIM. Error text, stack trace (class+method+line), log lines (timestamps+thread names), console errors. |
| 10 | Linked Items | Linked Issues | Parent Story (read LLD for Sub-Bug), related bugs (pattern?), caused by (starting point). |
| 11 | Subtasks | Subtask panel | Reproduction-support only. May have investigation notes. |
| 12 | Comments | Activity tab | Reproduction-support only. "Also reproduces when..." extends repro. "Only with data X" adds prerequisite. |

---

## Stage 2: SYNTHESIZE

**After parsing all 12 sections, STOP. Analyze together.**

### 2a: Bug Identity (from Summary + Description + Environment)

```
BUG IDENTITY:
  WHAT:  {one-sentence — from Summary/Title}
  WHERE: {page/module/API affected — from Description + repro step 1}
  WHEN:  {trigger condition — from repro steps}
  WHO:   {affected role/users — from Environment}
  SEVERITY: {P0-P3} → {impact description}
```

### 2b: Reproduction Understanding (from Steps + Expected + Actual + Attachments)

```
REPRODUCTION:
  PRECONDITIONS: {role, data state, environment — from repro + comments}
  STEPS:
    1. {navigation step} → page/URL: {identified}
    2. {interaction step} → trigger: {identified}
    3. {observation step} → bug manifests here
  EXPECTED: {what should happen at step 3}
  ACTUAL:   {what actually happens}
  
  VISUAL EVIDENCE:
    - {screenshot/video} → shows: {what it proves, mapped to which step}
  
  REPRODUCTION CONFIDENCE:
    - Steps complete? {yes / INCOMPLETE: missing {what}}
    - Consistent? {always / intermittent / rare}
    - Env-specific? {yes: {which env} / no}

### 2b-Intermittent: Special Protocol for Non-Deterministic Bugs

When Reproduction Confidence = `intermittent` or `rare`, standard repro steps are insufficient — the steps describe conditions when it SOMETIMES happens, not WHY. A different analysis is needed.

**Intermittent bug detection triggers:**
- Comments contain: "sometimes", "occasionally", "hard to reproduce", "works on retry", "only happens under load"
- Section 6 says: "Actual: {behavior} — not always", "may not reproduce"
- Steps work most of the time but not always

**Intermittent Analysis Protocol:**

```
Step 1: Collect discriminating conditions
  (What makes it MORE likely to reproduce?)

  □ HIGH LOAD indicator:
    - "only happens with many concurrent users"
    - "works fine alone, breaks with team"
    → Hypothesis: RACE CONDITION or SHARED STATE issue

  □ SLOW NETWORK indicator:
    - "works fast, breaks slow"
    - "works locally, breaks in staging"
    → Hypothesis: ASYNC TIMING issue — promise not chained, callback timing

  □ DATA STATE indicator:
    - "works with test data, breaks with real data"
    - "only for {specific user/role/cert type}"
    → Hypothesis: NULL/EDGE CASE in data — specific field empty, specific combination

  □ SEQUENCE indicator:
    - "only after doing X first"
    - "works fresh, breaks after navigating away and back"
    → Hypothesis: STALE STATE or MISSING RESET — vm properties from prior view

  □ BROWSER/OS indicator:
    - "Chrome fine, Firefox breaks"
    - "only on mobile"
    → Hypothesis: BROWSER API DIFFERENCE or CSS rendering

  □ TIMING indicator:
    - "works in morning, breaks in afternoon"
    - "works right after deploy, breaks later"
    → Hypothesis: CACHE INVALIDATION or SESSION EXPIRY

Step 2: Add to Bug Understanding Summary

  REPRODUCTION CONFIDENCE: intermittent
  DISCRIMINATING CONDITIONS: {list from above}
  LIKELY ROOT CAUSE TYPE: {Race condition / Async timing / Data edge case / Stale state / Browser diff / Cache}

  EXPLORER GUIDANCE:
    Race condition → look for: async calls without proper sequencing,
                    shared vm/scope properties modified by multiple callbacks,
                    missing $q.all() where parallel promises resolve independently
    Async timing  → look for: missing .then() chaining, setTimeout workarounds,
                    $scope.$apply() calls that hint at digest timing issues
    Data edge case → look for: missing null checks BEFORE the failing line,
                    .length access on undefined, assumptions about data shape
    Stale state   → look for: vm properties set on init but never reset on navigate,
                    missing $scope.$on('$destroy') cleanup,
                    event listeners not removed
    Browser diff  → look for: non-standard APIs used without polyfill,
                    CSS that renders differently (flex, grid edge cases)
    Cache         → look for: ETag/Cache-Control headers, browser cache headers,
                    service-level caching that returns stale data

Step 3: Special verification requirement

  For intermittent bugs, standard "verify fix works" is insufficient.
  Add to Explorer's fix task:

  VERIFY BY (intermittent):
  - Fix must address the ROOT CAUSE TYPE (from Step 2), not symptoms
  - Manual: reproduce conditions that made it intermittent, verify no regression
  - Automated: add a test that exercises the specific condition
    (race condition → async test with delay injection)
    (data edge case → test with null/empty/unexpected data)
    (stale state → test navigate-away-and-back sequence)
```
```

### 2c: Error Signal Map (from Errors + Logs + Attachments)

```
ERROR SIGNALS (for Explorer localization):
  UI errors:
    - Message: "{exact error text}" → grep target
    - Console: "{JS error}" → grep target
  Backend errors:
    - Stack trace: {class}.{method}:{line} → file target
    - Log thread: {thread name} → Quartz=scheduled, HTTP=REST
    - Exception: {class} → search target
  Data symptoms:
    - Expected: {value/state}
    - Actual: {value/state}
```

### 2d: Context Map (from Linked Items + Comments + Description)

```
CONTEXT:
  Parent Story: {ID if sub-bug — read its LLD for cross-reference}
  Related Bugs: {similar bugs — pattern?}
  Caused By: {ticket/PR if known — starting point for fix}
  Prior Investigation: {what reporter already tried}
  Comment Insights:
    - "{additional repro info}" → extends understanding
    - "{suspicion/hint}" → hypothesis input for Explorer
```

### 2e: Produce Bug Understanding Summary

```
BUG UNDERSTANDING SUMMARY
═════════════════════════

BUG: {ID} — {title}
SEVERITY: {P0-P3} | AFFECTS: {version} | ENV: {browser, role}

WHAT'S BROKEN:
  {1-2 sentences combining identity + actual behavior}

HOW TO REPRODUCE:
  Pre: {preconditions}
  1. {step} → 2. {step} → 3. {bug appears here}

EXPECTED vs ACTUAL:
  Expected: {what should happen}
  Actual:   {what happens}

ERROR SIGNALS:
  {key signals for Explorer — messages, stack traces, console errors}

EVIDENCE:
  {N} attachments ({screenshots mapped to steps, logs with traces})

CONTEXT:
  Parent story: {if sub-bug}
  Related: {related bugs/stories}
  Hints: {from comments, prior investigation}

GAPS:
  - {missing repro step / vague expected behavior / etc.}
```

---

## Stage 3: REGISTER (build Bug Verification Registry)

**From the synthesis, define what "fixed" means:**

```
BUG VERIFICATION REGISTRY ({N} criteria)

  BV1 (primary fix): After fix, step {N} produces EXPECTED behavior
  BV2 (regression):  Full repro flow still works (no new breakage)
  BV3+ (edge cases): Related scenarios — from comments, related bugs

Each BV entry:
  { id, source, criterion, evidence, error_signals }
```

---

## What the Orchestrator receives

1. **Bug Understanding Summary** — compact picture of the bug (Phase B-Bug uses this for context capture)
2. **Bug Verification Registry** — what "fixed" means (drives fix tasks)
3. **Error Signal Map** — goes directly to Explorer for localization
4. **Gaps** — flagged for user at checkpoint

Phase B-Bug then:
- Writes PART 1 (Bug Context) ← from Bug Understanding Summary
- Leaves PART 2-4 for Explorer ← Explorer uses Error Signal Map + BV Registry

---

## Task Generation — GOLDEN RULE

**Fix tasks come from Bug Verification Criteria ONLY.**

Fix tasks: max 3 (more = escalate to Story Mode).
Regression tasks: 1 per fix task minimum.
Comments, subtasks, attachments = reproduction-support only, never create tasks.
