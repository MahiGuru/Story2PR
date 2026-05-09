# Project Standing Context

This file is loaded by Orchestrator on every ticket run, regardless of mode.
It's the place for standing project knowledge that applies to all stories
and bugs — team boundaries, stack norms, active migrations, coding norms
not captured in standards skills.

**Review this file quarterly.** Stale project context is worse than none.

> **Where is the machine config?** Per-task skill loading, build commands,
> subagent declarations, and runtime knobs live in `pipeline.yaml` next to
> this file. This file holds prose context only — no YAML, no agent will
> parse it for structured config.

---

## Stack reminders

<!-- Keep this section short. Details live in the standards skills. -->

- Frontend: AngularJS (legacy, `web/ui/js/`), Angular 18 (modern, `web/ui/ts/`), ExtJS (admin pages, `web/ui/extjs/`)
- Backend: Java + Spring + Hibernate, build with Ant
- Build tools: Ant for backend, Rollup (JSPM) for AngularJS, Angular CLI for Angular 18
- Messaging: IIQMessages.properties at `web/WEB-INF/classes/sailpoint/web/messages/`

---

## Team boundaries

<!-- Files/modules/APIs owned by other teams that the pipeline must not modify
     without explicit coordination. Add to this list as ownership solidifies. -->

- `web/ui/js/admin/` — Admin team, coordinate before changing
- `src/main/java/sailpoint/integration/` — Integrations team, coordinate
- `config/workflow/core/` — Workflow team, extreme care (production-critical)

Surgeon will treat these as hard constraints. If a task requires touching them,
Orchestrator will flag it at the Phase C gate for user confirmation.

---

## Coding norms beyond standard skills

<!-- Coding rules that apply to all layers and aren't already in the
     iiq-{layer}-standards.md skills. -->

- Always log user ID and operation name in audit-relevant code paths
- Never use `System.out.println` — use `Logger`
- All new REST endpoints require `@SPRight` annotation with the correct capability
- Hibernate queries should prefer `Filter` over `HQL` unless HQL is unavoidable
- Never commit credentials, API keys, or connection strings — use the Configuration object

---

## Active migrations

<!-- In-progress migrations that affect how new code should be written.
     Each migration named here SHOULD have corresponding layer_map entries
     in pipeline.yaml. Validator Check 10 cross-references this section. -->

- **AngularJS → Angular 18** (user management module): prefer Angular 18 for
  new code in that area. Do not add new AngularJS controllers to
  `web/ui/js/userManagement/` unless there's a specific reason.
- **Hibernate 5 → 6:** avoid deprecated Criteria API, use HibernateDAO helpers.

---

## Reference implementations

<!-- "Look at X for how to do Y" shortcuts. Update as good reference
     implementations are added. -->

- Bulk actions pattern: see `web/ui/js/roleManagement/roleListCtrl.js` (REF-BULK-1)
- Async task with progress modal: see `sailpoint.task.IdentityRefreshExecutor` (REF-ASYNC-1)
- REST resource with SPRight enforcement: see `sailpoint.rest.users.UserResource` (REF-REST-1)

---

## Ticket prefix

Branch + base-branch conventions are configured in
`contexts/config/pipeline.iiq.yaml` under the `runtime.branching` block:

- `runtime.branching.base_branch` — your team's integration branch (`develop` / `main`)
- `runtime.branching.prefix_story` — prefix for story branches (default `"feature/"`)
- `runtime.branching.prefix_bug` — prefix for bug branches (default `"fix/"`)
- `runtime.branching.stacking` — branch-stacking mode (`auto-detect` / `always` / `never`)

The ticket prefix is extracted directly from the trigger (e.g., `@orchestrator.md Work on IIQMAG-1234` → prefix `IIQMAG`), so no per-team whitelist is needed. Multi-project teams can work any ticket whose ID matches the JIRA regex without additional config.

---

## Constraints that apply to all work

- Target browsers: Chrome 120+, Firefox 115+, Edge 120+
- IIQ version: 8.4 (production), 8.5 (in testing)
- Accessibility: WCAG 2.1 AA minimum
- Performance: API responses under 500ms p95 for list endpoints, under 2s p95 for heavy operations
