---
name: iiq-ticket-schema-story
description: IIQ Story/Task/Spike ticket anatomy + requirement synthesis. Parse all 14 sections, ANALYZE TOGETHER to produce a Requirement Summary, build the AC Registry from that understanding. The Requirement Summary is what Phase B reads to generate LLD + tasks + test plan.
---

# IIQ Story Schema

**Load in Phase A, BEFORE reading the ticket. Skip for Bug tickets.**

Three stages:
1. **PARSE** — read all 14 sections, extract raw data
2. **SYNTHESIZE** — analyze together, produce Requirement Summary
3. **REGISTER** — build AC Registry enriched by the synthesis

---

## Stage 1: PARSE (read all 14 sections)

| # | Section | Where in JIRA | Extract |
|---|---------|---------------|---------|
| 1 | Key Details | Header/sidebar | ID, type, status, priority, assignee, sprint, points, labels, components, fix version, epic link, parent, created/updated. Flag empty. |
| 2 | Description | Description field | Buckets: Business Context (why), Requirements (what), Technical Notes (how), Out of Scope, Links, Ambiguities. Detect embedded sections. |
| 3 | User Story | Custom field or Description | `As a [role], I want [goal], so that [benefit]`. Multiple → multiple use cases. |
| 4 | In Scope / Out of Scope | Description or custom field | In-scope items, out-of-scope items. |
| 5 | Assumptions | Description or custom field | Classify: data, permission, API, browser, dependency. |
| 6 | UI/UX Design Links | Custom field or Description | All URLs. Check access. Note components, states, tokens from designs. |
| 7 | Acceptance Criteria | Custom field or Description | Raw ACs — parse format (G/W/T, numbered, bullets, table, prose). |
| 8 | Attachments | Attachments panel | Inventory: filename, type, size. Classify each (screenshot/image, video, spreadsheet, word doc, PDF, design export). Note which ACs reference them by name. READ content per type — see Attachment Protocol below. |
| 9 | Release Notes | Custom field or Description | User-facing feature description. |
| 10 | Doc Notes | Custom field or Description | What docs need updating. |
| 11 | ServiceNow URL | Custom field or Description | Background incident/request link. |
| 12 | Subtasks | Subtask panel | ID, title, status. AC-support only. |
| 13 | Linked Items | Linked Issues | Blockers, parent epic, related stories, cloned from, split from. |
| 14 | Comments | Activity tab | Last 20. AC clarifications, decisions, unanswered questions. AC-support only. |

---

### Attachment Protocol (Section 8 — how to actually read each attachment)

JIRA attachments are real content — not just labels. Each type has a different access method and a different value for AC analysis.

**Step 1: Fetch the attachment list from JIRA**
```
JIRA REST API: GET /rest/api/3/issue/{TICKET_ID}
Response: issue.fields.attachment[]
  Each entry has: { id, filename, mimeType, size, content (download URL), created }

Download URL: GET {content_url}  (requires JIRA auth — use JIRA MCP or API token)
```

**Step 2: Classify each attachment by type and decide action**

```
ATTACHMENT CLASSIFICATION TABLE

Type                 | Detection                  | What to DO
─────────────────────|────────────────────────────|──────────────────────────────────────
Screenshot / Image   | .png .jpg .jpeg .gif .webp | READ as image → apply Figma-like
                     | mimeType starts with        | analysis: identify UI components,
                     | "image/"                    | states, labels visible on screen
─────────────────────|────────────────────────────|──────────────────────────────────────
Figma export         | .png + name contains        | Same as Screenshot — but cross-ref
                     | "figma", "design", "frame"  | component names with shared_paths
                     | or node-id pattern          | to find REUSE candidates
─────────────────────|────────────────────────────|──────────────────────────────────────
Excel / CSV          | .xlsx .xls .csv             | READ data: column headers reveal
                     |                             | data model → inform DATA-type ACs
                     |                             | and backend field names
─────────────────────|────────────────────────────|──────────────────────────────────────
Word / PDF           | .docx .doc .pdf             | READ text: may contain additional
                     |                             | requirements, UX notes, acceptance
                     |                             | criteria not in JIRA fields
─────────────────────|────────────────────────────|──────────────────────────────────────
Video                | .mp4 .mov .avi .webm        | CANNOT read directly
                     |                             | → Flag: "Video attachment {name}
                     |                             |   requires manual review — may show
                     |                             |   interaction flow or bug repro"
                     |                             | → Ask user: "What does {video} show?"
─────────────────────|────────────────────────────|──────────────────────────────────────
Log file / Text      | .log .txt .json .xml        | READ text: error messages, stack
                     |                             | traces, data samples → inform
                     |                             | error handling tasks
─────────────────────|────────────────────────────|──────────────────────────────────────
Unknown / Other      | any other extension         | Note filename only, flag as
                     |                             | "unread — may contain context"
```

