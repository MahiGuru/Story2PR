---
name: iiq-bug-localization-backend
description: Backend bug localization strategies (B1-B6) plus IIQ domain-specific grep targets and archetypes. Loaded by Explorer in Bug Mode when Step 0 classifies the bug as Backend or Cross-stack. Covers stack trace top-frame search, log line grep, REST endpoint resolution, task/workflow tracing, DB symptom localization, and feature-name fallback.
---

# IIQ Bug Localization — Backend Strategies

Use these strategies when Step 0 of the router classified the bug as **Backend** (or **Cross-stack**, falling through to the backend). Backend bugs are harder to localize than frontend bugs because the signals are weaker and more varied — run the decision tree to pick the best starting point.

---

## Decision tree (which strategy first)

Backend strategies aren't run in a fixed priority order — the right starting strategy depends on which signals PART 1 actually carries.

```
Is there a Java stack trace in PART 1?
  YES → Run B1 (stack trace top-frame). Usually one-shot.
        Stop if hypothesis is high-confidence.
  NO  → Continue

Are there log lines with class names or unique log messages?
  YES → Run B2 (log line / class name grep). Often one-shot.
        Stop if hypothesis is high-confidence.
  NO  → Continue

Is the bug surfaced via an HTTP endpoint (URL starts with /rest/)?
  YES → Run B3 (REST endpoint → resource). Then trace into services.
  NO  → Continue

Does the bug happen on a schedule, in a workflow, or triggered by an event?
  YES → Run B5 (task/workflow trace). IIQ has lots of behavior in XML — grep there.
  NO  → Continue

Is the bug about wrong data state or sync gaps?
  YES → Run B6 (database symptom → persistence).
  NO  → Continue

Fall back to B4 (operation/feature name search). Lowest precision.
If still no high-confidence hit, stop and ask for more info.
```

---

## Strategy B1 — Stack trace top-frame search

**Highest-precision backend strategy** when a stack trace is available.

The most valuable line in a Java stack trace is usually the **deepest `sailpoint.*` frame** — not the topmost frame (which is often a generic exception handler) and not the deepest frame (which is often Hibernate or JDBC internals).

### Example

Given:
```
at sailpoint.api.certification.CertificationScheduler.scheduleNext(CertificationScheduler.java:287)
at sailpoint.task.CertificationRefreshTask.execute(CertificationRefreshTask.java:142)
at sailpoint.task.TaskExecutor.run(TaskExecutor.java:98)
```

Pick the deepest `sailpoint.*` frame that's in *your* code, not framework code (`TaskExecutor.run` is framework base class, skip it). Here that's `CertificationScheduler.scheduleNext` at line 287.

### Commands

```bash
# Find the file
find src/main/java -name "CertificationScheduler.java"

# Read around the line number
sed -n '270,310p' src/main/java/sailpoint/api/certification/CertificationScheduler.java
```

The stack trace literally names the file and line. This is almost always a one-shot find.

**When it works:** bugs that throw exceptions that are logged or returned to the user.
**When it fails:** silent failures (wrong data, missing audit entries, wrong calculation results) — no exception to trace.

---

## Strategy B2 — Log line / class name grep

Logs are the next-best signal after stack traces. IIQ backend code logs extensively — class names in log lines point directly at source files, and unique log message text points directly at emission lines.

### From class name

