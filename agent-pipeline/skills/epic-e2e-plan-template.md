---
name: epic-e2e-plan-template
description: Template for epic-e2e-plan.md — a single living document that is both the E2E test plan AND the record of its latest run. Built up story by story, regardless of whether stories use the pipeline or are coded manually. Used by Ship (auto-append for pipeline stories), by AC-E2E-Check (to run and update statuses), and by the manual update/sync commands (for non-pipeline stories).
---

# Epic E2E Plan — {EPIC_ID}

**Epic:** {epic_title}
**Goal:** {one sentence — what the user can do when the epic is complete}
**Primary persona:** {role}

---

## Coverage Summary

| Last plan update | Last test run | Stories in plan | Total steps | Manual steps | Last run result |
|------------------|---------------|-----------------|-------------|--------------|-----------------|
| {date} by {TICKET_ID} via {pipeline\|manual} | {date or "never"} | {N} of {M} | {K} | {M_count} | ✅ {P} / ❌ {F} / ⏭ {S} / 🔲 {U} |

**Stories in plan:**
- PROJ-1234 — Reviewer selector UI — pipeline — 2026-04-10
- PROJ-1235 — Submit assignment — pipeline — 2026-04-12
- PROJ-1236 — Email notification — **manual** — 2026-04-14
- PROJ-1237 — Reviewer dashboard — pipeline — 2026-04-15
- PROJ-1238 — Bulk reassign — **manual** — 2026-04-16

**Stories NOT in plan (from last JIRA sync):**
- PROJ-1240 — Audit log entry — detected 2026-04-16
  → Add: `Update epic plan {EPIC_ID} with PROJ-1240`

---

## Preconditions

```
Environment:  {demo.base_url}
Login user:   {demo.auth.username} (rights: {list})

Test data:
  group_cert_id:      {value or "NOT SET"}
  individual_cert_id: {value or "NOT SET"}
  empty_cert_id:      {value or "NOT SET"}
  reviewer_user_id:   {value or "NOT SET"}

Routes used: {list of demo.routes keys}
```

---

## Scenario 1: Happy Path — {name}

| # | Action | Expected | AC | Story | Last Result | Screenshot |
|---|--------|----------|-----|-------|-------------|------------|
| 1 | Navigate to cert list | Page loads | AC1 | PROJ-1234 | ✅ 2026-04-15 | epic_s1_01.png |
| 2 | Open group cert | Detail panel visible | AC2 | PROJ-1234 | ✅ 2026-04-15 | epic_s1_02.png |
| 2a | Verify browser back button works | Returns to cert list | — | **custom** | 🔲 not run | — |
| 3 | Select reviewers | Chip shown in selector | AC1 | PROJ-1235 | ✅ 2026-04-15 | epic_s1_03.png |
| 4 | Submit assignment | Success notification | AC2 | PROJ-1235 | ✅ 2026-04-15 | epic_s1_04.png |
| 4a | Verify cert record updated in DB | reviewers_assigned = 2 in cert table | — | **custom** | 🔲 not run | — |
| 5 | Notification created | /rest/ui/notifications has record | AC1 | PROJ-1236 | ❌ 2026-04-15 | epic_s1_05.png |
| 6 | Login as reviewer | Dashboard loads | AC2 | PROJ-1237 | ✅ 2026-04-15 | epic_s1_06.png |
| 7 | Cert in reviewer inbox | Assigned cert visible | AC3 | PROJ-1237 | ✅ 2026-04-15 | epic_s1_07.png |
| 8 | Bulk reassign UI | Reassign button when multi-select | AC1 | PROJ-1238 | 🔲 not run | — |

*Step 2a and 4a were manually added by the developer — not derived from any AC.
The `Story` column says `**custom**` which marks them as manual. Pipeline never modifies these rows.*

---

## Scenario 2: Edge Cases

| # | Action | Expected | AC | Story | Last Result | Screenshot |
|---|--------|----------|-----|-------|-------------|------------|
| 1 | Open cert with no reviewers | Empty state shown | AC3 | PROJ-1234 | ✅ 2026-04-15 | epic_s2_01.png |
| 2 | Submit with nothing selected | Button disabled | AC3 | PROJ-1235 | ✅ 2026-04-15 | epic_s2_02.png |

---

## Scenario 3: Error Paths

| # | Action | Expected | AC | Story | Last Result | Screenshot |
|---|--------|----------|-----|-------|-------------|------------|
| 1 | Reviewer fetch → 500 | Error notification, no crash | AC4-F2 | PROJ-1234 | ✅ 2026-04-15 | epic_s3_01.png |
| 2 | User lacks CERTIFY_ANYONE | Selector hidden | AC6 | PROJ-1234 | ⏭ no_right_user not set | — |

---

## Cross-Story Data Integrity Checks

Automated checks that only epic mode can run — verifies data flows between stories.

| # | Check | Last Result |
|---|-------|-------------|
| 1 | Story 1 opened certId === Story 2 submitted certId | ✅ 2026-04-15 |
| 2 | Story 2 submit → Story 3 notification references same certId | ❌ 2026-04-15 — notification.certId was null |
| 3 | Story 2 assigned reviewer → Story 4 dashboard shows them | ✅ 2026-04-15 |

