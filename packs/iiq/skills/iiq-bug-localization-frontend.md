---
name: iiq-bug-localization-frontend
description: Frontend bug localization strategies (F1-F4). Loaded by Explorer in Bug Mode when Step 0 classifies the bug as Frontend or Cross-stack. Contains IIQMessages key search, URL-to-file resolution tables for AngularJS/Angular18/ExtJS/XHTML, cross-stack pairing rules, and frontend bug archetypes.
---

# IIQ Bug Localization — Frontend Strategies

Use these strategies when Step 0 of the router classified the bug as **Frontend** (or **Cross-stack**, starting with frontend). Run them in the order the decision tree recommends.

---

## Decision tree (which strategy first)

```
Is there a visible message key or literal error text in PART 1?
  YES → Run F1 (IIQMessages key search) first. Usually one-shot.
  NO  → Continue

Is there a URL, screen name, or route path in PART 1?
  YES → Run F2 (URL → route → file resolution).
  NO  → Continue

Is there a browser console stack trace in PART 1?
  YES → Run F3 (console error grep).
  NO  → Continue

Fall back to F4 (symptom-based pattern search). Lowest precision.
If still no high-confidence hit after F4, stop and ask for more info.
```

---

## Strategy F1 — IIQMessages key search

**Highest-precision frontend strategy.** If PART 1 has any visible message key, error label, or tooltip text, this usually pins the bug to ≤5 files in one grep.

### Find the key definition

```bash
grep -rn "^key_name=" web/WEB-INF/classes/sailpoint/web/messages/
```

If the user gave you literal English text (not a key), reverse-lookup:

```bash
grep -rn "=Exact visible text here" web/WEB-INF/classes/sailpoint/web/messages/
```

Take the resulting key name.

### Find every reference

```bash
grep -rn "key_name" web/ ui/ src/ \
  --include="*.xhtml" \
  --include="*.js" \
  --include="*.ts" \
  --include="*.html" \
  --include="*.java"
```

Results typically narrow to 2-5 files: the message bundle, the template that displays it, the controller/component that triggers it, and possibly a Java service that throws the error.

**Why this works:** message keys are the most stable identifier in IIQ. They almost never move without a rename, and they're referenced consistently across layers.

---

## Strategy F2 — URL → route → file resolution

If PART 1 has a URL or navigation path, resolve it to source files using the tables below.

### AngularJS (legacy)

```
URL fragment                 → Look in
#/feature/sub                → web/ui/js/{feature}/{feature}.module.js
                                (search for $stateProvider / $routeProvider)
                             → controller listed in state/route definition
                             → template: web/ui/js/{feature}/templates/*.html
                             → backing service: web/ui/js/{feature}/services/*.js
```

Search commands:

```bash
# Find the route definition
grep -rn "url:.*'/feature/sub'" web/ui/js/ --include="*.js"

# Find the controller by name
grep -rn "controller:.*'FeatureNameCtrl'" web/ui/js/ --include="*.js"

# Find the template
grep -rn "templateUrl:.*feature" web/ui/js/ --include="*.js"
```

### Angular 18 (modern)

```
/app/feature/sub             → web/ui/ts/src/app/{feature}/{feature}-routing.module.ts
                             → component listed in route definition
                             → component template: {feature}.component.html
                             → backing service: {feature}.service.ts
                             → state (if NgRx): store/{feature}/
```

Search commands:

```bash
grep -rn "path:.*'feature/sub'" web/ui/ts/src/ --include="*.ts"
grep -rn "component:.*FeatureComponent" web/ui/ts/src/ --include="*.ts"
```

### ExtJS (legacy admin pages)

```
/identityiq/page.jsf         → web/page.xhtml
                             → managed bean: src/main/java/sailpoint/web/{Module}Bean.java
                             → ExtJS panel: web/ui/extjs/sailpoint/{module}/*.js
                                (search by panel title or itemId)
```

Search commands:

```bash
grep -rn "itemId:.*'panel-name'" web/ui/extjs/ --include="*.js"
grep -rn "managed-bean-name>{bean}" web/WEB-INF/faces-config*.xml
```

### XHTML / JSF pages

XHTML is often where AngularJS bugs surface. The XHTML wires the directive; the directive lives in `web/ui/js/`:

```bash
# Find the XHTML page by unique text
find web/ -name "*.xhtml" | xargs grep -l "page-title-or-unique-string"

# From the XHTML, find the directives used
grep -E "<sp-[a-z-]+|<ng-[a-z-]+" the-page.xhtml
```