**Step 3: For each Screenshot/Image — derive ACs from visual content**

When an AC says "see attachment screenshot_reviewer_ui.png", the agent MUST read that image before assessing the AC. Reading the image is how the agent knows:
- What the expected UI looks like (not just text description)
- Which components are shown (maps to shared_paths aliases)
- What states are visible (loading, error, empty, disabled)
- What labels/messages appear (informs i18n keys needed)

```
FOR each image attachment:
  1. Download via JIRA attachment URL
  2. Read image — identify:
     a. Components visible: map to alias taxonomy
        "I see a dropdown with search box" → searchable-select alias
     b. States visible:
        "Red border on input field" → error state → derive AC-ATT-N
        "Greyed out button" → disabled state → derive AC-ATT-N
     c. Text visible:
        "No reviewers found" → empty state message → add to i18n keys
        "Required field" → validation message → add to i18n keys
     d. Does this conflict with JIRA ACs?
        "Screenshot shows single-select but AC says multi-select" → CONFLICT flag

  3. Link to ACs:
     AC references this attachment → replace "see attachment" with actual content
     AC is now concrete and testable (not "see image for details")
```

**Step 4: For Excel/CSV — extract data model**

```
FOR each Excel/CSV attachment:
  1. Read column headers → these are the field names Surgeon needs to use
  2. Read sample rows → understand data types, nullability, relationships
  3. Map to tasks:
     - Column "reviewerId" → backend DTO field name + Java property
     - Column "certType" → enum values used in certType === 'group' logic
     - Empty columns allowed? → null handling in edge case Q1 checklist
  4. Add to AC constraints: "field names from {filename}: {column list}"
```

**Step 5: For Word/PDF — supplement AC registry**

```
FOR each Word/PDF attachment:
  1. Read all text
  2. Identify: requirements statements, UX notes, acceptance criteria
  3. Compare against JIRA ACs — any requirements in doc but not in JIRA ACs?
     YES → derive AC with source: "From attachment {filename}, page {N}"
  4. Identify: technical constraints, integration notes, data format specs
     → add to BOUNDARIES.CONSTRAINTS
```

**Step 6: For Videos — prompt user**

```
FOR each video attachment:
  Output at checkpoint:
  ⚠ Unread attachment: {filename} ({size})
    Type: Video — cannot be read automatically.
    This may contain: interaction demo, bug reproduction, UX walkthrough.

    Please describe what this video shows, or provide a screenshot of the
    key moment. Without this, related ACs may be incomplete.
    To skip: type `skip {filename}`
```

**Step 7: Map attachments to ACs**

After reading all attachments, update the AC Registry:

```
FOR each AC that references an attachment (by name or "see attachment"):
  Replace the reference with the ACTUAL content extracted:

  BEFORE: "AC3: Given cert loaded, When user opens reviewer panel,
           Then reviewer selector shown (see screenshot_reviewer_ui.png)"

  AFTER:  "AC3: Given cert loaded, When user opens reviewer panel,
           Then sp-reviewer-selector component shown with search input,
           supporting single/multi mode toggle, showing user avatars
           [From screenshot_reviewer_ui.png: shows searchable multi-select
            with user list, loading state skeleton, empty state message]"

  This makes the AC concrete and testable without anyone re-reading the image.
```

**Attachment output block (add to Requirement Summary):**

```
ATTACHMENTS ({N} total — {M} read, {K} pending user input):
  screenshot_reviewer_ui.png → READ ✅
    Shows: sp-reviewer-selector (searchable, multi-select mode)
    States found: loading (skeleton), empty ("No reviewers"), selected (3 users)
    Derived ACs: AC-ATT-1 (loading), AC-ATT-2 (empty state)
    Conflicts: none

  data_model_v2.xlsx → READ ✅
    Fields: reviewerId, reviewerName, certType, certId, assignedDate
    Nullability: certType required, assignedDate nullable
    Added to constraints: "certType enum: individual|group|manager"

  demo_flow.mp4 → UNREAD ⚠
    Size: 8.2MB | Type: video
    ⚠ User input needed: describe what this video demonstrates
```

