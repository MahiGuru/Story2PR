---
name: iiq-bug-localization
description: Router for bug localization. Loaded by Explorer in Mode C (Bug Mode and Sub-Bug Mode). Contains Step 0 layer detection and the decision tree for which sub-skill (frontend or backend) to load next. Keep this file small — it is loaded for every bug.
---

# IIQ Bug Localization — Router

You (Explorer) are in Bug Mode. Your job is to turn a bug report (PART 1 of `contexts/{TICKET_ID}.md`) into a small set of candidate files plus a root-cause hypothesis.

This file is the **router**. It contains the layer-detection step and the decision tree for which strategy set to run. The actual strategies (grep commands, file-pairing tables, archetypes) live in two sub-skills:

- `iiq-bug-localization-frontend.md` — F1-F4 strategies for AngularJS, Angular 18, ExtJS, XHTML
- `iiq-bug-localization-backend.md` — B1-B6 strategies for Java services, REST, scheduled tasks, workflow, persistence

**You load only the sub-skill(s) you actually need**, based on Step 0's classification. Most bugs need only one sub-skill. Cross-stack bugs need both.

---

## Step 0: Layer detection

Read PART 1 of `contexts/{TICKET_ID}.md` and classify the bug as Frontend, Backend, or Cross-stack by looking at the signals present.

### Frontend signals

- URL pattern starts with `/identityiq/*.jsf` or `/app/*`
- PART 1 mentions a visible button, toast, label, tooltip, form, table, or other UI element
- PART 1 has a browser console error (`TypeError`, `ReferenceError`, "Cannot read property of undefined")
- PART 1 has a visible IIQMessages key or literal error text
- The user describes the trigger as "click X," "submit Y," "page load," "form validation"
- Stack trace (if any) contains `sailpoint.web.*` frames (JSF-backed pages)

### Backend signals

- URL pattern starts with `/rest/*`
- PART 1 has a Java stack trace (especially with `sailpoint.service.*`, `sailpoint.task.*`, `sailpoint.api.*`, `sailpoint.connector.*` frames)
- PART 1 has log lines with thread names like `QuartzScheduler_Worker-N`
- The trigger is a **scheduled task**, **workflow step**, **event listener**, or **scheduled job**
- The user describes data symptoms ("wrong count," "missing records," "stale value")
- The user mentions a specific backend operation by name (identity refresh, certification, provisioning, audit, report)
- The bug happens without any UI involvement (runs at 2am, fires from an external event, etc.)
- The symptom is "email never arrived," "audit log missing entries," "notification not sent"

### Cross-stack signals

- A UI click produces a Java exception visible in server logs
- The symptom is in the UI but the error message references a backend service/endpoint
- PART 1 has both a URL AND a stack trace

### Classification rules

1. **Pure frontend signals only** → Classification: **Frontend**. Load `iiq-bug-localization-frontend.md`.
2. **Pure backend signals only** → Classification: **Backend**. Load `iiq-bug-localization-backend.md`.
3. **Both present** → Classification: **Cross-stack**. Load both sub-skills. Usually start with frontend (the UI symptom gives a fast anchor point) and follow the trail backwards into the backend if the frontend code just calls a service that throws.
4. **Ambiguous or neither matches cleanly** → Ask the user for more signals before proceeding. Do not guess.

---

## Step 1: Load the appropriate sub-skill

Based on Step 0's classification:

```
Frontend  → Read: skills/iiq-bug-localization-frontend.md
Backend   → Read: skills/iiq-bug-localization-backend.md
Cross-stack → Read both
```

Each sub-skill contains:
- The strategies for that layer (F1-F4 or B1-B6)
- The decision tree for which strategy to run first based on available signals
- File-pairing tables for that layer
- Bug archetypes specific to that layer
- IIQ domain-specific grep targets (provisioning, certification, identity refresh, workflow, audit, reporting, notification, connector, rule engine, task framework)

---

## Step 2: Run the strategies

Follow the sub-skill's decision tree. Stop as soon as you have **≤3 high-confidence candidate files**. Don't over-explore.

For each strategy you run, **log the exact grep commands and result counts**. This evidence goes into the PART 3 hypothesis so Review can verify your reasoning.