```
2026-04-12 02:14:33 ERROR [QuartzScheduler_Worker-3] sailpoint.task.IdentityRefreshExecutor - ...
                                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

The class name `IdentityRefreshExecutor` is a direct file lookup:

```bash
find src/main/java -name "IdentityRefreshExecutor.java"
```

### From log message text

```bash
# Search for the literal log message in source
grep -rn "Failed to refresh identity for user" src/main/java/
```

This points at the exact line that emits the log, which is usually adjacent to the bug.

### Log threading patterns in IIQ

| Thread name | What it means |
|-------------|---------------|
| `QuartzScheduler_Worker-N` | Scheduled task (Quartz job) |
| `http-nio-*` | Synchronous HTTP request |
| `WorkflowLauncher-N` | Workflow engine |
| `pool-N-thread-M` | Generic thread pool (usually integration/connector work) |
| `Timer-N` | Internal timer, often heartbeat or periodic |

Knowing the thread name tells you where to start looking — Quartz thread → scheduled task domain, HTTP thread → REST or JSF request path.

**When it works:** any bug with logs available, especially async/scheduled work.
**When it fails:** bugs in code paths that don't log.

---

## Strategy B3 — REST endpoint → resource class

If the bug is "API returns 500," "endpoint X returns wrong data," or "JS call to /rest/... fails," map the endpoint URL to its resource class.

```bash
# Find the REST resource handling /rest/users/export
grep -rn "@Path.*users/export" src/main/java/sailpoint/rest/

# Or search by HTTP method + path fragment
grep -rn "@GET.*export" src/main/java/sailpoint/rest/users/
```

From the resource class, follow the call chain into services. The resource is usually a thin wrapper — the bug is almost always in the service or domain logic it calls, not the resource itself.

### Common IIQ REST resource patterns

```bash
# All REST resources are in src/main/java/sailpoint/rest/
find src/main/java/sailpoint/rest -name "*Resource.java"

# Resource classes usually delegate to service classes in sailpoint/service/ or sailpoint/api/
grep -n "import sailpoint.service" src/main/java/sailpoint/rest/users/UserExportResource.java
```

---

## Strategy B4 — Operation / feature name search

When PART 1 only describes the bug at a feature level ("certification reminder emails are wrong"), grep for operation-specific keywords across services.

```bash
# Search for class names matching the feature
find src/main/java/sailpoint -name "*Certification*" -name "*Reminder*"

# Search for method names
grep -rn "sendReminder" src/main/java/sailpoint/api/certification/
```

This is the backend equivalent of frontend's F4 — broader, less precise, used when nothing else has narrowed it down.

---

## Strategy B5 — Scheduled task / workflow trace

If PART 1 mentions timing ("happens every night at 2am," "during certification campaign run") or names a task or workflow, look in the task and workflow definitions. **This is a critical IIQ strategy** because IIQ has a huge amount of behavior in declarative XML (workflows, rules, task definitions) that pure Java grep will miss.

### Scheduled tasks (Quartz)

```bash
# Find TaskExecutor subclasses (Quartz job implementations)
grep -rln "extends.*TaskExecutor" src/main/java/sailpoint/task/

# Find task definitions (XML)
find . -name "*.xml" -path "*/init*" | xargs grep -l "TaskDefinition"
find config/ init*/ -name "*.xml" | xargs grep -l "<TaskDefinition"

# Find which Java class implements a named task
grep -rn "<TaskDefinition name=\"Identity Refresh\"" config/ init*/
# → points at an XML with <Attribute name="executor" value="sailpoint.task.IdentityRefreshExecutor"/>
```

### Workflows

```bash
# Find workflow XML definitions
find . -name "*.xml" -path "*/workflow/*"
find config/ init*/ -name "*.xml" | xargs grep -l "<Workflow "

# Find a workflow by name
grep -rn "<Workflow name=\"Certification Sign Off\"" config/ init*/

# Find workflow step logic
grep -rn "<Step name=" config/workflow/
```

Workflows have:
- **Steps** (sequential/conditional blocks)
- **Transitions** (conditions between steps, often BeanShell rules)
- **Variables** (typed values passed between steps)
- **Approvals** (handled by ApprovalSet, which has its own state)

Common workflow bugs are variable type mismatches, missing transition conditions, and BeanShell rules that throw.

### Rule libraries (BeanShell)

```bash
# Find rule XML files
find . -name "*.xml" -path "*/rule/*"
find config/ init*/ -name "*.xml" | xargs grep -l "<Rule name="