---

**After parsing all 14 sections, STOP. Do not jump to task generation yet.**

Analyze everything together and produce a **Requirement Summary** — a compact, unified understanding of what this story needs. This is what Phase B reads.

### 2a: Core Requirement (from User Story + Description + In Scope)

```
CORE REQUIREMENT:
  WHO:   {role from User Story}
  WHAT:  {goal from User Story, refined by Description Requirements + In Scope items}
  WHY:   {benefit from User Story, validated by Release Notes}
  WHERE: {pages/modules affected — from Description Technical Notes + UI/UX Links}
```

### 2b: Boundaries (from Scope + Assumptions + Comments + Linked Items)

```
BOUNDARIES:
  MUST DO:     {In Scope items — these are non-negotiable}
  MUST NOT DO: {Out of Scope items — hard exclusions}
  CONSTRAINTS: {Assumptions that limit implementation}
    - "{assumption}" → limits: {what it constrains}
  DECISIONS:   {From Comments — later overrides earlier}
    - "{decision}" by @{author} on {date} → affects: {what it changes}
  DEPENDS ON:  {From Linked Items — blockers, related story outputs}
    - {TICKET_ID} ({status}) — provides: {what it gives us}
  SPLIT FROM:  {What was carved out — from split-from tickets}
```

### 2c: Visual Specification — Systematic Figma Analysis

**Problem with shallow parse:** Saying "Figma shows a dropdown" misses 70% of the information. The states, interactions, and empty/error conditions shown in Figma ARE acceptance criteria — just implicit ones. Missing them means Surgeon implements the happy path only and QA finds the rest.

**Protocol: Extract everything visible in the design systematically.**

#### Step 0: Access Figma (do this BEFORE any extraction)

Figma URLs from Section 6 come in two forms:
```
Form A — File + node:
  https://www.figma.com/design/{fileKey}/{fileName}?node-id={nodeId}
  https://www.figma.com/file/{fileKey}/{fileName}?node-id={nodeId}

Form B — Prototype:
  https://www.figma.com/proto/{fileKey}/{fileName}?node-id={nodeId}
```

**Try access in this order:**

**Option 1: Figma MCP (preferred — if configured in pipeline.yaml)**
```yaml
# pipeline.yaml mcp_servers entry:
# - name: figma
#   url: https://figma.mcp.example.com
```
If Figma MCP is available → use it to fetch frame data directly.
Returns structured frame JSON: component tree, properties, text content.

**Option 2: Figma REST API (if token available)**
```bash
# Check if FIGMA_API_TOKEN is set in environment or pipeline.yaml secrets
FIGMA_API_TOKEN=$(yaml_get secrets.figma_token 2>/dev/null)

if token exists:
  # Get file and specific node
  GET https://api.figma.com/v1/files/{fileKey}/nodes?ids={nodeId}
  Headers: X-Figma-Token: {FIGMA_API_TOKEN}

  Returns: component tree with names, types, children, text content
  No visual rendering — but component names + text reveals most info needed
```

**Option 3: Browser navigation (Cursor with browser tools)**
```
Navigate to the Figma URL
IF requires login → stop, flag: "Figma requires authentication"
IF loads → take screenshot, read visible component names, states, labels
```

**Option 4: Node-id targeting (when URL has node-id)**
```
Figma URLs often include ?node-id=123-456
This is the SPECIFIC FRAME the designer linked to — read that frame first.
Don't try to read the whole file — just the linked frames.
If multiple frames needed, node-ids are comma-separated or use multiple URLs.
```

**IF Figma is inaccessible (auth required, link broken, VPN needed):**
```
⚠ Figma design inaccessible
  URL: {url}
  Reason: {auth required / link broken / rate limited}

  Options:
  A. `Share figma` — paste screenshot(s) directly in chat
  B. `Export frames` — export relevant frames as PNG, attach to ticket
  C. `Skip figma` — proceed without visual spec (derived ACs from Figma = 0)
  D. Provide FIGMA_API_TOKEN: add to pipeline.yaml secrets.figma_token

  Proceeding without visual spec means:
  - Loading/empty/error states will NOT be derived as ACs
  - Component reuse decisions will be less accurate
  - QA may find UI gap bugs post-sprint
```