---

## Step 3: Cross-stack pairing

After you have candidate files, look up each one in the pairing table from the appropriate sub-skill. Add paired files to the candidate set even if you think only one needs editing — Surgeon needs the full picture, and fixing only half of a paired change is the #1 way bug fixes regress something else.

**Hard cap: 5 candidate files total after pairing.** If you can't narrow below 5, STOP and report. Either:
- The bug report is too vague (ask the user for more info), or
- You're chasing the wrong layer (re-run Step 0 with different signals)

Do not proceed with vague leads. Vague localization produces bad hypotheses, which produces bad fix tasks, which produces regressions.

---

## Step 4: Form hypotheses and write tasks

Write 1-3 ranked hypotheses into PART 3 of `contexts/{TICKET_ID}.md`:

```markdown
### Hypothesis H1 — {one-line description}

**Confidence:** High / Medium / Low
**Archetype:** {one from the sub-skill's archetype list, or "novel"}
**Files:**
- `path/to/file.ext` (lines ~NNN-MMM, function/method name)
- `path/to/paired-file.ext` (paired via {rule from pairing table})

**Evidence:**
Strategy {Fx or Bx} found {result}. Specifically:
```bash
{exact grep command run}
# → {result summary, match count}
```
{2-3 sentences of reasoning linking evidence to hypothesis}

**Risk if wrong:**
{What else might break if this hypothesis is incorrect}
```

Write 1-3 fix tasks into PART 2 using the standard LLD task shape:

```markdown
## T1 — {short description}
- **Layer:** {Backend/Java | Frontend/AngularJS | Frontend/Angular18 | REST | ExtJS | XHTML}
- **Files:** {file path}
- **Change:** {1-2 sentences at contract level — not actual code}
- **Verify By:** {how Surgeon confirms the fix locally}
- **Depends On:** {none or T-prior}
- **Hypothesis:** {H1/H2/H3}
```

Write 1 regression test task per fix task into PART 4, using the test location map from the appropriate sub-skill.

---

## Hard rules (apply to all bug localization)

1. **Never modify code.** Explorer is read-only in every mode. Same contract as Story Mode.
2. **Cap candidate files at 5 after pairing.** If you can't narrow below 5, stop and ask for more info.
3. **Never skip cross-stack pairing.** Fixing one side of a paired change without updating the other is the most common cause of regressions.
4. **Don't sync the epic codebase map in Bug Mode.** Bug fixes don't need it and the sync is expensive. The exception is Sub-Bug Mode, which *reads* the parent's existing map without syncing it.
5. **Every hypothesis must cite grep evidence.** No "I think it might be in X" without proof. If you can't show your work, you don't have a hypothesis.
6. **Cap fix tasks at 3.** If a bug needs more, it's actually a small story — escalate to Story Mode and file a new ticket.
7. **For layers with no automated test framework** (ExtJS, XHTML/JSF), write the regression test task anyway but mark it "manual QA" with clear steps for the QA team.
8. **Never invent file paths.** Every file you reference in a hypothesis must have been returned by a grep or find command you actually ran.

---

## Sub-Bug Mode (parent story context)

If `contexts/{TICKET_ID}.md` PART 1 has a "Parent Story Context" section with a parent LLD path, you are in **Sub-Bug Mode**. Before running Step 0, read the parent LLD and the epic codebase map (read-only — do not sync), then run **Strategy 0** from whichever sub-skill matches:

**Strategy 0 — Parent task cross-reference.** Extract the file paths from the parent story's PART 2 (LLD Tasks). Compare them against the bug's reproduction path, message keys, or affected area. If any parent-task file is a direct match, that's almost certainly H1 with very high confidence — the parent story just touched it and it's now broken.

If Strategy 0 finds a high-confidence hit, you may write the hypothesis immediately and skip the other strategies. If not, proceed to Step 0 and the normal flow.

Strategy 0 is the single highest-leverage strategy for sub-bugs because the parent's PART 2 is a pre-computed "what we just changed" list. Most sub-bugs are "the thing we just built is broken in this one case," and cross-referencing against the just-built file list finds it in one shot.
