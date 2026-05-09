---
name: iiq-lld-generator
description: IIQ LLD document generator (Design Template 8.5+). Use when the orchestrator reaches Phase B (DESIGN). Contains the full LLD template, all IIQ-specific sections, task list + test plan format, security checklist, content quality rules, and validation checklist. Read BEFORE writing any LLD content. Template reference also at .cursor/templates/IIQ_DESIGN_TEMPLATE_8.5+.md
---

# IIQ LLD Generator Skill

The orchestrator provides WHAT goes in (from Phase A). This skill defines HOW to structure it.

## Inputs from Orchestrator Phase A

- Prior context (HLD, sibling LLDs, patterns, decisions, conflicts)
- Use cases, ACs, edge cases, assumptions, gaps
- Figma analysis (components, states, design tokens) — or confirmed absent
- Story type (UI, Backend, Full-stack, Migration)
- Section selection with rationale

---

## LLD Document Structure (IIQ Design Template 8.5+)

Generate in this exact order. Mark unused sections as "N/A". The document has **4 top-level parts** separated by H1 headings (`# PART N`). This makes it scannable for humans and lets agents jump directly to the section they need.

### PART 1 — LLD (Design)

| # | Section | Required? |
|---|---------|-----------|
| 1 | Document Information | ALWAYS |
| 2 | Introduction | ALWAYS |
| 3 | Use Cases | ALWAYS |
| 4 | Prior Context & HLD Reference | ALWAYS |
| 5 | Implementation > Summary | ALWAYS |
| 6 | Implementation > User Interface | If UI changes |
| 7 | Implementation > REST API | If API changes |
| 8 | Implementation > Object Design | If class/component changes |
| 9 | Implementation > Data Persistence | If state management needed |
| 10 | Implementation > Install / Upgrade | If deploy changes |
| 11 | Implementation > Security | ALWAYS (checklist) |
| 12 | Implementation > Performance | If performance-sensitive |
| 13 | Implementation > Auditing | If audit logging needed |
| 14 | Implementation > Accessibility | ALWAYS |
| 15 | Implementation > Localization | If new user-facing strings |
| 16 | Implementation > UI Config | If UIConfig changes |
| 17 | Implementation > UI Common Style & Branding | If new styles |
| 18 | Implementation > Documentation Recommendations | If public docs needed |
| 19 | Implementation > Legacy Code Analysis | REQUIRED if migration |
| 20 | Implementation > Miscellaneous | If other details |
| 21 | Implementation > Troubleshooting | If logging/config aids |
| 22 | Implementation > Questions/Assumptions | ALWAYS |

### PART 2 — LLD Tasks (Implementation)

| # | Section | Required? |
|---|---------|-----------|
| 23 | Implementation Task List (T1-Tn only) | ALWAYS |
| 24 | AC ↔ Task Traceability Matrix | ALWAYS |
| 25 | Task Dependency Graph | ALWAYS |

### PART 3 — Test Plan

| # | Section | Required? |
|---|---------|-----------|
| 26 | Layer 1: AC Test Cases | ALWAYS |
| 27 | Layer 2: Task Verification | ALWAYS |
| 28 | Layer 3: Edge Case & Regression | ALWAYS |
| 29 | Test Recommendations (QA focus) | If QA focus areas |

### PART 4 — Test Plan Tasks (Code)

| # | Section | Required? |
|---|---------|-----------|
| 30 | Test Task List (T-TC1-Tn only) | ALWAYS |
| 31 | Test AC ↔ Task Matrix | ALWAYS |
| 32 | Test Summary | ALWAYS |

---

## Section Details

### 1. Document Information

```markdown
| Field | Value |
|-------|-------|
| Jira EPIC | {EPIC_ID link} |
| Jira Main Ticket | {TICKET_ID link} |
| Jira LLD Tickets | {subtask link or N/A} |
| Jira UI/UX Ticket | {related UI ticket or N/A} |
| Owner | {Jira assignee} |
| Approvers | {suggest from project patterns — user confirms} |
| HLD | {Confluence link or N/A} |
| AC & Use Cases | [link to section within LLD] |
| Related | {cross-references — user fills} |
| Git branch | {TBD — filled after approval} |
| Base branch | develop |
```

### 2. Introduction

**CRITICAL rules:**
- Concise: 2-3 sentences, max ~500 chars
- Purely problem-and-purpose: describe WHAT and WHY only
- MUST NOT contain: API URLs, endpoint paths, backend ticket references, technical implementation details
- Brief out-of-scope note (blockquote) is acceptable if needed
- No sub-sections (no "Problem Statement", "Solution", "In Scope" breakdowns)