# Find a rule by name
grep -rn "<Rule name=\"Identity Refresh Trigger\"" config/ init*/
```

Rules are BeanShell-like (Java-ish interpreted code). They can throw at runtime without compile-time detection — "works on my machine" bugs in rules are common.

### Event listeners

```bash
# Find event listener registrations
grep -rn "registerListener\|implements.*Listener" src/main/java/sailpoint/
```

**When it works:** any scheduled or workflow-driven bug. Critical for IIQ because so much logic lives in XML/rules.
**When it fails:** synchronous HTTP request paths (use B3 instead).

---

## Strategy B6 — Database symptom → persistence layer

If PART 1 describes wrong data state ("role assignment exists in `spt_identity_bundle` but isn't reflected in the identity object"), the bug is likely in:

- A Hibernate mapping (`*.hbm.xml`)
- A persistence service (`PersistenceManager`, `Provisioner`, `Identitizer`)
- A cache invalidation gap
- A missing transaction boundary

### Commands

```bash
# Find Hibernate mappings for an object type
find . -name "Identity.hbm.xml" -o -name "Role.hbm.xml" -o -name "Bundle.hbm.xml"

# Find persistence call sites
grep -rn "saveObject.*Identity" src/main/java/
grep -rn "PersistenceManager" src/main/java/sailpoint/service/ | head -20