---

## Last Run — Full Details

**Run info:**
- Date: 2026-04-15 14:32 IST
- Triggered by: `Demo epic PROJ-EPIC-100`
- Mode: `ai_browser`
- Environment: {demo.base_url}
- User: {demo.auth.username}
- Duration: 4m 12s
- Build status: ✅ PASS (`ant build` before run)

**Issues found:**

| Sev | Step | Description | Screenshot |
|-----|------|-------------|------------|
| P1 | S1 step 5 | GET /rest/ui/notifications returned 404 | epic_s1_05.png |
| P1 | Cross-story #2 | notification.certId null — PROJ-1236 T5 must set this | epic_s1_05.png |
| P2 | S3 step 2 | no_right_user not configured — cannot verify permission AC | — |

**Console: 1 new, 3 pre-existing**
**Network: 1 failure**
**Screenshots: contexts/screenshots/{EPIC_ID}/2026-04-15_14-32/**

---

## Run History

| Date | Triggered by | Mode | Steps passed | Issues |
|------|--------------|------|--------------|--------|
| 2026-04-15 | Demo epic PROJ-EPIC-100 | ai_browser | 15/18 | 2 P1, 1 P2 |
| 2026-04-12 | Demo PROJ-1235 | story mode | 4/4 | — |
| 2026-04-10 | Demo PROJ-1234 | story mode | 5/5 | — |

---

## Step Status Legend

```
✅ Passed in last run (date shown)
❌ Failed in last run (see Issues for reason)
⏭ Skipped (test data or config missing)
🔲 Never run — step added but not verified yet
```

---

## Manual Editing (developer workflow)

**The plan is a plain markdown file** at `contexts/{EPIC_ID}/epic-e2e-plan.md`.
Developers can open it in any editor and add steps not covered by any AC.

### When to add manual steps

- Regression checks an AC doesn't explicitly call out (browser back button, DB state after write, accessibility checks)
- Team-specific QA requirements beyond what JIRA captures
- Steps that verify system behaviour, not story behaviour (session timeout, concurrent edits)
- Custom edge cases found during exploratory testing

### How to add manual steps

**Open the plan → find the scenario table → add a new row:**

```markdown
| 2a | Verify browser back button works | Returns to cert list | — | **custom** | 🔲 not run | — |
```

Rules for manual rows:
1. **Step number**: use a sub-number (e.g. `2a`, `4a`) to avoid breaking pipeline-added rows
2. **AC column**: use `—` (no AC — the step is custom)
3. **Story column**: use `**custom**` or `**custom: @alice**` — anything NOT a TICKET_ID
4. **Last Result**: `🔲 not run` (AC-E2E-Check will fill this on next run)
5. **Screenshot**: `—` (filled after AC-E2E-Check runs)

### Preservation guarantee

Ship, Review, Sync, Update — **none of these will ever modify or delete a row where the Story column value is not a TICKET_ID pattern**.

Specifically, the preservation rule:
```
IF row.Story matches /^(TICKET_PREFIX)-\d+$/    → pipeline-managed, may be modified
IF row.Story contains "custom" or starts with "@" → manual, NEVER touched
```

This means you can hand-edit the plan, and the next 10 stories through the pipeline will add their rows around yours without disturbing them.

### What manual rows get

When `Demo epic {EPIC_ID}` runs:
- Manual rows execute like any other row
- Their Last Result column updates (✅ / ❌ / ⏭)
- Their Screenshot column fills in
- They appear in Issues / Run History like any other step

Manual rows are first-class citizens in the plan.

### Adding whole scenarios manually

If you need a scenario the pipeline wouldn't create (e.g. Scenario 4: "Performance checks" or "Accessibility"), just add it:

```markdown
## Scenario 4: Performance — manually added

| # | Action | Expected | AC | Story | Last Result | Screenshot |
|---|--------|----------|-----|-------|-------------|------------|
| 1 | Cert list with 500 rows | Renders in <2s | — | **custom** | 🔲 not run | — |
| 2 | Scroll to bottom | No frame drops | — | **custom** | 🔲 not run | — |
```

The next `Demo epic` run picks it up automatically.

---

## Authoring Rules (for Ship, Review, update/sync commands)

Used by automated agents when appending steps. **Never applies to manual rows.**

1. **Preservation check FIRST** — before any modification, verify target row's Story column matches a TICKET_ID pattern. If not (manual row), skip.
2. **Add to "Stories in plan"** table: TICKET_ID, summary, source (pipeline/manual), date
3. **Classify each AC** into scenario: success → S1, empty/null → S2, error/permission → S3, new type → Sn
4. **Each pipeline step row**: Action, Expected, AC, Story (TICKET_ID), Last Result (🔲 until run), Screenshot (— until run)
5. **User-journey order within scenarios**. If new story's steps interleave with existing pipeline steps, renumber THOSE ONLY. Skip over manual rows (preserve their sub-numbers like `2a`).
6. **Never touch existing Last Result columns** — only AC-E2E-Check updates those
7. **Update Coverage Summary** at the top (plan update date, counts — count manual steps separately)
8. **Add cross-story integrity check** when 2+ stories interact — Story X creates data, Story Y reads it
