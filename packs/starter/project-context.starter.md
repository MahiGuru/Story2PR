# Project Standing Context (starter pack template)

This file is loaded by Orchestrator on every ticket run, regardless of mode.
It's the place for **standing project knowledge** that applies to all stories
and bugs — team boundaries, stack norms, active migrations, coding norms
not captured in standards skills.

> **Edit this file** before installing the pack to reflect your real
> project. Everything below is illustrative.

> **Where is the machine config?** Per-task skill loading, build commands,
> subagent declarations, and runtime knobs live in `pipeline.yaml` next to
> this file. This file holds prose context only — no YAML, no agent will
> parse it for structured config.

**Review this file quarterly.** Stale project context is worse than none.

---

## Stack reminders

<!-- Keep this section short. Details live in the standards skills. -->

- Frontend: _(EDIT — Angular 18, Angular 19, React, Vue 3 — pick one or
  list multiple if your repo is multi-stack)_
- Backend: Java 17+ + Spring Boot 3.x
- Build: Maven (backend), Vite or Angular CLI (frontend)
- Database: _(EDIT — Postgres, MySQL, etc.)_
- Messaging: _(EDIT — Kafka, RabbitMQ, none)_

---

## Team boundaries

<!-- Files / modules / APIs owned by other teams that the pipeline must not
     modify without explicit coordination. -->

- _(EDIT — example: `frontend/src/app/admin/` — Admin team, coordinate before changing)_
- _(EDIT — example: `backend/src/main/java/com/example/integration/` — Integrations team)_

Surgeon will treat these as hard constraints. If a task requires touching
them, Orchestrator will flag it at the Phase C gate for user confirmation.

---

## Coding norms beyond standard skills

<!-- Coding rules that apply to all layers and aren't already in the
     starter-{layer}-standards.md skills. -->

- Always log user ID and operation name in audit-relevant code paths
- Never use `System.out.println` (Java) or `console.log` in production paths — use the logger
- All new REST endpoints require auth + the correct authorization annotation
- Never commit credentials, API keys, or connection strings — use env vars or the secret manager

---

## Active migrations

<!-- In-progress migrations that affect how new code should be written.
     Each migration named here SHOULD have corresponding layer_map entries
     in pipeline.yaml. -->

- _(EDIT — example: AngularJS → Angular 19 in user management module)_
- _(EDIT — example: Class components → function components in `src/components/legacy/`)_

---

## Reference implementations

<!-- "Look at X for how to do Y" shortcuts. Update as good reference
     implementations are added. -->

- _(EDIT — example: Bulk action pattern: see `frontend/src/app/users/user-list.component.ts`)_
- _(EDIT — example: REST resource with pagination: see `backend/.../UserController.java`)_

---

## Constraints that apply to all work

- Target browsers: _(EDIT — Chrome 120+, Firefox 115+, Safari 17+)_
- Accessibility: WCAG 2.1 AA minimum
- Performance: API responses under _(EDIT — e.g., 500ms p95)_ for list endpoints
- Security: _(EDIT — OWASP Top 10 review on new endpoints)_