### 3. Use Cases

**CRITICAL:** Do NOT repeat acceptance criteria as use cases. If AC is linked in Document Information, this section should be minimal — only edge cases or concepts not obvious from the AC.

### 4. Prior Context & HLD Reference

From orchestrator Phase A:
- Link to parent epic HLD in Confluence
- Links to sibling story LLDs (eligible statuses)
- Patterns/components being reused (with source)
- Design decisions inherited
- Conflicts resolved

If none: "No prior HLD or sibling LLDs found."

### 5. Implementation > Summary

- What are the main changes required?
- Which areas of the application are affected?
- High-level overview with key technical decisions
- Diagrams if needed (sequence, flow, architecture)
- Min 200 characters

### 6. Implementation > User Interface (if applicable)

**CRITICAL:** This section should contain Figma screenshots/links ONLY. Do NOT add explanatory text describing UI elements unless there is a specific deviation between story and Figma to highlight.

For table/grid implementations, identify:
- Custom renderers or dynamic components
- Role-based rendering or permission-based UI changes
- Migration from legacy UI framework (triggers Legacy Code Analysis)

### 7. Implementation > REST API (if applicable)

**CRITICAL:** Document ALL endpoints used (not just new ones):
- List/grid data endpoints
- Detail/individual item endpoints
- Metadata endpoints (icons, tooltips, status)

Must include:
- API-to-UI mapping table (API fields → UI columns/elements)
- Request/response payloads (concise samples)
- Validation requirements
- Rights/permissions needed
- Special/custom fields (prefixes, formatting)

### 8. Implementation > Object Design (if applicable)

- Classes/objects added or modified
- For UI: custom renderers, component decorators, selectors, templates, TypeScript interfaces
- Document: NEW vs MODIFIED vs REUSED files
- Minimal code snippets (< 20 lines) for key design decisions only
- No full class definitions — use tables or bullet points instead

### 9. Implementation > Data Persistence (if applicable)

State management approach and impact.

### 10. Implementation > Install / Upgrade (if applicable)

- Changes to init.xml or upgradeobjects.xml
- Database migrations
- Deployment changes

### 11. Implementation > Security (ALWAYS)

Full IIQ security checklist — all 11 questions:

| # | Question | Answer | Action |
|---|----------|--------|--------|
| 1 | Any architectural changes to previously reviewed/approved Epics? | Yes/No | |
| 2 | Any addition/modification to authentication or authorization? | Yes/No | Security Architect review |
| 3 | Any addition/modification of encryption implementations? | Yes/No | Security Architect review |
| 4 | Any modification of security policies or controls? | Yes/No | |
| 5 | Any addition/modification to data storage mechanisms? | Yes/No | |
| 6 | Any addition/modification of input/output validation frameworks? | Yes/No | |
| 7 | Any addition/modification of auditing/logging services? | Yes/No | |
| 8 | Any features involving sensitive data (PII)? | Yes/No | Encryption + audit |
| 9 | Features involving file upload/download or external data transfers? | Yes/No | |
| 10 | A new service/microservice, particularly internet-exposed? | Yes/No | Security Architect review |
| 11 | Any new data requiring encryption? | Yes/No | |

**If any "Yes" not addressed in HLD → flag Security Architect review.**

### 12-13. Performance / Auditing (if applicable)

Performance: expected impact, optimization strategies, testing needed.
Auditing: events to capture, information to log.

### 14. Accessibility (ALWAYS)

Default: "No additional changes to general approach [link to IIQ Accessibility Guidelines]"
If special considerations: document them.

### 15. Localization (if applicable)

New keys in code block format with default values.

### 16. UI Config (if applicable)

UIConfig keys added/modified. XML configuration snippets (< 30 lines).

### 17. UI Common Style & Branding (if applicable)

New CSS variables, component styling inheritance. Default: "Reuses existing styles; no new styles introduced."

### 18. Documentation Recommendations (if applicable)

Public documentation changes needed. Note Scrum master creates DOCS ticket.

### 19. Legacy Code Analysis (REQUIRED for migration, omit otherwise)

**CRITICAL:** Check if ticket is part of UI framework migration.

If migration:
- Legacy code/systems being modified
- How legacy implementation handles the feature
- Role-based checks or permission logic in legacy code
- Renderer/component names in legacy code
- Key business logic to preserve (snippets < 15 lines)
- Ensure new implementation covers all legacy logic

### 20. Miscellaneous (if applicable)

