---
name: ac-templates-intent-aware-generic
description: Generic fallback AC template library used when a pack ships no project-specific AC templates. Covers the 7 standard intents with minimal, stack-agnostic required ACs. Packs should provide their own variant; this is a safety net.
---

# Generic AC Templates (Intent-Aware)

**Used by:** Orchestrator Phase A.5 when `skills.orchestrator.ac_templates_intent_aware` is unset in pipeline.yaml.

This is a **fallback skill shipped with the kernel**. Packs are expected to provide their own project-specific variant at `packs/{pack}/skills/{pack}-ac-templates-intent-aware.md`. Each pack's variant adds stack-specific requirements (e.g. regulatory audit logging, Celery-style polling, three-role gating).

If your pack doesn't have an intent-aware AC template skill yet, orchestrator loads this file and warns: "Pack ships no project-specific AC templates; using kernel generic fallback."

## Intent → Required AC templates (generic)

| Intent | Required AC additions (minimum — generic) |
|--------|-------------------------------------------|
| `destructive-confirm` | AC for confirmation dialog text; AC for undo/rollback OR explicit "cannot be undone" messaging; AC for permission check if the operation is gated |
| `destructive-immediate` | AC for unsaved-changes warning (if editable state exists); AC for state-reset confirmation message |
| `submit` | AC for form validation states; AC for success feedback; AC for error handling (validation errors + server errors rendered distinctly) |
| `navigation` | AC for destination state (URL + visible content); AC for back-button behavior; AC for breadcrumb update (if product has breadcrumbs) |
| `async-action` | AC for loading state; AC for success notification; AC for failure recovery (retry OR actionable error) |
| `toggle` | AC for both states (on/off); AC for immediate visual feedback; AC for persistence if the toggle outlives the session |
| `bulk-action` | AC for batch size limit; AC for partial-failure handling; AC for progress indicator when items exceed a reasonable threshold |
| `unknown-intent` / `ambiguous` | HALT for user: "Analyzer couldn't classify the intent of {button}. Specify manually OR re-run analyzer." |

## Why you should replace this with a pack-specific skill

The generic templates cover the common-denominator AC types every product needs. Real products have more. Examples:

- **Identity governance systems** typically require audit-log ACs for sensitive operations (regulatory requirement), TaskResult-pattern ACs for long-running async-actions, and config-store distinctions for toggles
- **Regulated fintech** would require ACs for immutable transaction logs, idempotency keys on submits, approval-workflow linkage for destructive actions
- **Gaming** would require ACs for optimistic client prediction, server authority conflict resolution, telemetry events per action

Replacing this skill with a project-specific variant takes ~15 minutes and pays back on every story.

## Application algorithm

Same as the pack-specific versions — see e.g. `{pack}-ac-templates-intent-aware.md § Application algorithm`. Intent drives required AC types; missing AC types get derived as implicit ACs (Phase A.3) and logged in Cross-Reference Findings.
