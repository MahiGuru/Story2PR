---
name: ticket-schema-template
description: Template ticket schema for new projects. Copy this file and customize the Section Map, AC format, and task generation rules for your project's JIRA ticket structure.
---

# Ticket Schema Template

## How to use

1. Copy this file to your pack's skills folder: `packs/{pack}/skills/{pack}-ticket-schema.md`
2. Customize the Section Map for your project's JIRA ticket anatomy
3. Customize the AC parse rules for your team's AC format
4. Add to `pipeline.yaml` under `skills.orchestrator.story_schema`
5. The Orchestrator will load this skill in Phase A0 before reading any ticket

---

## Section Map — Customize for your project

```
YOUR PROJECT JIRA TICKET
├── 1.  KEY DETAILS (standard JIRA fields — usually same across projects)
├── 2.  DESCRIPTION (always present — customize parse buckets)
├── 3.  [YOUR SECTION] (custom field or section header)
├── 4.  [YOUR SECTION] (...)
├── ...
├── N-2. LINKED WORK ITEMS (standard — customize link types)
├── N-1. SUBTASKS (standard)
└── N.   ACTIVITY (standard — customize comment classification)
```

### How to define a section:

For each section, define:
- **Where:** Where to find it in JIRA (custom field name, section in Description, attachments panel)
- **Format:** What format the content is in (prose, list, table, links, Given/When/Then, key-value)
- **Parse strategy:** How to extract structured data from it
- **Downstream use:** Which agent/phase uses this data and how

---

## AC Format — Customize for your team

Different teams write ACs differently. Define YOUR team's format:

| If your team writes ACs as... | Detection pattern | Parse strategy |
|-------------------------------|-------------------|----------------|
| Given/When/Then | Lines contain "Given", "When", "Then" | G/W/T parser |
| Numbered requirements | Lines start with 1., 2., 3. | Each number = 1 AC |
| User stories per AC | "As a... I want... So that..." per AC | Role/goal/benefit per AC |
| Bullet points | - or * prefixed lines | Each bullet = 1 AC |
| BDD scenarios | "Scenario:", "Feature:" | Gherkin parser |
| Free-form | No consistent format | Paragraph = 1 AC (flag as vague) |

---

## Task Generation Rules — Customize for your stack

Define how parsed ACs become tasks for YOUR technology stack:

```
Example for a Next.js + Flask project:

Layer values:
  - Frontend/React     → Next.js pages, components, hooks
  - Frontend/Style     → Tailwind, CSS modules
  - Backend/Flask      → Flask routes, services
  - Backend/Postgres   → Database migrations, queries
  - Infrastructure     → Docker, CI/CD
  - Test               → pytest, jest

Layer boundary rule:
  AC touching "UI + API + DB" = 3 tasks (React + Flask + Postgres)

File pattern mappings:
  Frontend/React → src/pages/**, src/components/**
  Backend/Flask  → app/routes/**, app/services/**
```

---

## Checklist for new project schemas

- [ ] All custom JIRA fields documented with their field names
- [ ] AC format defined with detection patterns
- [ ] Layer values match your pipeline.yaml layer_map
- [ ] File pattern mappings match your project structure
- [ ] Task generation rules defined for your stack
- [ ] Comment classification rules defined
- [ ] Linked item types defined