Other technical details.

### 21. Troubleshooting (if applicable)

Troubleshooting: logging, config aids.

### 22. Questions & Assumptions (ALWAYS)

Should be empty or minimal. Document clearly for resolution.

---

## PART 2 — LLD Tasks (Implementation)

Start this part with an H1 heading in the generated LLD:
```markdown
# PART 2 — LLD Tasks
```

**This section contains ONLY implementation tasks (T1-Tn). Test tasks (T-TC*) go in PART 4.**

### Section 23: Implementation Task List

#### Task table — ALL fields required

```markdown
| ID | Description | Layer | Files | ACs | Depends On | Status | Verify By |
|----|-------------|-------|-------|-----|------------|--------|-----------|
| T1 | ... | Frontend | web/ui/js/... | AC1 | — | 🆕 | ... |
| T2 | ... | Backend | src/sailpoint/... | AC2 | T1 | 🆕 | ... |
```

**Fields:**

| Field | Format | Description |
|-------|--------|-------------|
| ID | `T1`, `T2`, `T3` | Implementation tasks ONLY. Sequential numbering. |
| Description | One-liner | What to implement — high-level, no sub-grouping |
| Layer | See table below | Codebase layer — determines which coding standard skills the Surgeon loads |
| Files | IIQ repo paths | Target files (`web/ui/js/`, `src/sailpoint/`) |
| ACs | AC1, AC2 | Which acceptance criteria satisfied |
| Depends On | T1, T2 or `—` | Prerequisites. Determines surgeon execution order. |
| Status | 🆕 / 🔍 / ❓ | Explorer refines these. |
| Verify By | Testable check | Compile, UI check, API call, test run |

Do NOT include story point estimates unless explicitly requested.

**Standardized Layer values** (Surgeon uses these to load coding standard skills):

| Layer value | When to use | Files pattern | Surgeon loads |
|-------------|------------|---------------|---------------|
| `Frontend/Angular18` | Task modifies modern Angular code (Angular 18, NgModule, RxJS, NgRx) | `web/ui/ts/**/*.ts` | `iiq-angular18-standards.md` |
| `Frontend/AngularJS` | Task modifies legacy AngularJS 1.8 code ($scope, angular.module) | `web/ui/js/**/*.js` | `iiq-angularjs-standards.md` |
| `Frontend/ExtJS` | Task modifies ExtJS grids, panels, stores | `web/ui/js/**/*Grid.js`, `*Panel.js` | `iiq-extjs-standards.md` |
| `Frontend/XHTML` | Task modifies page templates | `web/ui/page/**/*.xhtml` | `iiq-xhtml-standards.md` |
| `Backend/Java` | Task modifies Java services, utilities | `src/sailpoint/service/**`, `src/sailpoint/tools/**` | `iiq-java-standards.md` |
| `Backend/REST` | Task modifies REST resource classes | `src/sailpoint/web/rest/**` | `iiq-java-standards.md` + `iiq-rest-api-standards.md` |
| `Full-stack` | Task spans both JS/TS and Java files | Both `web/ui/` and `src/sailpoint/` | Frontend skill (Angular18 or AngularJS based on path) + `iiq-java-standards.md` |
| `Test` | Task creates/modifies test files | `test/**` | `iiq-test-standards.md` |

**Critical: Angular 18 vs AngularJS distinction**

These are two different frameworks coexisting in IIQ. The Layer value MUST reflect which one:
- File path contains `web/ui/ts/` → `Frontend/Angular18` (modern Angular, NgModule, TypeScript)
- File path contains `web/ui/js/` → `Frontend/AngularJS` (legacy 1.8, $scope, JavaScript)

Choose the MOST SPECIFIC layer that applies. If a task touches both an AngularJS controller and an ExtJS grid, use `Frontend/AngularJS` (primary) and note ExtJS in the description — the Surgeon's additional trigger rules will load ExtJS standards when it sees ExtJS-related files.

### Section 23b: Per-Task Implementation Details (placeholder-filled by Explorer)

Below the task table, Orchestrator emits ONE detail block per task with placeholder fields that **Explorer fills in after Phase C approval**. This is how the LLD becomes a complete single-document specification instead of splitting across LLD + exploration.md.

**What the user approves at Phase C:** the task table above (Section 23) + the SHAPE of each detail block below. Orchestrator's best-guess `Files:` is the starting point; Explorer refines it. `Insertion Point:`, `Reuse Match:`, and `Explorer Notes:` are left as placeholders — the user knows they'll be filled after Explorer runs.