# Find cache configurations
grep -rn "@Cache\|CacheService" src/main/java/sailpoint/
```

### Common IIQ database tables (for symptom matching)

| Table | Domain |
|-------|--------|
| `spt_identity` | Identity core |
| `spt_identity_archive` | Archived identities |
| `spt_identity_bundle` | Identity ↔ role assignments |
| `spt_bundle` | Roles |
| `spt_application` | Applications/connectors |
| `spt_link` | Account links (identity ↔ account on app) |
| `spt_provisioning_request` | Provisioning queue/state |
| `spt_certification` | Certifications |
| `spt_certification_item` | Certification line items |
| `spt_task_result` | Task execution results |
| `spt_workflow_case` | Workflow execution state |
| `spt_audit_event` | Audit log |
| `spt_work_item` | Work items (approvals, etc.) |

If the user mentions a specific symptom involving one of these, jump straight to the corresponding domain section below.

---

## IIQ domain-specific grep targets

These are the common backend domains where bugs cluster. Each section lists the key files, tables, and archetypes specific to that domain. When Step 0 and the strategy decision tree point you here, use these as your starting grep targets.

### Provisioning

**Key classes:**
- `sailpoint.api.Provisioner` (main API)
- `sailpoint.provisioning.*` (plan building, partitioning)
- `sailpoint.integration.*` (integration adapters to external systems)
- `sailpoint.connector.*` (connectors)

**Tables:** `spt_provisioning_request`, `spt_link`, `spt_application`

**Archetypes:**
- Retry exhausted without proper error surfacing
- Partitioning miscounts (plan split wrong)
- Connector timeout swallowed instead of retried
- Provisioning policy violation not reported to user

```bash
grep -rn "Provisioner\|ProvisioningPlan" src/main/java/sailpoint/api/
grep -rn "IntegrationExecutor" src/main/java/sailpoint/integration/
```

### Certification

**Key classes:**
- `sailpoint.api.certification.*`
- `sailpoint.service.certification.*`
- `sailpoint.task.Certificationer` (task)

**Tables:** `spt_certification`, `spt_certification_item`, `spt_certification_entity`

**Archetypes:**
- Phase transition stuck (certification phases: Staging → Active → Challenge → Remediation → End)
- Scheduled certification fires duplicates
- Delegation not rolling back on reassignment
- Remediation requests lost

```bash
grep -rn "CertificationPhaser\|CertificationService" src/main/java/sailpoint/service/certification/
find . -name "*.xml" -path "*/certification/*"
```

### Identity refresh

**Key classes:**
- `sailpoint.task.IdentityRefreshExecutor`
- `sailpoint.api.Identitizer` (the refresh engine)
- `sailpoint.api.IdentityService`

**Tables:** `spt_identity`, `spt_identity_bundle`, `spt_link`

**Archetypes:**
- Scope filter excludes a group that should be included (the example from the README)
- Promotion rule throws on edge-case identity and skips the whole identity
- Correlation runs stale because last-sync timestamp not updated
- Identity attribute aggregation ordering wrong (multi-app identities)

```bash
grep -rn "Identitizer\|IdentityRefresh" src/main/java/sailpoint/api/
grep -rn "refresh.*identity" src/main/java/sailpoint/task/
```

### Workflow engine

**Key classes:**
- `sailpoint.workflow.WorkflowContext`
- `sailpoint.workflow.Workflower` (executor)
- `sailpoint.api.Workflower`

**Tables:** `spt_workflow_case`, `spt_work_item`

**Archetypes:**
- Variable type mismatch between steps (Integer expected, String passed)
- Missing transition condition (step with no fallback)
- BeanShell rule throws inside a step, workflow halts without clear error
- Approval step doesn't honor timeout / escalation
- Work item assigned to wrong owner

```bash
find config/workflow -name "*.xml"
grep -rn "<Step name=\"" config/workflow/
grep -rn "Workflower" src/main/java/sailpoint/workflow/
```

### Audit

**Key classes:**
- `sailpoint.api.Auditor`
- `sailpoint.service.AuditService`

**Tables:** `spt_audit_event`, `spt_audit_config`

**Archetypes:**
- Audit event never published (missing `Auditor.log()` call site)
- Audit config excludes an event the user expected to see
- Audit event published but with wrong action name (displays wrong in UI)

```bash
grep -rn "Auditor.log\|AuditEvent" src/main/java/sailpoint/
```

### Reporting

**Key classes:**
- `sailpoint.reporting.*`
- `sailpoint.api.Report`

**Tables:** `spt_report_result`

**Archetypes:**
- Report datasource query returns wrong subset (filter clause missing)
- Report parameter not honored (filter value ignored)
- Report output formatter crashes on null field
- Scheduled report fires but email delivery fails silently

```bash
grep -rn "DataSource\|ReportDataSource" src/main/java/sailpoint/reporting/
find config/ init*/ -name "*.xml" | xargs grep -l "<ReportDefinition"
```

### Notifications / email

**Key classes:**
- `sailpoint.api.Notifier`
- `sailpoint.api.EmailNotifier`
- `sailpoint.service.NotificationService`

**Tables:** `spt_email_template`, `spt_batch_request`

**Archetypes:**
- Template variable undefined (renders `${var}` literally in email)
- SMTP config issue swallowed, no error surfaced
- Notification queue stuck (unprocessed entries)
- Wrong recipient resolved (capability/role lookup wrong)

```bash
grep -rn "EmailNotifier\|Notifier" src/main/java/sailpoint/api/
find config/ init*/ -name "*.xml" | xargs grep -l "<EmailTemplate"
```

### Connectors

**Key classes:**
- `sailpoint.connector.*` (connector framework)
- `sailpoint.connector.{ConnectorName}Connector` (specific connectors)

**Tables:** `spt_application`, `spt_link`

**Archetypes:**
- Connection retry exhausted silently
- Schema detection returns wrong attribute types
- Pagination broken (missing or miscounted offset)
- SSL/TLS config mismatch

```bash
find src/main/java/sailpoint/connector -name "*.java"
grep -rn "implements.*Connector" src/main/java/sailpoint/connector/
```

### Rule engine

**Key classes:**
- `sailpoint.api.RuleRunner`
- `sailpoint.object.Rule` (rule definition)

**Tables:** `spt_rule`

**Archetypes:**
- BeanShell rule throws runtime exception (no compile-time check)
- Rule references object not in context (`identity` null when rule runs in a context without it)
- Rule library dependency missing (imports class not on classpath)
- Rule result type mismatch (expects String, rule returns Boolean)

```bash
grep -rn "RuleRunner\|runRule" src/main/java/sailpoint/api/
find config/ init*/ -name "*.xml" | xargs grep -l "<Rule name="
```

### Task framework

**Key classes:**
- `sailpoint.object.TaskDefinition`
- `sailpoint.object.TaskResult`
- `sailpoint.task.{Specific}Executor` (extends `AbstractTaskExecutor`)

**Tables:** `spt_task_definition`, `spt_task_result`, `spt_task_schedule`

**Archetypes:**
- Task reports "success" but did partial work (error swallowed)
- Task scheduled but never runs (Quartz misfire policy)
- Task runs concurrently with itself (missing `@DisallowConcurrentExecution`)
- Task result truncated because stdout/stderr capture failed

```bash
grep -rln "extends.*TaskExecutor\|extends.*AbstractTaskExecutor" src/main/java/sailpoint/task/
find config/ init*/ -name "*.xml" | xargs grep -l "<TaskDefinition"
```

---

## Cross-stack pairing (backend)

| If you found... | Also look at... |
|-----------------|-----------------|
| REST resource (`*Resource.java`) | The JS/TS service that calls it (search by URL path in frontend skill) |
| Service class (`*Service.java`) | All REST resources, tasks, and workflows that call it (`grep -rn "ServiceName"`) |
| Hibernate mapping (`*.hbm.xml`) | The corresponding Java object class and all persistence call sites |
| Task executor (`*Executor.java`) | The `TaskDefinition` XML that instantiates it |
| Workflow XML | Every BeanShell rule and Java class referenced from workflow steps |
| Connector | The `Application` config XML that wires it |
| BeanShell rule | Every workflow, task, or lifecycle event that runs it |

---

## Backend bug archetypes (expanded)

Backend-specific patterns to match hypotheses against:

1. **Null guard missing** — `obj.getField()` without checking `obj != null`. Same as frontend #1 but the stakes are higher (often DB corruption).
2. **Hibernate cascade missing** — parent saved but child not cascaded (missing `cascade="all"` in `.hbm.xml`).
3. **Quartz misfire** — scheduled task didn't run because of Quartz misfire policy (instance was down, job queue full).
4. **Workflow variable type mismatch** — step A sets variable as Integer, step B expects String (or vice versa).
5. **Cache not invalidated** — service caches a list and doesn't clear after create/update/delete.
6. **Connector retry exhausted** — external call failed max retries, error swallowed or misreported.
7. **SPRight on wrong capability** — permission check uses wrong capability name (works for admin, fails for delegated role).
8. **Filter clause AND/OR wrong** — Hibernate filter uses OR where it should be AND (or vice versa), returning wrong subset.
9. **N+1 query** — loop over parent objects, each triggering a lazy-loaded child fetch; acceptable at small scale, fatal at production.
10. **Missing transaction boundary** — operation spans multiple persistence calls without a surrounding `@Transactional` — partial writes on failure.
11. **Filter clause missing** — query missing a condition that should be there (the example from the README: scope filter excludes Contractors group).
12. **Rule BeanShell exception swallowed** — try/catch around rule execution logs error and returns default, hiding the real bug.
13. **Scheduled task skipped partition** — partitioned task (e.g., identity refresh) skips identities based on wrong scope filter.
14. **Audit call site missing** — code path should emit an audit event but doesn't.

If your hypothesis matches an archetype, name it explicitly.

---

## Regression test locations (backend)

| Layer | Test location | Framework |
|-------|---------------|-----------|
| Backend / Java service | `src/test/java/sailpoint/service/{Service}Test.java` | JUnit |
| Backend / API | `src/test/java/sailpoint/api/{Api}Test.java` | JUnit |
| Backend / Task | `src/test/java/sailpoint/task/{Task}Test.java` | JUnit |
| REST resource | `src/test/java/sailpoint/rest/{Resource}Test.java` | JUnit + RestAssured |
| Workflow | Usually no unit tests — flag for manual QA + test-env run |
| BeanShell rule | Usually no unit tests — flag for manual QA |
| Hibernate mapping | `src/test/java/sailpoint/object/{Object}PersistenceTest.java` (if exists) | JUnit |

For workflow and rule bugs that can't be unit-tested, write the regression task as a **manual test scenario** that a QA engineer can run in a test environment.
