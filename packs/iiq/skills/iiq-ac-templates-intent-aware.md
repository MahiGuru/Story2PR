---
name: iiq-ac-templates-intent-aware
description: Intent-aware AC template library. When Orchestrator generates ACs for a button/action referenced in a ticket, it consults the button's intent classification (from project-map § 10c) and applies the matching AC template from this skill. Customize per project by editing required_acs for each intent.
---

# IIQ AC Templates (Intent-Aware)

**Used by:** Orchestrator Phase A.5 (AC enrichment) + Phase B.3 (task generation).

When Orchestrator processes a Requirement Summary that references a button or clickable element, it looks up the button's intent in `project-map.md § 10c`. Whatever intent the analyzer classified drives the AC template applied from the table below. If the ticket's explicit ACs don't cover the intent's required AC types, Orchestrator flags the gap in `§ Cross-Reference Findings`.

## Purpose — why a skill, not inline

Before v15.1, this table lived inline in `orchestrator.md`. Two problems:

1. **Not customizable per project** — editing the agent prompt to tune AC requirements is a heavy change that breaks kernel/pack separation.
2. **Not stack-specific** — IIQ has audit-logging and workflow-approval requirements other stacks don't. A shared inline table can only express the common subset.

As a skill, teams edit this file when the product evolves without touching kernel or pack rule files.

## Intent → Required AC templates

| Intent | Required AC additions (IIQ-specific) |
|--------|-------------------------------------|
| `destructive-confirm` | AC for confirmation dialog text; AC for undo/rollback OR explicit "cannot be undone" messaging; AC for audit log entry (mandatory for IIQ identity/cert/role operations); AC for permission check (e.g. `SystemAdministrator` or `CertificationAdministrator`) |
| `destructive-immediate` | AC for unsaved-changes warning (browser `onbeforeunload` or Angular `CanDeactivate`); AC for state-reset confirmation message; AC for no audit entry when state is session-only |
| `submit` | AC for form validation states (required fields, format, length); AC for save success feedback (toast or inline); AC for error handling (validation errors + server errors rendered distinctly); AC for partial-save behavior when JSF postback fails |
| `navigation` | AC for destination state (URL + page title); AC for back-button behavior (preserves filters/pagination); AC for breadcrumb update; AC for unsaved-changes warning if leaving an editable form |
| `async-action` | AC for loading state (button disabled + spinner, or progress bar if >2s); AC for success notification; AC for failure recovery (retry option or actionable error); AC for background-task handling when operation exceeds sync timeout (task result panel + JIRA-style status polling) |
| `toggle` | AC for both states (on/off rendering); AC for immediate visual feedback; AC for persistence (UIConfig entry OR user preference); AC for audit entry if security-relevant (e.g. enabling/disabling a connector) |
| `bulk-action` | AC for batch size limits (IIQ default: 1000 items; documented in SystemConfiguration); AC for partial-failure handling (atomic vs best-effort — specify explicitly); AC for progress indicator when >50 items; AC for TaskResult creation + link; AC for audit log entries (one per affected item) |
| `unknown-intent` / `ambiguous` | HALT for user. Message: "Analyzer couldn't classify the intent of {button} at {location}. Options: (a) specify intent manually, (b) run `Rescan intent: {button}` to re-analyze, (c) proceed with generic AC templates." |

## IIQ-specific nuances

**Audit logging is non-negotiable for identity/cert/role operations.** Every `destructive-confirm` and `bulk-action` touching these domains MUST have an explicit AC for the `AuditEvent` entry — target, action, actor, timestamp, outcome. Use `AuditService.log()` via dependency injection; never direct DAO writes.

**Permission checks are dual-layered.** AC must cover both the UI-level check (button disabled/hidden via `permissionService.hasRight()`) AND the backend REST endpoint check (`@AuthorizationContext` / role guard). Testing covers both independently.

**TaskResult pattern for long-running async-actions.** IIQ operations exceeding 10s sync timeout must create a `TaskResult` record and return a polling URL. AC must cover: TaskResult creation, status page linkage, completion notification, and result expiration handling.

**UIConfig/ObjectConfig for toggle persistence.** Toggles affecting UI behavior write to `UIConfig`; toggles affecting business logic write to `ObjectConfig`. AC must specify which.

## Application algorithm

```
FOR each button/action in Requirement Summary:
  intent = project-map § 10c[button.location].intent

  IF intent in [unknown-intent, ambiguous]:
    HALT with the message above. Wait for user clarification.

  IF intent exists in the table above:
    required_ac_types = row[intent].required_acs
    FOR each required_ac_type:
      IF not present in ticket's explicit ACs:
        derive an implicit AC per Phase A.3 (Derive Implicit ACs)
        log the derivation in § Cross-Reference Findings as "Intent-driven AC:
          {button} is {intent}, requires {ac_type}, derived because ticket
          didn't specify"
```

## Per-project customization

Teams can add project-specific AC requirements by editing the table above, or by adding new rows for custom intents classified in a downstream pipeline.yaml.intent_classification.verb_synonyms.

To **add** an AC type to an existing intent: append to the "Required AC additions" cell.

To **remove** an AC type (e.g. your product doesn't have audit logging): delete from the cell.

To **add a new intent**: (1) add entries to pipeline.yaml.intent_classification.verb_synonyms under a new category name, (2) add a row to this table mapping the intent name to required ACs, (3) re-run `Analyze project` to re-classify buttons under the new intent.