**Block format (Orchestrator writes the skeleton; Explorer fills `Insertion Point` / `Reuse Match` / `Explorer Notes`):**

```markdown
#### T1 — {task one-liner from the table}

- **Action:** {CREATE 🆕 | MODIFY 🔧 | EXTEND 🟡 | REUSE ♻️}
- **Files** (Orchestrator best-guess; refined by Explorer): {files_from_table}
- **Insertion Point** _(pending Explorer)_: {Explorer writes: "Insert after line N (after <anchor>)" or "Modify <function> at lines start-end" or "NEW FILE"}
- **Reuse Match** _(pending Explorer)_: {Explorer writes: "♻️ sp-dropdown at web/ui/ts/common/sp-dropdown/... (exact path)" or "— no reuse, new code"}
- **Explorer Notes** _(pending Explorer)_:
  {Explorer writes a short block with:
   - 3–5 lines of surrounding code context at the insertion site
   - Gotchas (null checks, event bindings, registration requirements)
   - Dependencies on other tasks in this story
   - Anti-patterns to avoid (based on similar files Explorer scanned)}
```

**Rules:**

- **Orchestrator MUST emit the skeleton with the `_(pending Explorer)_` markers** — even if it has to guess `Files:`, the other three fields stay as placeholders until Explorer runs.
- **Explorer MUST replace the `_(pending Explorer)_` markers in-place** and add actual content. The shape/labels don't change; only the placeholder values are filled.
- **If Explorer can't determine a value** (e.g., task is CREATE with truly novel file → no Insertion Point yet), it writes `_(N/A — new file, see Files above)_` or similar — never leave the placeholder unchanged.
- **Surgeon reads the ENRICHED detail block as its primary per-task reference.** The legacy `$EXPLORATION_FILE` still exists for cross-cutting content (reuse discovery report, stale-map notes, Task Annotation Summary), but per-task insertion points now live in the LLD.

### Section 24: AC ↔ Task Traceability Matrix

Every AC → at least 1 implementation task. Every task → at least 1 AC. Flag gaps.

```markdown
| AC | Tasks | Coverage |
|----|-------|----------|
| AC1 | T1, T3 | ✅ Full |
| AC2 | T2 | ✅ Full |
| AC3 | — | ❌ GAP |
```

### Section 25: Task Dependency Graph

Show execution chains:

```
T1 → T3 → T5
T2 (independent)
T4 → T6
```

**Task Summary:** Total implementation tasks, status breakdown, dependency chains, estimated execution order.

---

## PART 3 — Test Plan

Start this part with an H1 heading in the generated LLD:
```markdown
# PART 3 — Test Plan
```

**This section contains test CASES for QA verification. Test TASKS that need code go in PART 4.**

### Section 26: Layer 1 — AC Test Cases

| TC ID | AC | Test Case | Steps | Expected Result | Type |
|-------|-----|-----------|-------|-----------------|------|

Types: Functional, Negative, Boundary, Accessibility, Integration.

### Section 27: Layer 2 — Task Verification

| Task | Verification Steps | Pass Criteria |
|------|-------------------|---------------|

Feeds the `Verify By` field in PART 2.

### Section 28: Layer 3 — Edge Case & Regression

| TC ID | Scenario | Steps | Expected |
|-------|----------|-------|----------|

### Section 29: Test Recommendations (if applicable)

**CRITICAL:** For QA team, NOT FE unit testing. Only areas of specific impact, edge cases, regression risks that QA should focus on.

---

## PART 4 — Test Plan Tasks (Code)

Start this part with an H1 heading in the generated LLD:
```markdown
# PART 4 — Test Plan Tasks
```

**This section contains test TASKS that require CODE CHANGES (files, fixtures, data). Manual click-through tests stay in PART 3 only.**

### Section 30: Test Task List

Same table schema as PART 2, but for test tasks only:

```markdown
| ID | Description | Layer | Files | ACs | Depends On | Status | Verify By |
|----|-------------|-------|-------|-----|------------|--------|-----------|
| T-TC1 | Unit tests for date validation | Test | test/sailpoint/... | AC1 | T1 | 🆕 | ant jstests |
| T-TC2 | Integration test for API | Test | test/sailpoint/... | AC2 | T2 | 🆕 | ant jstests |
```

**Fields:** Same as PART 2, with these differences:

| Field | Difference |
|-------|------------|
| ID | `T-TC1`, `T-TC2`, `T-TC3` — test task numbering |
| Layer | Always `Test` |
| Depends On | MUST reference the implementation task being tested (e.g., `T1`) |