**Detecting which frames to read:**

A Figma file can have 100+ frames. The designer links to specific ones. Identify the relevant frames:

```
1. node-id in URL → that exact frame + its children
2. Multiple URLs in Section 6 → read each linked node
3. No node-id → use Figma API GET /files/{fileKey}/pages
   → scan page names for story-relevant names (e.g., "IIQMAG-1234", "cert-list", "reviewer-flow")
   → read only those pages, not the entire file

4. From Attachments Section 8: any .png/.jpg with "figma" or "design" in the name
   → likely a Figma export → read as image (see Attachment protocol below)
```

**What to extract from the Figma API response (no visual needed):**

```javascript
// Figma API returns a node tree. Walk it to extract:
function extractFromNode(node) {
  // Component name → maps to alias taxonomy
  // node.name: "Button/Primary", "Input/Text", "Dropdown/Multi-select"
  // These names follow Figma component naming conventions

  // Text content → reveals labels, placeholder text, error messages
  // node.type === "TEXT" → node.characters = the actual text

  // Component states → identified by variant names
  // node.name includes "State=Error", "State=Loading", "State=Disabled"
  // This is how Figma variants are named — parse the "=" to find state

  // Visibility → node.visible === false → this is a non-default state
}
```

**Parsing component names to aliases:**
```
Figma component name          → Alias taxonomy match
─────────────────────────────────────────────────────
"Button/Primary"              → button
"Input/Text"                  → input
"Dropdown/Single-select"      → select, dropdown
"Dropdown/Multi-select"       → multi-select
"DatePicker/Range"            → date-range
"Table/Sortable"              → table, grid
"Modal/Confirmation"          → confirm-dialog, modal
"State=Loading"               → loading state → derive AC
"State=Empty"                 → empty state → derive AC
"State=Error"                 → error state → derive AC
```

**Once access is confirmed → proceed with Steps 1–5 below.**

#### Step 1: Component Inventory

For every Figma frame/screen linked in Section 6:

```
FOR each Figma frame:
  LIST every visible UI element:
    - Component type (button / input / dropdown / modal / grid / etc.)
    - Component variant/size if shown (primary/secondary, sm/md/lg)
    - Domain label if shown (reviewer dropdown, cert list grid)

  CROSS-REFERENCE with shared_paths.frontend.ui_elements[*].provides:
    - If match found → existing shared component (REUSE candidate)
    - If no match → new component (CREATE candidate, flag if novel)
```

#### Step 2: State Extraction (the most missed step)

For each component, examine ALL visible states. Figma designers usually include multiple states — they're not decoration, they are specs.

```
FOR each component identified in Step 1:
  SCAN for these states (each non-default state = implicit AC):

  Visual state         | Look for                          | Derives AC
  ─────────────────────|───────────────────────────────────|──────────────────────
  DEFAULT              | Main/primary frame                | Base AC (usually explicit)
  HOVER                | :hover or separate hover artboard | Derive AC if interactive
  FOCUS                | Input focus ring, highlighted     | Derive AC for accessibility
  ACTIVE/PRESSED       | Button depressed state            | Usually included in base AC
  DISABLED             | Greyed out, no pointer events     | Derive AC: who/when disabled?
  LOADING              | Spinner, skeleton, progress       | Derive AC: loading state shown
  EMPTY                | "No items", placeholder text      | Derive AC: empty state message
  ERROR                | Red border, error message below   | Derive AC: validation/fetch error
  SUCCESS              | Checkmark, green state            | Derive AC: success feedback
  READ-ONLY            | Non-editable appearance           | Derive AC: when read-only?
  SELECTED             | Highlighted row, checked state    | Derive AC: selection behavior
  EXPANDED/COLLAPSED   | Accordion, tree node              | Derive AC: toggle behavior
```

**For each non-default state found:**
→ Derive AC if not already in the JIRA AC list
→ Mark as `DERIVED (Figma: {frame name}, {state} state)`
→ This AC feeds task generation — Surgeon MUST implement this state

#### Step 3: Interaction Flow Extraction

```
FOR each interactive element visible:
  What happens ON CLICK / ON CHANGE / ON SUBMIT?
    - Button → modal opens? Form submits? Navigation happens?
    - Dropdown → filter applies? Page refreshes? Another section shows?
    - Form submit → spinner? Success message? Error message?
    - Row click → detail panel opens? Navigation?

  Each distinct interaction = verify it's covered by an AC.
  If not → derive AC: "Given {element} visible, When user {action}, Then {outcome}"
```

