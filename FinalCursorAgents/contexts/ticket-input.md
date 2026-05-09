# Pre-flight Context for {TICKET_ID}

<!--
  This file is read by Orchestrator during Phase A. It has TWO use modes:

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ MODE A — NORMAL (Atlassian MCP available, no skip flag)                 │
  │   JIRA ticket fetch provides title/ACs/scope automatically.             │
  │   Section 1 + 2 below are OPTIONAL — delete them if empty.              │
  │   Use Section 3+ for supplementary context that's NOT in JIRA.          │
  │                                                                         │
  │ MODE B — OFFLINE (--skip atlassian or --offline)                        │
  │   JIRA is NOT fetched. Section 1 becomes REQUIRED.                      │
  │   If this is the FIRST story of a new epic, Section 2 is also REQUIRED. │
  │   If subsequent story in an existing epic, Section 2 can be skipped     │
  │   (epic-context.md is read locally from the epic folder).               │
  └─────────────────────────────────────────────────────────────────────────┘

  HOW TO USE:

  1. Edit this file in place (it's already at contexts/ticket-input.md after install).
  2. Keep only the sections you need. Delete the rest including these instructions.
  3. Trigger: `@orchestrator.md Work on {TICKET_ID} [--skip atlassian | --offline]`
  4. Orchestrator reads + archives this file after Phase A. For the next
     ticket, re-fill this file (or run without skip flags to use JIRA).

  DELETE THESE INSTRUCTIONS BEFORE RUNNING THE PIPELINE.
-->


## Section 1 — TICKET BASICS

<!--
  REQUIRED when running with --skip atlassian or --offline.
  OPTIONAL when JIRA MCP is active (delete the section).
-->

### Title
<!-- One line: the ticket title as you'd write it in JIRA. -->

### Story summary
<!-- One paragraph: what this ticket does and why. -->

### Acceptance Criteria
<!-- Use Given/When/Then or numbered bullets. -->
- AC1: Given ... When ... Then ...
- AC2: Given ... When ... Then ...
- AC3: ...

### In scope
<!-- What MUST be delivered. -->
-

### Out of scope
<!-- What must NOT be touched. Other teams' code, deprecated paths, migrations. -->
-

### Priority / Sprint / Assignee
- Priority:
- Sprint:
- Assignee:

### Issue type
<!-- story | bug | spike (defaults to story if omitted) -->
story

### Parent epic
<!-- Epic ID + title, if known. Used by Orchestrator to find epic-context.md. -->
<!-- If blank, Orchestrator treats this as a standalone ticket. -->


## Section 2 — EPIC CONTEXT (first story of a new epic, offline only)

<!--
  REQUIRED ONLY when BOTH:
    (a) --skip atlassian or --offline is used, AND
    (b) This is the FIRST story of an epic (no contexts/{epic}/epic-context.md yet)

  If this is a subsequent story in an existing epic: DELETE THIS SECTION.
  Orchestrator reads the local epic-context.md automatically (no MCP needed).

  If JIRA MCP is active: DELETE THIS SECTION too — Orchestrator fetches the
  HLD from Confluence directly.
-->

### HLD summary
<!-- 2-3 sentences: the high-level design of the epic this ticket belongs to.
     Normally comes from Confluence. Paste or summarize here. -->


### Architecture decisions
<!-- Decisions already made for this epic. Prior stories should follow these. -->
- Decision 1:
- Decision 2:

### Spike findings (if any)
<!-- POC/research results that inform implementation. -->
- Spike A:

### Prior story decisions
<!-- If earlier stories in this epic made decisions that affect this one,
     list them here. Example: "PROJ-1001 decided to use sp-data-grid, not
     a custom grid component." -->
-


## Section 3 — SUPPLEMENTARY CONTEXT (optional in all modes)

<!--
  Use these sections for context that ISN'T in JIRA or epic-context — things
  Orchestrator couldn't know by fetching. Optional whether MCP is active or not.
  Delete any subsection you don't need.
-->

### Background
<!-- Business context, which customers asked for it, what problem it solves —
     anything that isn't in the JIRA ticket. -->

### History
<!-- Prior attempts, related tickets that were reverted or abandoned,
     decisions already made that shouldn't be relitigated. -->

### Where to look
<!-- Files, modules, or feature areas you already know are involved. Saves
     Explorer search time. "userListCtrl.js around bulkActions" > "user mgmt". -->

### Avoid
<!-- Files/modules/APIs that must NOT be touched. Other teams' code, deprecated
     paths, migrations that this ticket shouldn't interact with. -->

### Open questions
<!-- Things you're not sure about. Orchestrator will ask you at Phase A gate
     instead of guessing. Use clear yes/no or multiple-choice questions. -->

### Reference implementations
<!-- Similar features in this codebase the new code should mirror. -->

### Constraints
<!-- Performance budgets, browser support, a11y, deadlines, compatibility. -->

### Notes
<!-- Anything else. -->