### Section 30b: Per-Test-Task Implementation Details (placeholder-filled by Explorer)

Mirror of Section 23b, applied to test tasks. Orchestrator emits the skeleton; Explorer fills the placeholders after Phase C.

**Block format per test task:**

```markdown
#### T-TC1 — {test-task one-liner from the table}

- **Covers implementation:** T{N} (from Depends On in the table above)
- **Test Files** (Orchestrator best-guess; refined by Explorer): {files_from_table}
- **Insertion Point** _(pending Explorer)_: {Explorer: "Add test case to existing spec at line N" or "NEW FILE: test/foo.spec.ts"}
- **Reuse Match** _(pending Explorer)_: {Explorer: "Existing test fixture at test/fixtures/... — extend with new case" or "— no reuse"}
- **Explorer Notes** _(pending Explorer)_:
  {Explorer: test framework specifics (Jasmine / Karma / JUnit), fixture dependencies, setup/teardown hooks, mock boundaries}
```

Same rules as Section 23b: Orchestrator writes skeleton + placeholders, Explorer fills in after Phase C, Surgeon reads the enriched block.

### Section 31: Test AC ↔ Task Matrix

```markdown
| AC | Test Tasks | Test Cases (PART 3) | Coverage |
|----|-----------|---------------------|----------|
| AC1 | T-TC1 | TC-AC1 | ✅ Full |
| AC2 | T-TC2 | TC-AC2, TC-EC1 | ✅ Full |
```

### Section 32: Test Summary

Total manual test cases (by type from PART 3) + total test tasks (code from PART 4) + AC coverage across both.

---

## Content Quality Rules

1. **Code blocks < 20 lines** — focus on key design decisions only. No class definitions. Link to actual files instead.
2. **No repetition** — each point mentioned once across all sections
3. **Be specific** — concrete examples, not generic statements
4. **Use tables** — for API mappings, security checklist, field mappings
5. **Include visuals** — Figma screenshots, diagrams where helpful
6. **No placeholders** — no "TBD", "TODO". Complete or mark "N/A".
7. **API-to-UI mapping** — always in REST API section (not Summary)
8. **NEW vs MODIFIED vs REUSED** — clearly separate in Object Design
9. **Introduction stays clean** — no API URLs, no backend refs, no tech details
10. **Test Recommendations = QA-focused** — no FE unit test details
11. **Task list = one-liner bullets** — no grouping, no descriptions

---

## Validation Checklist (before finalization)

**PART 1 — LLD (Design):**
- [ ] Document Information — all fields filled
- [ ] Introduction — concise, 2-3 sentences, problem-and-purpose only
- [ ] Use Cases — edge cases only (not AC repetition)
- [ ] Summary — min 200 chars, key changes and approach
- [ ] Security — all 11 questions answered
- [ ] Accessibility — present (even if default)
- [ ] Questions/Assumptions — present (even if empty)
- [ ] Prior context section present (even if "none found")

**PART 2 — LLD Tasks:**
- [ ] Implementation Task List — min 3 tasks, all fields populated
- [ ] Task IDs are T1-Tn ONLY (no T-TC here)
- [ ] AC ↔ Task Matrix — every AC → at least 1 task, every task → at least 1 AC
- [ ] Task dependencies defined (Depends On field)
- [ ] Verify By is testable (compile, API call, UI check)
- [ ] Dependency graph present

**PART 3 — Test Plan:**
- [ ] Layer 1 (AC Test Cases) present
- [ ] Layer 2 (Task Verification) present — feeds Verify By in PART 2
- [ ] Layer 3 (Edge Case & Regression) present

**PART 4 — Test Plan Tasks:**
- [ ] Test Task List — T-TC IDs only (no T* here)
- [ ] Every T-TC depends on an implementation task from PART 2
- [ ] Test AC ↔ Task Matrix present
- [ ] Test Summary present — totals across PART 3 + PART 4

**Content quality:**
- [ ] No code blocks > 20 lines
- [ ] No "TBD", "TODO", or placeholders
- [ ] API-to-UI mapping table present (if API section exists)
- [ ] NEW vs MODIFIED vs REUSED documented (if Object Design exists)
- [ ] Figma screenshots included (if UI section exists)
- [ ] Legacy Code Analysis included (if migration ticket)

**Jira alignment:**
- [ ] All acceptance criteria addressed
- [ ] Ticket referenced in Document Information
- [ ] Key requirements covered in Implementation

---

## Output

Save to: `contexts/{TICKET_ID}.md`

File should be ready for Confluence upload and approver review.