#### Step 4: Layout Constraints That Imply Behavior

```
- Empty container vs empty state component → implies: must show empty state, not blank
- Loading skeleton vs spinner → implies: use skeleton (not spinner) for content loading
- Pagination visible at bottom → implies: must implement pagination (not load all)
- "X of N results" text → implies: must show total count from backend
- Sort arrows on column header → implies: sortable column, server-side sort
- Search/filter visible → implies: debounced search, not instant
```

#### Step 5: Output — Visual Specification Block

```
VISUAL SPEC:
  Access method: {Figma MCP / API token / Browser / Screenshot attachment / Inaccessible}
  Frames analyzed: {N} ({list of frame names})
  Total components: {M}

  Components × shared_paths match:
    ♻️ sp-reviewer-selector → reviewers dropdown (multi-select + single-select frame)
    ♻️ sp-data-grid         → certifications list (sortable, paginated frame)
    ♻️ sp-loading           → loading skeleton visible in "loading" frame
    ♻️ sp-empty-state       → empty list frame shows centered message + icon
    🆕 certDetailPanel      → no match in shared_paths (novel component)

  States requiring AC derivation (not in JIRA ACs):
    DERIVED AC-F1: Loading state for reviewer fetch
      Given cert detail loaded, When reviewers are loading,
      Then loading indicator shown in reviewer select area
      Source: Figma frame "certDetail_loading"

    DERIVED AC-F2: Empty reviewer state
      Given cert loaded, When no eligible reviewers exist,
      Then empty state message "No reviewers available" shown
      Source: Figma frame "certDetail_noReviewers"

    DERIVED AC-F3: Error state for reviewer fetch failure
      Given cert loaded, When reviewer fetch fails,
      Then error notification shown, reviewer area shows error message
      Source: Figma frame "certDetail_error"

    DERIVED AC-F4: Disabled submit when no reviewer selected
      Given multi-select mode, When no reviewers selected,
      Then "Submit" button is disabled
      Source: Figma frame "certDetail_noSelection"

  Interactions identified:
    - "Submit" click → confirmation dialog (sp-confirm-dialog)
    - Reviewer search input → debounced filter (500ms per Figma spec note)
    - "Cancel" button → navigate back to cert list

  Layout constraints identified:
    - Pagination shown at bottom → server-side pagination, not load-all
    - "X of N" text → total count from backend required in API response
```

**All DERIVED ACs from Figma analysis go into the AC Registry and are presented at checkpoint.**
They are subject to the same VAGUE AC gate as JIRA ACs — if Figma shows something ambiguous, it must be clarified before Phase B.

```
FOR each Figma frame:
  LIST every visible UI element:
    - Component type (button / input / dropdown / modal / grid / etc.)
    - Component variant/size if shown (primary/secondary, sm/md/lg)
    - Domain label if shown (reviewer dropdown, cert list grid)

  CROSS-REFERENCE with shared_paths.frontend.ui_elements[*].provides:
    - If match found → existing shared component (REUSE candidate)
    - If no match → new component (CREATE candidate, flag if novel)
```

#### Step 2: State Extraction (the most missed step)

For each component, examine ALL visible states. Figma designers usually include multiple states — they're not decoration, they are specs.

```
FOR each component identified in Step 1:
  SCAN for these states (each non-default state = implicit AC):

  Visual state         | Look for                          | Derives AC
  ─────────────────────|───────────────────────────────────|──────────────────────
  DEFAULT              | Main/primary frame                | Base AC (usually explicit)
  HOVER                | :hover or separate hover artboard | Derive AC if interactive
  FOCUS                | Input focus ring, highlighted     | Derive AC for accessibility
  ACTIVE/PRESSED       | Button depressed state            | Usually included in base AC
  DISABLED             | Greyed out, no pointer events     | Derive AC: who/when disabled?
  LOADING              | Spinner, skeleton, progress       | Derive AC: loading state shown
  EMPTY                | "No items", placeholder text      | Derive AC: empty state message
  ERROR                | Red border, error message below   | Derive AC: validation/fetch error
  SUCCESS              | Checkmark, green state            | Derive AC: success feedback
  READ-ONLY            | Non-editable appearance           | Derive AC: when read-only?
  SELECTED             | Highlighted row, checked state    | Derive AC: selection behavior
  EXPANDED/COLLAPSED   | Accordion, tree node              | Derive AC: toggle behavior
```