---

## Strategy F3 — Console error grep

If PART 1 has a JS console error, grep the most unique fragment:

```bash
# JS error
grep -rn "Cannot read property 'x' of undefined" web/ui/ --include="*.js" --include="*.ts"

# Angular error with component context
grep -rn "ExpressionChangedAfterItHasBeenCheckedError" web/ui/ts/src/ --include="*.ts"
```

Pick a fragment unique enough to narrow to 1-5 files. Avoid generic messages that appear everywhere.

---

## Strategy F4 — Symptom-based pattern search

When none of F1-F3 narrow it down, search by what's broken:

| Symptom | Search target |
|---------|---------------|
| Wrong label / text | IIQMessages key (fall back to F1) |
| Button does nothing | `ng-click` / `(click)` handler in template, then trace to controller |
| Validation not firing | `ng-pattern`, `Validators.`, or `@Valid` annotations |
| Wrong data displayed | service method that fetches data → REST endpoint → Java service |
| Page won't load | router config + browser console + server log |
| Permission denied unexpectedly | `SPRight`, `Capability` checks in bean / REST resource |
| Stale data after save | missing `$scope.$apply()`, missing NgRx store dispatch, or missing cache invalidation |
| Table not refreshing | grid/datasource config, pagination state, filter state |
| Modal won't close | modal service call, `$uibModalInstance.close()`, dialog ref |
| Event not firing | event listener registration, event emission, `$scope.$emit` / `$scope.$broadcast` |

---

## Cross-stack pairing (frontend)

For every candidate file you find, look up its pair:

| If you found... | Also look at... |
|-----------------|-----------------|
| `*.xhtml` | Directive(s) referenced in it (AngularJS) or managed bean (JSF/ExtJS) |
| AngularJS controller | Its template (`templateUrl`) and its service |
| AngularJS directive | The XHTML/HTML files that use it |
| Angular 18 component | Its template, its service, and the NgRx store/effects if state-driven |
| Angular 18 service | Every component that injects it |
| ExtJS panel | Its store, its model, and the managed bean it posts to |
| REST call from JS/TS | The Java REST resource on the other end (Strategy B3 in the backend skill) |
| `IIQMessages.properties` key | Every template and JS/TS file that references it |

**Always report paired files together as a unit** in your hypothesis, even if only one needs editing.

---

## Frontend bug archetypes

When you have a hypothesis, sanity-check it against these patterns. Most frontend bugs fall into one:

1. **Null guard missing** — `obj.field` accessed when `obj` may be undefined. Fix: `obj?.field` (TS) or `obj && obj.field` (JS).
2. **Stale scope binding** — AngularJS scope not digested after async (`$scope.$apply` missing or called on wrong scope). Or Angular `ChangeDetectorRef.markForCheck()` missing in OnPush component.
3. **Wrong selector / itemId** — refactor renamed an element but a query selector still uses the old name.
4. **Wrong locale key** — key exists but is misspelled in the template, or two keys collided.
5. **Validation off-by-one** — pattern regex too loose/strict, or `required` check missing on a new field.
6. **Race condition** — two observables/promises racing; result depends on which lands first.
7. **Event listener leak** — listener registered but never unregistered on destroy; fires on stale component.
8. **Permission check too broad/narrow** — `SPRight` check on the wrong capability.
9. **Missing `trackBy`** — Angular `ngFor` without `trackBy` causing DOM thrash on updates.
10. **Stale cache** — service caches a list and doesn't invalidate after create/update/delete.

If your hypothesis matches an archetype, name it explicitly — it speeds Surgeon's work.

---

## Regression test locations (frontend)

| Layer | Test location | Framework |
|-------|---------------|-----------|
| Frontend / AngularJS | `web/ui/js/{feature}/test/` | Karma + Jasmine |
| Frontend / Angular 18 | `web/ui/ts/src/app/{feature}/__tests__/` or `*.spec.ts` next to source | Jest |
| Frontend / ExtJS | Usually no unit tests — flag for manual QA only |
| XHTML / JSF | No unit tests — flag for manual QA only |

For layers with no automated tests, write the regression task as:

```markdown
## T-TC1 — Manual regression for T1
- Layer: ExtJS
- File: _(no automated test — manual QA only)_
- Test: Steps QA should follow to verify the fix
- Note: Flagged for manual QA. Add to QA test sheet.
```