**For each non-default state found:**
→ Derive AC if not already in the JIRA AC list
→ Mark as `DERIVED (Figma: {frame name}, {state} state)`
→ This AC feeds task generation — Surgeon MUST implement this state

#### Step 3: Interaction Flow Extraction

```
FOR each interactive element visible:
  What happens ON CLICK / ON CHANGE / ON SUBMIT?
    - Button → modal opens? Form submits? Navigation happens?
    - Dropdown → filter applies? Page refreshes? Another section shows?
    - Form submit → spinner? Success message? Error message?
    - Row click → detail panel opens? Navigation?

  Each distinct interaction = verify it's covered by an AC.
  If not → derive AC: "Given {element} visible, When user {action}, Then {outcome}"
```

#### Step 4: Layout Constraints That Imply Behavior

```
- Empty container vs empty state component → implies: must show empty state, not blank
- Loading skeleton vs spinner → implies: use skeleton (not spinner) for content loading
- Pagination visible at bottom → implies: must implement pagination (not load all)
- "X of N results" text → implies: must show total count from backend
- Sort arrows on column header → implies: sortable column, server-side sort
- Search/filter visible → implies: debounced search, not instant
```

#### Step 5: Output — Visual Specification Block

```
VISUAL SPEC:
  Frames analyzed: {N} ({list of frame names})
  Total components: {M}

  Components × shared_paths match:
    ♻️ sp-reviewer-selector → reviewers dropdown (multi-select + single-select frame)
    ♻️ sp-data-grid         → certifications list (sortable, paginated frame)
    ♻️ sp-loading           → loading skeleton visible in "loading" frame
    ♻️ sp-empty-state       → empty list frame shows centered message + icon
    🆕 certDetailPanel      → no match in shared_paths (novel component)

  States requiring AC derivation (not in JIRA ACs):
    DERIVED AC-F1: Loading state for reviewer fetch
      Given cert detail loaded, When reviewers are loading,
      Then loading indicator shown in reviewer select area
      Source: Figma frame "certDetail_loading"

    DERIVED AC-F2: Empty reviewer state
      Given cert loaded, When no eligible reviewers exist,
      Then empty state message "No reviewers available" shown
      Source: Figma frame "certDetail_noReviewers"

    DERIVED AC-F3: Error state for reviewer fetch failure
      Given cert loaded, When reviewer fetch fails,
      Then error notification shown, reviewer area shows error message
      Source: Figma frame "certDetail_error"

    DERIVED AC-F4: Disabled submit when no reviewer selected
      Given multi-select mode, When no reviewers selected,
      Then "Submit" button is disabled
      Source: Figma frame "certDetail_noSelection"

  Interactions identified:
    - "Submit" click → confirmation dialog (sp-confirm-dialog)
    - Reviewer search input → debounced filter (500ms per Figma spec note)
    - "Cancel" button → navigate back to cert list

  Layout constraints identified:
    - Pagination shown at bottom → server-side pagination, not load-all
    - "X of N" text → total count from backend required in API response
```

**All DERIVED ACs from Figma analysis go into the AC Registry and are presented at checkpoint.**
They are subject to the same VAGUE AC gate as JIRA ACs — if Figma shows something ambiguous, it must be clarified before Phase B.

### 2d: Cross-Reference Check (find conflicts, gaps, AND reuse opportunities)

```
CROSS-REFERENCE:

  Epic Context ↔ ACs (ONLY for subsequent stories — skip if first story):
    FOR each AC, check if epic-context has files/components that satisfy it:
    - AC needs "date picker"? → epic-context says datePicker.js CREATED by IIQMAG-1234
      → REUSE: task is "configure existing" not "create new"
    - AC needs "date validation"? → epic-context says dateValidationService.js EXISTS
      → REUSE: don't recreate, wire to existing
    - AC needs "REST filter"? → epic-context says CertResource has date param pattern
      → FOLLOW: same pattern in AccessReviewResource
    - AC needs something NOT in epic-context?
      → CREATE: this is genuinely new work

  Epic Context → Constraints:
    - Any constraint from prior stories applies here?
      e.g., "flatpickr conflicts with air-datepicker" → apply to all date tasks
    - Any decision from prior stories governs this story?
      e.g., "ISO 8601 format decided" → all date handling follows this

  Scope ↔ ACs:
    - All in-scope items covered by ACs? {yes / GAP: {item} has no AC}
    - Any AC overlaps with out-of-scope? {no / CONFLICT: AC{N} vs out-of-scope}

  Assumptions ↔ ACs:
    - Any assumption contradicts an AC? {no / CONFLICT}

  Design ↔ ACs:
    - Design shows components not in ACs? {no / GAP}
    - ACs require behavior not in design? {no / GAP}

  Comments ↔ Description:
    - Any comment decision overrides Description? {no / OVERRIDE}

  Subtasks ↔ ACs:
    - Subtask covers scope no AC addresses? {no / GAP}
```

### 2e: Produce the Requirement Summary

**This is the KEY OUTPUT of Stage 2.** Compact enough for Phase B to consume without re-reading all 14 sections.

```
REQUIREMENT SUMMARY
═══════════════════

STORY: {ID} — {title}
ROLE:  {who}  →  GOAL: {what}  →  BENEFIT: {why}

WHAT TO BUILD:
  1. {deliverable — CREATE/MODIFY/REUSE based on epic-context + Figma analysis}
  2. {deliverable}
  3. {deliverable}

REUSE FROM PRIOR STORIES (from epic-context.md):
  ♻️ {file} — {what it does} — CREATED by {TICKET}, reusable: configure for this story
  ♻️ {file} — {pattern} — follow same approach as {TICKET}
  (if first story: "No prior stories — all components are new")

REUSE FROM FIGMA (shared components identified in design):
  ♻️ {component} → for {which AC/interaction}
  (these are locked — do not create new versions of existing shared components)

BOUNDARIES:
  ✅ Must: {in-scope items}
  ❌ Must not: {out-of-scope items}
  ⚠️ Constrained by: {assumptions + prior story decisions + prior story constraints}

VISUAL: {N} frames | {M} components | {K} non-default states extracted
  States deriving new ACs: {loading, empty, error, disabled — each one listed}
  Interactions deriving new ACs: {click→modal, submit→feedback, etc.}
  Layout constraints: {pagination, count, debounce}

PRIOR WORK: {from epic-context — patterns, decisions, constraints}
DEPENDS ON: {blocker tickets and their status}

FIGMA-DERIVED ACs (from states/interactions in design — not in JIRA):
  - AC-F1 [DERIVED Figma]: {text} — Source: {frame name, state}
  - AC-F2 [DERIVED Figma]: {text} — Source: {frame name, interaction}
  (these go through VAGUE AC gate same as JIRA ACs)

GAPS FOUND:
  - {gap — in-scope item without AC → derive AC}

CONFLICTS FOUND:
  - {conflict — ask user}

OPEN QUESTIONS:
  - {unanswered items}
```

---

## Stage 3: REGISTER (build AC Registry from synthesis)

**Now parse ACs in detail, INFORMED by the Requirement Summary.**

### 3a: AC Parse

Detect format:

| Format | Detection | Parse |
|--------|-----------|-------|
| Given/When/Then | "Given"/"When"/"Then" keywords | Extract precondition, trigger, outcome per AC |
| Numbered list | `1.` `2.` `3.` | Each number = 1 AC |
| Bullets / Checkboxes | `-` `*` `•` `[ ]` | Each item = 1 AC |
| Table | Markdown/JIRA table | Each row = 1 AC |
| Sub-items | Indented under parent | Parent = group, sub-item = 1 AC |
| Prose | No markers | Each paragraph = 1 AC (flag vague) |

**For Given/When/Then (IIQ standard):**
```
FOR each AC (AC1...ACN):
  1. Extract: Given → precondition | When → trigger | Then → outcome
  2. Classify: PERMISSION / NAVIGATION / INTERACTION / UI / DATA / VALIDATION / INTEGRATION
  3. Compound Then? ("and"/"also") → SPLIT into AC1a, AC1b
  4. Attachment reference? → link to specific attachment
  5. Testability: TESTABLE / VAGUE (flag) / INCOMPLETE (flag)
```

### 3b: Derive ACs from Synthesis Gaps

The CROSS-REFERENCE in Stage 2 already identified gaps. Now create derived ACs:

```
FOR each GAP found in Stage 2d:
  - In-scope item without AC → derive AC covering that item
  - Design component without AC → derive AC for that component
  - Subtask revealing uncovered scope → derive AC
  - Unanswered question implying requirement → derive AC (flag for confirmation)

Mark all DERIVED with source. Present at checkpoint for user confirmation.
```

### 3c: Enrich ACs with Synthesis Context

Each AC now carries context FROM the Requirement Summary:

```
AC REGISTRY ({N} total: {X} JIRA, {Y} derived, {Z} split)

Each AC entry:
  { id, source, type, given/when/then, testability, attachments,
    constraints: [assumptions + comment decisions affecting this AC],
    visual_ref: [design frame/attachment for this AC],
    related_scope: [which in-scope item this AC satisfies] }
```

### 3d: VAGUE AC RESOLUTION GATE (HARD BLOCK — Phase B cannot start until this passes)

**After building the AC Registry, check every AC's testability.**

```
VAGUE_ACS = [ac for ac in registry if ac.testability in ['VAGUE', 'INCOMPLETE']]

IF VAGUE_ACS is empty → proceed to Phase B normally

IF VAGUE_ACS is NOT empty → STOP. Show the block:
```

```
⛔ VAGUE AC GATE — Phase B is BLOCKED

The following ACs cannot drive tasks because they are too vague
to produce deterministic test cases:

AC{N} [VAGUE]: "{original text}"
  Problem: {why it's vague — e.g., "no measurable outcome", "missing trigger condition"}
  Fix options:
    A. Replace with: "Given {precondition}, When {trigger}, Then {specific outcome}"
    B. Split into: AC{N}a ({specific scenario 1}) + AC{N}b ({specific scenario 2})
    C. Skip: mark out-of-scope (conscious decision)

AC{M} [INCOMPLETE]: "{original text}"
  Problem: {what's missing — e.g., "Then clause is missing", "precondition undefined"}
  Fix options:
    A. Complete the AC: add "{what's missing}"
    B. Ask PO/BA to clarify before proceeding
    C. Skip: mark deferred

Reply with one of:
  `AC{N}: {replacement text}` — provide the specific AC text
  `AC{N}: skip` — consciously defer this AC
  `AC{N}: ask` — pause sprint, escalate to PO

Pipeline CANNOT proceed until every VAGUE/INCOMPLETE AC is either
resolved, skipped, or escalated. Ambiguous ACs → ambiguous tasks →
ambiguous code → bugs found in QA, not here.
```

**Resolution rules:**
- User provides replacement text → validate it is TESTABLE (has Given/When/Then or equivalent specificity)
- If still vague after replacement → ask again (max 3 attempts, then force skip)
- Skipped ACs are logged in the LLD as `[SKIPPED — reason]` so the team knows consciously
- Zero VAGUE ACs remaining → unlock Phase B

**Why this is a HARD block (not a warning):** A VAGUE AC like "system should handle reviewer selection correctly" generates a VAGUE task which generates VAGUE code which generates VAGUE tests. The ambiguity compounds through Orchestrator → Explorer → Surgeon → Review. By the time it reaches QA, it's a P1 bug with "we weren't sure what it should do." Blocking here is 10x cheaper than fixing it in QA.

---

## What the Orchestrator receives from this schema

After running all 3 stages, Phase A has:

1. **Requirement Summary** — compact understanding of the WHOLE story (Phase B reads this to write PART 1 of LLD)
2. **Enriched AC Registry** — every AC with context, constraints, visual refs (Phase B reads this to generate PART 2 tasks)
3. **Gaps + Conflicts** — presented at checkpoint for user to resolve before Phase B
4. **Open Questions** — unanswered items flagged for user

Phase B then generates:
- **PART 1 (LLD Design)** ← from Requirement Summary
- **PART 2 (Tasks)** ← from Enriched AC Registry (tasks come from ACs ONLY)
- **PART 3 (Test Plan)** ← from ACs + edge cases from synthesis
- **PART 4 (Test Tasks)** ← from AC-driven test scenarios

---

## Task Generation — GOLDEN RULE

**Tasks come from ACs ONLY.** The Requirement Summary INFORMS the LLD design. The AC Registry DRIVES the task list. Everything else is context.

1. Every AC → ≥1 task
2. In-scope items → covered by ≥1 AC (derive if not)
3. Assumptions constrain tasks (don't create them)
4. Comment decisions refine tasks (don't create them)
5. Subtasks validate alignment (don't create tasks)
