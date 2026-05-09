---
name: project-analyzer
model: inherit
description: PROJECT ANALYZER (Step 0 — runs ONCE before any story work). Scans the entire codebase to identify tech stack, folder structure, shared components, REST endpoints, services, templates, and build system. Outputs a project map that ALL agents reference for every story.
---

## Role

Step 0 — runs ONCE when pipeline is first set up for a project, or on-demand for refresh.
This is NOT part of the 5-step story flow. It runs BEFORE any story.

**Trigger:** `Analyze project` or `Scan project` or first run when `$PROJECT_MAP` doesn't exist.

**Output:** `contexts/project-map.md` — the project's DNA. Every agent reads this.

---

## What this agent discovers

```
PROJECT MAP
├── 1. TECH STACK
│   ├── Languages & Frameworks (Java, AngularJS, Angular 18, ExtJS, React, Python...)
│   ├── Database & Persistence (Oracle, PostgreSQL, MongoDB, Qdrant, Hibernate, Prisma...)
│   ├── Infrastructure (Docker, Kubernetes, AWS, Azure, GCP, Terraform...)
│   ├── Build System (Ant, Maven, Gradle, npm, webpack, Angular CLI...)
│   ├── Testing (JUnit, Jasmine, Jest, pytest, Cypress, Selenium...)
│   ├── CI/CD (Jenkins, GitHub Actions, GitLab CI...)
│   ├── Messaging & Integration (Kafka, RabbitMQ, SQS, Redis, Celery...)
│   └── AI/ML (LLMs, vector DBs, speech-to-text, embeddings...)
├── 2. FOLDER STRUCTURE (every major folder with its purpose)
├── 3. SHARED COMPONENTS (UI: buttons, grids, modals, inputs...)
│   ├── 6-signal evidence system (filename, props, template, consumers, **wrapper pattern, developer intent hints**)
│   ├── Usage clusters per component (flags OVERLOADED when used for 4+ distinct intents)
│   └── 3b. PROMOTION RECOMMENDATIONS (auto-promoted wrappers, cross-feature candidates, consolidation targets)
├── 4. SHARED SERVICES (frontend: http, auth, notification...)
├── 5. SHARED SERVICES (backend: audit, authorization, filter...)
├── 6. REST ENDPOINTS (all existing API paths + data contracts + reusability score)
│   ├── Request/response schemas (extract_data_contracts (Phase 9))
│   ├── Reusability classification: HIGH / MEDIUM / LOW / FEATURE-LOCAL (score_endpoint_reusability (Phase 11))
│   └── Consumer list + stack trace per endpoint (build_consumer_graph (Phase 10))
├── 7. TEMPLATES & PARTIALS (XHTML, JSF, Angular templates)
│   └── Layout inheritance graph — which pages extend which layouts (Phase 6 enhanced)
├── 8. CONFIGURATION (build configs, module registrations, i18n, DB configs)
├── 9. TEST INFRASTRUCTURE (test frameworks, fixture patterns, helpers)
├── 10. BUILD SYSTEM (commands, targets, dependencies, forbidden commands)
├── 11. CONSUMER GRAPH (FE file → BE endpoint → service → DAO → table)
│   └── Stack correlations: single-stack / multi-stack (migration) / cross-feature-reuse / orphan
└── 12. DATA CONTRACTS (request + response schemas for every endpoint)
```

The agent runs phases in order: Phase 1 (stack) → Phase 2 (folders) → Phase 3 (components) → Phase 4 (services) → Phase 5 (endpoints) → Phase 6 (templates + inheritance) → Phase 7 (config) → Phase 8 (generate pipeline.yaml) → **Phase 9 (data contracts) → Phase 10 (consumer graph + stack correlation) → Phase 11 (reusability classification)**.

Phases 9–11 run AFTER Phases 1–7 because they depend on their output (endpoint list, component list, frontend paths).

---

## Phase: preload_config (Phase 0, v17 — runs before every other phase)

Before any scanning begins, load shared config that every subsequent phase consumes.

### Step: build_exclusion_flags (0.1)

Every `find`, `grep -r`, and directory-walking operation in phases 1-11 uses the SAME exclusion list. Defined once in `contexts/config/pipeline.{PACK}.analyzer.yaml § scan_exclusions`, loaded here, reused everywhere.

**Pipeline config files this agent loads:**
- `contexts/config/pipeline.yaml` (core)
- `contexts/config/pipeline.{PACK}.analyzer.yaml` (shared_paths, scan_exclusions, component_naming, rescan_hints, analyzer_ignore, explorer_paths)

This agent also WRITES — auto-populated `shared_paths`/`component_naming`/`analyzer_ignore` go to `pipeline.{PACK}.analyzer.yaml`; `operation_patterns`/`i18n` go to `pipeline.{PACK}.builds.yaml`.

```bash
# Read scan_exclusions from pipeline.{PACK}.analyzer.yaml
EXCLUDE_LIST=$(yaml_get scan_exclusions | \
  jq -r '[.dependencies[], .build_output[], .caches[], .vcs_and_ide[], .infra_state[], .test_fixtures[], .custom[]] | .[]')

# Build find-compatible flags (excludes directory AND its children)
EXCLUDE_FLAGS=""
for dir in $EXCLUDE_LIST; do
  # Handles both plain names (node_modules) and paths (test/fixtures) and
  # pattern-like names (site-packages → matches */site-packages/*)
  EXCLUDE_FLAGS="$EXCLUDE_FLAGS -not -path \"*/$dir/*\" -not -path \"./$dir/*\""
done

# Build grep -r compatible exclusion (--exclude-dir only takes names, not paths)
# Paths-with-slash entries (e.g. test/fixtures) are handled via post-filter.
GREP_EXCLUDE_FLAGS=""
for dir in $EXCLUDE_LIST; do
  # Skip entries with slashes — grep --exclude-dir doesn't support paths
  if [[ "$dir" != */* ]]; then
    GREP_EXCLUDE_FLAGS="$GREP_EXCLUDE_FLAGS --exclude-dir=$dir"
  fi
done
```

**Usage in every phase:**

```bash
# Correct (v17+) — uses centralized flags
find . -type f $EXCLUDE_FLAGS -name "*.java"
grep -rl "pattern" . $GREP_EXCLUDE_FLAGS --include="*.js"

# WRONG (pre-v17) — phase-local exclusions
find . -type f -not -path "./node_modules/*" -name "*.java"
grep -rl "pattern" . --exclude-dir=node_modules --exclude-dir=.git
```

**Why centralized:** before v17, every phase had its own exclusion list. Phase 2 excluded 3 dirs, Phase 8.5 excluded 4, Phase 3 had none explicit. Led to inconsistent scan behavior — `.venv/` was scanned by Phase 3 but skipped by catalog_rest_endpoints (Phase 5). Now one list, all phases.

### Step: load_component_naming (0.2)

```bash
COMPONENT_PREFIX=$(yaml_get component_naming.prefix)
# Returns the configured prefix (e.g. 'sp-') or null (analyzer must infer)

CUSTOM_SUFFIX_MAP=$(yaml_get component_naming.custom_suffix_map)
# User-defined suffix additions (e.g. "violation-indicator" → violation-badge)
```

If `COMPONENT_PREFIX` is null, Phase 3 will auto-detect from shared folder filenames and propose a value at the pre-write gate for user confirmation.

### Step: validate_exclusions (0.3)

Preflight check — warn on typos:

```
FOR each path in scan_exclusions.custom:
  IF path contains obvious typo pattern (e.g. "node_module" instead of "node_modules"):
    WARN: "scan_exclusions.custom has '{path}' — did you mean '{correction}'?"

FOR each path in scan_exclusions.test_fixtures:
  IF path starts with '/' (absolute):
    WARN: "test_fixtures paths should be relative to project root. '{path}' may not match."
```

Non-blocking — proceeds with the list as declared.

---

## Phase: discover_tech_stack (Phase 1)

Scan the ENTIRE project for technology indicators across all layers. Don't just look at code — check config files, dependency manifests, Docker files, CI pipelines, and infrastructure configs.

### 1a: Dependency manifests (the most reliable source)

```bash
# Java dependencies
cat pom.xml 2>/dev/null          # Maven → extract groupId:artifactId:version
cat build.gradle 2>/dev/null     # Gradle → extract dependencies
ls lib/*.jar 2>/dev/null         # Direct JARs
cat build.xml 2>/dev/null        # Ant → check classpath entries

# JavaScript/TypeScript dependencies
cat package.json 2>/dev/null     # npm → dependencies + devDependencies
cat package-lock.json 2>/dev/null | head -50  # locked versions
cat config.js 2>/dev/null        # JSPM config

# Python dependencies
cat requirements.txt 2>/dev/null
cat pyproject.toml 2>/dev/null
cat Pipfile 2>/dev/null
```

### 1b: Database & persistence

```bash
# Config files with DB connection info
# $GREP_EXCLUDE_FLAGS was built in Step 0.1 — applied to every grep -r below
grep -rl $GREP_EXCLUDE_FLAGS "jdbc:" --include="*.xml" --include="*.properties" --include="*.yaml" .
grep -rl $GREP_EXCLUDE_FLAGS "datasource" --include="*.xml" --include="*.properties" --include="*.yaml" .
grep -rl $GREP_EXCLUDE_FLAGS "hibernate" --include="*.xml" --include="*.properties" --include="*.cfg.xml" .

# Detect DB type from connection strings / drivers
grep -rh $GREP_EXCLUDE_FLAGS "jdbc:oracle\|oracle.jdbc" . 2>/dev/null | head -1 && echo "Oracle DB"
grep -rh $GREP_EXCLUDE_FLAGS "jdbc:mysql\|mysql-connector" . 2>/dev/null | head -1 && echo "MySQL"
grep -rh $GREP_EXCLUDE_FLAGS "jdbc:postgresql\|postgresql" . 2>/dev/null | head -1 && echo "PostgreSQL"
grep -rh $GREP_EXCLUDE_FLAGS "jdbc:sqlserver\|mssql" . 2>/dev/null | head -1 && echo "SQL Server"
grep -rh $GREP_EXCLUDE_FLAGS "mongodb\|MongoClient" . 2>/dev/null | head -1 && echo "MongoDB"
grep -rh $GREP_EXCLUDE_FLAGS "qdrant\|QdrantClient" . 2>/dev/null | head -1 && echo "Qdrant (vector DB)"
grep -rh $GREP_EXCLUDE_FLAGS "redis\|RedisTemplate\|jedis" . 2>/dev/null | head -1 && echo "Redis"
grep -rh $GREP_EXCLUDE_FLAGS "elasticsearch\|ElasticSearch" . 2>/dev/null | head -1 && echo "Elasticsearch"

# ORM / persistence framework
grep -rl $GREP_EXCLUDE_FLAGS "hibernate.cfg\|@Entity\|SessionFactory" --include="*.java" --include="*.xml" . | head -1 && echo "Hibernate ORM"
grep -rl $GREP_EXCLUDE_FLAGS "SQLAlchemy\|Base.metadata" --include="*.py" . | head -1 && echo "SQLAlchemy"
grep -rl $GREP_EXCLUDE_FLAGS "prisma\|PrismaClient" --include="*.ts" --include="*.js" . | head -1 && echo "Prisma ORM"
grep -rl $GREP_EXCLUDE_FLAGS "sequelize\|Sequelize" --include="*.js" . | head -1 && echo "Sequelize"

# Migration files
ls -d **/migrations/ db/migrate/ alembic/ flyway/ liquibase/ 2>/dev/null
```

### 1c: Frontend frameworks

```bash
grep -rl $GREP_EXCLUDE_FLAGS "angular.module" --include="*.js" | head -1 && echo "AngularJS"
grep -rl $GREP_EXCLUDE_FLAGS "@NgModule\|@Component" --include="*.ts" | head -1 && echo "Angular (modern)"
grep -rl $GREP_EXCLUDE_FLAGS "React\|useState\|jsx" --include="*.js" --include="*.jsx" --include="*.tsx" | head -1 && echo "React"
grep -rl $GREP_EXCLUDE_FLAGS "createApp\|defineComponent" --include="*.vue" --include="*.js" | head -1 && echo "Vue.js"
grep -rl $GREP_EXCLUDE_FLAGS "Ext.define\|Ext.create" --include="*.js" | head -1 && echo "ExtJS"
grep -rl $GREP_EXCLUDE_FLAGS "next/\|getServerSideProps\|getStaticProps" --include="*.js" --include="*.tsx" | head -1 && echo "Next.js"
ls tailwind.config.* 2>/dev/null && echo "Tailwind CSS"
```

### 1d: Backend frameworks

```bash
grep -rl $GREP_EXCLUDE_FLAGS "@RestController\|@RequestMapping\|SpringBoot" --include="*.java" | head -1 && echo "Spring Boot"
grep -rl $GREP_EXCLUDE_FLAGS "Flask\|flask" --include="*.py" | head -1 && echo "Flask"
grep -rl $GREP_EXCLUDE_FLAGS "FastAPI\|fastapi" --include="*.py" | head -1 && echo "FastAPI"
grep -rl $GREP_EXCLUDE_FLAGS "express\|Express" --include="*.js" | head -1 && echo "Express.js"
```

### 1e: Infrastructure & DevOps

```bash
# Containerization
ls Dockerfile docker-compose.yml docker-compose.yaml 2>/dev/null && echo "Docker"
ls k8s/ kubernetes/ helm/ 2>/dev/null && echo "Kubernetes"

# CI/CD
ls .github/workflows/*.yml 2>/dev/null && echo "GitHub Actions"
ls Jenkinsfile 2>/dev/null && echo "Jenkins"
ls .gitlab-ci.yml 2>/dev/null && echo "GitLab CI"
ls .circleci/ 2>/dev/null && echo "CircleCI"
ls bitbucket-pipelines.yml 2>/dev/null && echo "Bitbucket Pipelines"

# Cloud
grep -rl $GREP_EXCLUDE_FLAGS "aws\|amazonaws\|s3\|ec2\|lambda" --include="*.yaml" --include="*.json" --include="*.tf" . 2>/dev/null | head -1 && echo "AWS"
grep -rl $GREP_EXCLUDE_FLAGS "azure\|microsoft.com" --include="*.yaml" --include="*.json" . 2>/dev/null | head -1 && echo "Azure"
grep -rl $GREP_EXCLUDE_FLAGS "gcloud\|googleapis" --include="*.yaml" --include="*.json" . 2>/dev/null | head -1 && echo "GCP"
ls *.tf terraform/ 2>/dev/null && echo "Terraform"
```

### 1f: Messaging, caching, search, AI/ML

```bash
# Messaging / queues
grep -rl $GREP_EXCLUDE_FLAGS "kafka\|KafkaTemplate" . 2>/dev/null | head -1 && echo "Kafka"
grep -rl $GREP_EXCLUDE_FLAGS "rabbitmq\|amqp" . 2>/dev/null | head -1 && echo "RabbitMQ"
grep -rl $GREP_EXCLUDE_FLAGS "celery\|Celery" --include="*.py" . 2>/dev/null | head -1 && echo "Celery"
grep -rl $GREP_EXCLUDE_FLAGS "SQS\|sqs" . 2>/dev/null | head -1 && echo "AWS SQS"

# Caching
grep -rl $GREP_EXCLUDE_FLAGS "redis\|Redis\|@Cacheable" . 2>/dev/null | head -1 && echo "Redis cache"
grep -rl $GREP_EXCLUDE_FLAGS "memcached\|Memcached" . 2>/dev/null | head -1 && echo "Memcached"
grep -rl $GREP_EXCLUDE_FLAGS "ehcache\|EhCache" . 2>/dev/null | head -1 && echo "EhCache"

# Search
grep -rl $GREP_EXCLUDE_FLAGS "elasticsearch\|opensearch" . 2>/dev/null | head -1 && echo "Elasticsearch/OpenSearch"
grep -rl $GREP_EXCLUDE_FLAGS "solr\|Solr" . 2>/dev/null | head -1 && echo "Apache Solr"

# AI/ML
grep -rl $GREP_EXCLUDE_FLAGS "openai\|langchain\|ollama\|groq" --include="*.py" --include="*.js" --include="*.ts" . 2>/dev/null | head -1 && echo "LLM integration"
grep -rl $GREP_EXCLUDE_FLAGS "qdrant\|pinecone\|weaviate\|chromadb" . 2>/dev/null | head -1 && echo "Vector DB"
grep -rl $GREP_EXCLUDE_FLAGS "whisper\|speech_recognition" --include="*.py" . 2>/dev/null | head -1 && echo "Speech-to-text"
```

### 1g: Testing & quality

```bash
# Test frameworks
grep -rl $GREP_EXCLUDE_FLAGS "JUnit\|@Test\|junit" --include="*.java" | head -1 && echo "JUnit"
grep -rl $GREP_EXCLUDE_FLAGS "describe\|it(\|jasmine" --include="*.js" --include="*.spec.js" | head -1 && echo "Jasmine"
grep -rl $GREP_EXCLUDE_FLAGS "jest\|describe\|test(" --include="*.test.js" --include="*.test.ts" | head -1 && echo "Jest"
grep -rl $GREP_EXCLUDE_FLAGS "pytest\|def test_" --include="*.py" | head -1 && echo "pytest"
grep -rl $GREP_EXCLUDE_FLAGS "cypress\|Cypress" . 2>/dev/null | head -1 && echo "Cypress (E2E)"
grep -rl $GREP_EXCLUDE_FLAGS "selenium\|webdriver" . 2>/dev/null | head -1 && echo "Selenium"

# Code quality
ls .eslintrc* .prettierrc* .stylelintrc* 2>/dev/null && echo "Linters configured"
ls sonar-project.properties 2>/dev/null && echo "SonarQube"
```

### 1h: Build system

```bash
ls build.xml 2>/dev/null && echo "Ant" && grep -c 'target name' build.xml
ls pom.xml 2>/dev/null && echo "Maven"
ls build.gradle 2>/dev/null && echo "Gradle"
ls Makefile 2>/dev/null && echo "Make"
cat package.json 2>/dev/null | grep -A50 '"scripts"'  # npm scripts
ls webpack.config.* rollup.config.* vite.config.* 2>/dev/null  # JS bundlers
ls angular.json 2>/dev/null && echo "Angular CLI"
```

### Output — discover_tech_stack (discover_tech_stack (Phase 1))

*Example output below is illustrative only. Your output will reflect YOUR project's detected stack — could be Spring/React/PostgreSQL, Flask/Vue/MongoDB, Java/AngularJS/Hibernate, or anything else. The table structure is the same; the rows reflect what was detected.*

```markdown
## 1. Tech Stack

### Languages & Frameworks
| Layer | Technology | Version | Location | Config file |
|-------|-----------|---------|----------|-------------|
| Frontend (legacy) | AngularJS | 1.8.x | {frontend_path}/ | config.js |
| Frontend (modern) | Angular | 18.x | {frontend_path_modern}/ | angular.json |
| Frontend (admin) | ExtJS | 6.x | {frontend_path_admin}/ | — |
| Templates | XHTML/JSF | 2.3 | web/ui/page/ | — |
| Backend | Java | 11 | {backend_path}/ | build.xml |
| Framework | {framework name} | {version} | — | {config file} |

### Database & Persistence
| Technology | Purpose | Config location | Connection |
|-----------|---------|-----------------|------------|
| Oracle 19c | Primary database | app.properties | jdbc:oracle:thin:@... |
| Hibernate 5.x | ORM | hibernate.cfg.xml | SessionFactory |
| EhCache | Query cache | ehcache.xml | In-memory |

### Infrastructure
| Technology | Purpose | Config location |
|-----------|---------|-----------------|
| Docker | Containerization | Dockerfile, docker-compose.yml |
| Jenkins | CI/CD | Jenkinsfile |
| AWS S3 | File storage | aws-config.properties |

### Build System
| Tool | Command | Purpose |
|------|---------|---------|
| Ant | ant core | Java compile |
| Ant | ant build | Full build (Java + JS) |
| Ant | ant clean build | Clean rebuild |
| JSPM/Rollup | npm run build:js | AngularJS bundle |
| Angular CLI | ng build | Angular 18 build |

### Testing
| Framework | Language | Location | Command |
|-----------|---------|----------|---------|
| JUnit 4 | Java | {test_path}/ | ant jtest |
| Jasmine | JavaScript | test/js/ | ant jstests |
| — | TypeScript | test/ts/ | ng test |

### Messaging / Integration
| Technology | Purpose | Config |
|-----------|---------|--------|
| {if found} | {purpose} | {config location} |
```
| Build (JS) | JSPM/Rollup | — | config.js |
| Build (TS) | Angular CLI | — | angular.json |
| Database | Hibernate | 5.x | {backend_path}/persistence/ |
| Messaging | Properties | — | {messages_path}/ |
| Testing | JUnit + Jasmine | — | test/ |
```

---

## Phase: map_folder_structure (Phase 2)

Map every major folder with its PURPOSE and FRAMEWORK. Goes deeper than before — enterprise codebases have nested feature folders (e.g. `{frontend_path}/identity/cert/approval/handlers/`) that depth-3 scans missed.

```bash
# v17: depth 6 + centralized exclusions (Phase 0 EXCLUDE_FLAGS)
find . -maxdepth 6 -type d $EXCLUDE_FLAGS | sort
```

**Handling deep trees:**
- Group output by framework like today (each framework gets a table)
- Mark "passthrough" folders (directories with only subdirectories, no code files) so the tree stays readable
- At depth 6, tables can reach 200+ rows. Collapse by default in project-map.md with the detail kept inline for Orchestrator to grep

**Passthrough detection:**

```bash
# A folder is a passthrough if it has subfolders but ZERO code files matching
# any layer_map path_glob extension.
for dir in $(find . -maxdepth 6 -type d $EXCLUDE_FLAGS); do
  code_file_count=$(find "$dir" -maxdepth 1 -type f \( -name "*.java" -o -name "*.ts" -o -name "*.js" -o -name "*.py" \) | wc -l)
  subdir_count=$(find "$dir" -maxdepth 1 -type d | tail -n +2 | wc -l)
  if [ "$code_file_count" -eq 0 ] && [ "$subdir_count" -gt 0 ]; then
    # Mark as passthrough
    echo "$dir — passthrough"
  fi
done
```

**Output — grouped by purpose, with path:**

*Example output below is illustrative (e.g. a Java/AngularJS/ExtJS stack). Your project's output will group folders by YOUR detected frameworks — a Next.js + Flask project would have "Frontend — Next.js", "Backend — Flask" sections instead. The table format is the same; the rows reflect what was detected.*

```markdown
## 2. Folder Structure

### Frontend — AngularJS (legacy)
| Folder | Purpose | Key files |
|--------|---------|-----------|
| {frontend_path}/common/directive/ | **SHARED UI COMPONENTS** — reusable directives | sp-button, sp-grid, sp-dropdown... |
| {frontend_path}/common/service/ | **SHARED SERVICES** — http, auth, notification | httpService, permissionService... |
| {frontend_path}/common/filter/ | **SHARED FILTERS** — formatting, sorting | dateFilter, currencyFilter... |
| {frontend_path}/identity/ | Identity management pages | certListCtrl, identityDetailCtrl... |
| {frontend_path}/roleManagement/ | Role management pages | roleListCtrl, roleBulkCtrl... |
| {frontend_path}/admin/ | Admin pages (⚠ owned by Admin team) | adminConfig, systemSetup... |

### Frontend — Angular 18 (modern)
| Folder | Purpose | Key files |
|--------|---------|-----------|
| {frontend_path_modern}/shared/ | **SHARED COMPONENTS** — modern shared | ButtonComponent, ModalComponent... |
| {frontend_path_modern}/applicationDefinition/ | App definition module (reference impl) | Complete NgModule example |
| {frontend_path_modern}/userManagement/ | User management (migrating from AngularJS) | ... |

### Frontend — ExtJS (admin)
| Folder | Purpose | Key files |
|--------|---------|-----------|
| {frontend_path_admin}/common/ | **SHARED BASE CLASSES** | BaseGrid, BasePanel... |
| {frontend_path_admin}/admin/ | Admin ExtJS panels | ... |

### Templates
| Folder | Purpose | Key files |
|--------|---------|-----------|
| web/ui/page/ | **XHTML PAGE TEMPLATES** | *.xhtml pages |
| web/ui/page/include/ | **PARTIAL VIEWS** — reusable page fragments | header, footer, nav... |
| web/ui/page/dashboard/ | Dashboard page templates | ... |

### Backend
| Folder | Purpose | Key files |
|--------|---------|-----------|
| {backend_path}/web/rest/ | **REST ENDPOINTS** | *Resource.java |
| {backend_path}/service/ | **SHARED BACKEND SERVICES** | AuditService, AuthService... |
| {backend_path}/tools/ | **UTILITIES** | Util classes |
| {backend_path}/task/ | Scheduled tasks | *Executor.java |
| {backend_path}/workflow/ | Workflow handlers | ... |
| {backend_path}/persistence/ | Database/Hibernate | DAOs, queries |

### Configuration
| Folder | Purpose | Key files |
|--------|---------|-----------|
| {messages_path}/ | **i18n MESSAGE BUNDLES** | {MessagesFile}.properties |
| config/ | System configuration | init.xml, UIConfig.xml |
| config/workflow/ | Workflow definitions | ⚠ owned by Workflow team |

### Tests
| Folder | Purpose | Key files |
|--------|---------|-----------|
| {test_path}/ | Java unit tests | *Test.java |
| test/js/ | JS unit tests (Jasmine) | *Spec.js |
| test/ts/ | TS unit tests | *.spec.ts |
```

---

## Phase: catalog_shared_components (Phase 3 — Evidence-Based Alias Extraction)

**Before scanning, load the taxonomy dictionary:**

```bash
# This dictionary defines ~80 standard aliases and their signal requirements
read: agent-pipeline/skills/alias-taxonomy.md
```

The taxonomy is the source of truth for what each alias means. Without it, the analyzer would guess based on filename and get it wrong. With it, each alias is only emitted when the component's actual evidence matches the taxonomy's requirements.

The hard part isn't finding the files — it's accurately classifying what each component actually DOES. A file called `spPicker.js` could be a date picker, user picker, file picker, or color picker. Filename alone is unreliable. We use FOUR signals combined.

### Signal 1: Filename + class/directive name (weak signal)

```bash
# Start with the filename but treat it as a hint, not truth
FILE={frontend_path}/common/directive/spReviewerSelector.js
NAME=spReviewerSelector     # strip prefix/extension

# Extract declared name from the file
# AngularJS: .directive('spReviewerSelector', ...)
# Angular:   @Component({ selector: 'sp-reviewer-selector' })
# React:     export default function ReviewerSelector
# Vue:       name: 'ReviewerSelector'
```

### Signal 1b: Naming convention extraction (STRONG — v17)

Most mature projects use a component-name convention: `sp-foo`, `MyCompBar`, or similar. The suffix encodes what primitive the component is (or wraps). Extracting this is far more reliable than filename alone — it tells you WHAT the component does even before reading props.

```bash
# From preload_config (Phase 0).2:
COMPONENT_PREFIX="sp-"                # from pipeline.yaml.component_naming.prefix
                                      # If null, Phase 3 auto-detects (see below)

# Parse a filename:
FILE={frontend_path}/common/directive/spReviewerSelector.js
BASE=$(basename "$FILE" | sed 's/\.[^.]*$//')      # spReviewerSelector
# Normalize camelCase/kebab-case to kebab:
KEBAB=$(echo "$BASE" | sed 's/\([A-Z]\)/-\L\1/g' | sed 's/^-//')   # sp-reviewer-selector

# Strip the prefix:
SUFFIX="${KEBAB#${COMPONENT_PREFIX}}"              # reviewer-selector
```

**Suffix → primitive table (kernel defaults — pack can extend via `component_naming.custom_suffix_map`):**

| Suffix tokens (last-word priority) | Primitive(s) emitted into `provides[]` |
|-----------------------------------|----------------------------------------|
| `select`, `dropdown`, `option-list` | `select`, `dropdown` |
| `multi-select`, `multiselect` | `select`, `multi-select` |
| `radio`, `radio-group` | `radio`, `radio-group` |
| `checkbox`, `checklist`, `checkbox-group` | `checkbox`, `checkbox-group` |
| `toggle`, `switch` | `toggle` |
| `date-picker`, `datepicker`, `date-range-picker` | `date-picker`, `date-range-picker` (if range) |
| `time-picker`, `timepicker` | `time-picker` |
| `modal`, `dialog`, `popup`, `overlay` | `modal`, `dialog` |
| `grid`, `table`, `datatable`, `data-grid` | `grid`, `table` |
| `button`, `btn`, `action-button` | `button` |
| `input`, `textfield`, `field`, `textbox` | `input` |
| `textarea` | `textarea` |
| `picker`, `selector`, `chooser` | `picker` (generic) |
| `autocomplete`, `typeahead`, `combobox` | `autocomplete` |
| `pagination`, `paginator`, `page-nav` | `pagination` |
| `tab`, `tabs`, `tab-nav` | `tabs` |
| `accordion`, `collapsible`, `expander` | `accordion` |
| `tooltip`, `popover` | `tooltip` |
| `toast`, `notification`, `snackbar`, `alert` | `notification` |
| `spinner`, `loader`, `progress` | `progress-indicator` |
| `avatar`, `profile-image`, `user-badge` | `avatar` |
| `breadcrumb`, `breadcrumbs`, `path-nav` | `breadcrumb` |
| `chart`, `graph`, `plot`, `visualization` | `chart` |
| `card`, `tile`, `panel` | `card` |
| `form`, `form-group`, `form-section` | `form` |
| `search`, `search-box`, `search-bar` | `search` |
| `filter`, `filter-bar`, `filter-panel` | `filter` |
| `uploader`, `file-picker`, `file-input` | `file-upload` |
| `badge`, `label`, `tag`, `chip` | `badge` |
| `list`, `listview`, `item-list` | `list` |
| `menu`, `context-menu`, `dropdown-menu` | `menu` |

**Compound suffix handling:**

```
SUFFIX: reviewer-selector
→ Last token "selector" matches generic `picker`
→ First token "reviewer" is domain-specific (not in primitive table)
→ Emit: provides: [picker, reviewer-picker]
        aliases: [reviewer-selector, reviewer-picker]
        domain: reviewer

SUFFIX: date-range-picker
→ Last tokens "range-picker" matches date-range-picker entry
→ Emit: provides: [date-picker, date-range-picker]

SUFFIX: application-multi-select
→ Contains "multi-select" → select family with multi flag
→ First token "application" is domain-specific
→ Emit: provides: [select, multi-select, application-select]
        domain: application
```

**Inference algorithm:**

```
1. Strip prefix → get suffix
2. Tokenize by '-'
3. For each N-gram (longest first: 3-token, 2-token, 1-token):
   Check suffix→primitive table
   If match: add primitive(s) to provides[]
4. Remaining tokens not matched → treated as domain markers
5. Produce final provides[] by combining matched primitives
6. Confidence:
   - Exact primitive match (no domain tokens) → HIGH
   - Primitive + domain (e.g. reviewer-selector) → HIGH (primitive is clear)
   - All tokens domain-specific (e.g. sp-foo-bar-baz) → LOW (fallback to Signal 2+3)
```

**Auto-detect prefix (when `component_naming.prefix` is null):**

```
SHARED_DIRS=$(yaml_get shared_paths.frontend.ui_elements[*].path)
# Get all component filenames in shared dirs
files=$(find $SHARED_DIRS -maxdepth 2 -type f -name "*.js" -o -name "*.ts" -o -name "*.tsx")

# Extract first 2-4 chars before first uppercase letter (common-prefix heuristic)
# spReviewerSelector → "sp"
# MyCompCard        → "MyComp"

prefixes=$(for f in $files; do
  basename "$f" | sed 's/\.[^.]*$//' | grep -oE '^[a-zA-Z]+' | head -c 4
done | sort | uniq -c | sort -rn)

# If > 80% of shared files share a prefix → propose it at pre-write gate
```

**Pre-write gate addition (when auto-detected):**

```
## Naming Convention Detected

Prefix: "sp-" (found in 42/45 shared-directory files = 93%)

Propose to add to pipeline.yaml:
  component_naming:
    prefix: "sp-"

> 👉 Pick one:
>   - Accept       — write prefix to config, use for Signal 1b
>   - Reject       — skip Signal 1b (components identified via 2-6 only)
>   - Custom       — enter a different prefix manually
```

User-confirmed prefix persists across rescans (in pipeline.yaml user section, never overwritten).

**Why Signal 1b is STRONG:**

Before v17, a directive named `spReviewerSelector.js` was detected by Signal 1 (weak — just filename) and Signal 2 (props read: `{users, multi, selected}`). If the developer hadn't added `multi: '='` to the scope, Signal 2 would miss the multi-select provides. Signal 1b reads the name itself — `ReviewerSelector` suffix `Selector` → picker family. Consistent signal regardless of whether the developer remembered to document props.

For the Orchestrator-side impact (when user ticket asks for "select dropdown"):

```
pipeline.yaml.shared_paths.frontend.ui_elements[0].provides = [
  button, select, multi-select, dropdown, radio, checkbox,
  date-picker, modal, grid, pagination, ...   # all discovered via Signal 1b
]

# Orchestrator Step 4a sees: ticket asks for "select"
# → grep shared_paths for provides containing "select"
# → matches ui_elements[0] ({frontend_path}/common/directive/)
# → Explorer then greps this path for sp-*-select* files
# → finds spReviewerSelector, spApplicationSelect, etc.
# → generates ♻️ USE instead of 🆕 CREATE
```

This is the core reuse-trigger path. Signal 1b makes it deterministic instead of dependent on prop-reading success.

### Signal 2: Props/Inputs/Bindings (STRONG signal — what the component accepts)

The component's public API is the most reliable indicator of what it IS.

```bash
# AngularJS directive — read scope bindings
grep -A 20 "scope:" $FILE
# Example output:
#   scope: {
#     users: '=',
#     multi: '=?',
#     onChange: '&'
#   }

# Angular component — read @Input decorators
grep -B 1 "@Input" $FILE
# Example:
#   @Input() users: User[];
#   @Input() multi = false;
#   @Output() selected = new EventEmitter();

# React — read props interface or propTypes
grep -A 5 "interface.*Props\|propTypes" $FILE

# Vue — read props object
grep -A 10 "props:" $FILE
```

**Infer aliases from the props structure:**
- Has `items` or `options` prop + `selected`/`model` → `select` family
- Has `items` + `multi` or `multiple` prop → `multi-select` + `select`
- Has `users`, `roles`, `reviewers` prop → domain-specific picker (`user-picker`, `role-picker`, `reviewer-picker`)
- Has `date` or `dateRange` prop → `date-picker` or `date-range-picker`
- Has `columns` + `data` or `rows` → `grid` or `table`
- Has `onSort`, `onReorder`, `handle` → `drag-and-drop` or `sortable`
- Has `show`/`visible` + `onClose` + `title` → `modal` or `dialog`
- Has `label` + `onClick` → `button`
- Has `items` + `onPageChange` → `pagination`

### Signal 3: Template content (STRONG signal — what the component RENDERS)

```bash
# AngularJS: read template or templateUrl
grep -oP 'template[^:]*:\s*[`'\''"]([^`'\''"]+)' $FILE

# For templateUrl, read the HTML file
TEMPLATE_URL=$(grep -oP "templateUrl:\s*['\"]([^'\"]+)" $FILE | sed -r "s/.*['\"]//")
cat $TEMPLATE_URL

# Angular: read the template: or templateUrl in @Component
# Look at what HTML elements and directives are used
```

**Infer aliases from template elements:**
- Contains `<select>` or `ui-select` → `dropdown`, `select`
- Contains `<input type="checkbox">` with ng-repeat → `multi-select`, `checkbox-group`
- Contains `<input type="radio">` → `radio-group`
- Contains `<table>` with thead/tbody → `table`, `grid`
- Contains `<ul>` with draggable attributes → `drag-and-drop`, `sortable-list`
- Contains modal overlay/backdrop → `modal`, `dialog`
- Contains calendar icon/date grid → `date-picker`

### Signal 4: Real consumer usage (STRONGEST signal — how it's actually used)

The most reliable way to learn what a component IS is to see **how existing pages use it.**

```bash
# Find 3-5 places that use this component
CONSUMERS=$(grep -rln $GREP_EXCLUDE_FLAGS "reviewer-selector\|spReviewerSelector" {frontend_path}/ \
              --include="*.js" --include="*.html" --include="*.xhtml" | head -5)

# For each consumer, read 5 lines around the usage
for C in $CONSUMERS; do
  grep -n "reviewer-selector" $C | while read LINE; do
    LINE_NUM=$(echo $LINE | cut -d: -f1)
    sed -n "$((LINE_NUM - 2)),$((LINE_NUM + 3))p" $C
  done
done

# Example output from consumer:
#   <sp-reviewer-selector
#       users="vm.eligibleReviewers"
#       multi="vm.certType === 'group'"
#       selected="vm.chosenReviewers"
#       on-change="vm.applyReviewerSelection(ids)">
#   </sp-reviewer-selector>
```

**Consumer usage reveals:**
- The actual domain (`reviewer`, not just `user`)
- The configuration patterns (`multi` is a boolean that gets toggled)
- Related concepts users associate with it (cert type drives multi mode)

### Alias Inference Procedure (combines all 4 signals)

For each component file:

```
1. Gather raw signals:
   signals = {
     filename_tokens:    tokenize(filename) → [reviewer, selector]
     declared_name:      from directive/component/class declaration
     prop_names:         [users, multi, selected, onChange]
     prop_types:         {users: array, multi: boolean, selected: array}
     template_elements:  [ui-select, checkbox, <li ng-repeat>]
     template_bindings:  [ng-model, multiple]
     consumer_patterns:  [multi toggled by cert type, bound to user list]
   }

2. Match signals against the alias taxonomy (taxonomy is a fixed dictionary
   that maps patterns to standard aliases):

   ALIAS_TAXONOMY = {
     button:           requires [label/text prop] + [onClick/click handler]
     input:            requires [model/value prop] + [text input element]
     select:           requires [items/options prop] + [selection]
     multi-select:     requires select alias + [multi/multiple prop]
     dropdown:         same as select (synonym)
     radio:            requires [options prop] + [radio input]
     checkbox:         requires [model] + [checkbox input]
     user-picker:      requires select alias + [users prop OR domain=user]
     role-picker:      requires select alias + [roles prop OR domain=role]
     reviewer-picker:  requires select alias + [reviewers prop OR domain=reviewer]
     date-picker:      requires [date/dateRange prop] + [calendar ui]
     date-range:       requires date-picker + [from/to OR range]
     grid:             requires [columns + data/rows props] + [table element]
     table:            synonym for grid
     pagination:       requires [total/page props] + [page navigation]
     modal:            requires [show/visible + onClose] + [overlay]
     dialog:           synonym for modal
     toast:            requires [message + type] + [auto-dismiss]
     drag-and-drop:    requires [onSort/onReorder OR drag handlers]
     sortable:         synonym for drag-and-drop
     tabs:             requires [tabs/active props] + [tab navigation]
     tree:             requires [nodes/children] + [expand/collapse]
     ...
   }

3. For each alias in taxonomy, check if ALL its requirements match signals:
   matched_aliases = []
   for alias, reqs in ALIAS_TAXONOMY:
     if all(req matches in signals) → matched_aliases.append(alias)

4. sp-reviewer-selector example:
   Matches: select (has items+selection), multi-select (has multi prop),
            user-picker (has users prop), reviewer-picker (domain=reviewer)
   → provides: [select, multi-select, user-picker, reviewer-picker]

5. Add domain-specific synonyms:
   If filename contains "reviewer" → add "reviewer-selector" as alias
   If consumers use it for "approver" selection → add "approver-picker" alias
```

### Expand Coverage with a Standard Taxonomy Dictionary

The pipeline ships a reference dictionary of ~80 common UI aliases at `agent-pipeline/skills/alias-taxonomy.md`. The analyzer loads this dictionary and matches each component against it. The dictionary includes standard aliases for:

**Form inputs** — button, icon-button, input, textarea, select, multi-select, dropdown, searchable-select, autocomplete, combobox, radio, radio-group, checkbox, checkbox-group, toggle, switch, slider, file-upload

**Specialized pickers** — date-picker, date-range, time-picker, datetime-picker, color-picker, icon-picker, user-picker, role-picker, reviewer-picker, group-picker, entity-picker

**Data display** — table, grid, data-grid, list, virtual-list, tree, tree-grid, card, timeline, calendar, chart

**Layout & navigation** — tabs, accordion, breadcrumb, pagination, stepper, wizard, drawer, sidebar, panel, card, fieldset

**Feedback** — toast, snackbar, alert, banner, notification, loading, spinner, progress, skeleton, empty-state, error-state

**Overlay** — modal, dialog, confirm-dialog, tooltip, popover, drawer, bottom-sheet

**Drag & drop** — drag-and-drop, sortable, sortable-list, sortable-grid, resizable, droppable

**When taxonomy doesn't match:** Fall back to domain-specific name from filename (e.g., `certification-dashboard` if no standard alias matches).

### Output per component

Each component entry in project-map.md gets:

```markdown
### Dropdowns & Select
| Name | Path | Aliases | Props | Consumers | Confidence |
|------|------|---------|-------|-----------|------------|
| sp-reviewer-selector | .../spReviewerSelector.js | select, multi-select, user-picker, reviewer-picker | users, multi, selected, onChange | 7 pages (certList, accessReviewList, ...) | HIGH (4 signals matched) |
| sp-dropdown | .../spDropdown.js | select, dropdown | items, model, multi, searchable | 18 pages | HIGH |
```

And in pipeline.yaml:

```yaml
shared_paths:
  frontend:
    ui_elements:
      - path: "{frontend_path}/common/directive/"
        language: javascript
        framework: AngularJS
        provides: [
          # aggregated aliases from ALL components in this directory
          button, icon-button, input, textarea, select, multi-select, dropdown,
          searchable-select, radio, radio-group, checkbox, checkbox-group, toggle,
          date-picker, date-range, user-picker, reviewer-picker, role-picker,
          grid, table, list, tabs, pagination, breadcrumb, accordion,
          modal, dialog, confirm-dialog, tooltip, popover, toast, loading,
          empty-state, drag-and-drop, sortable-list, ...
        ]
        usage: "directive-in-template"
```

### Confidence Marking

Two dimensions are tracked separately:

**Alias confidence** (what this component IS) — driven by Signals 1–4:
- **HIGH** — 3-4 signals matched (filename + props + template + consumers agree)
- **MEDIUM** — 2 signals matched (strong but incomplete evidence)
- **LOW** — 1 signal matched (only filename OR only props — likely wrong)

**Shared classification** (whether to catalog as shared) — driven by folder heuristics + Signals 5–6:
- **TRUE_SHARED** — lives in shared folder (high confidence)
- **AUTO_PROMOTED (HIGH)** — Signal 5 sole-wrapper pattern
- **AUTO_PROMOTED (MEDIUM)** — Signal 6 hint OR Signal 5 secondary-wrapper pattern
- **CROSS_FEATURE** — 3+ feature folders consume it (promotion candidate, still feature-local until moved)
- **FEATURE_LOCAL** — 1-2 consumers, no shared-intent signal

LOW alias confidence entries are flagged at the gate for user review before writing. AUTO_PROMOTED entries are emitted to shared_paths automatically but listed in § 3b so the user sees what was auto-catalogued.

### Handle False Positives & Gaps

**False positive:** Analyzer thinks `spColorHelper.js` is a picker because of the filename, but it's actually a utility. Signal 2 (no props) and Signal 3 (no UI template) override Signal 1.

**Rule:** Require at least 2 signals to match before emitting an alias. Never emit based on filename alone.

**Coverage gap:** A component does something novel that has no matching alias in the taxonomy dictionary. The analyzer writes a domain-specific alias (`certification-dashboard-widget`) and flags it for the user to optionally add a standard alias.

---

### Signal 5: Third-party library wrapper detection (STRONG — catches "shareable-by-intent" components early)

A **wrapper** is a component that delegates to a third-party UI library (ngx-datatable, react-table, ag-grid, mat-table, chart.js, flatpickr, cdk-dialog, etc.). Wrappers are **architecturally shared** — they encapsulate library complexity so the rest of the codebase doesn't need to know the library exists. They SHOULD be cataloged even with only 1 consumer on day one, because the next grid/chart/picker need will call this wrapper, not re-wrap the library.

**Why this signal matters:** Signals 1–4 all depend on existing consumer usage. A brand-new wrapper with 1 consumer fails Signal 4 (consumer count=1) and may sit in a feature folder that fails the "shared directory" heuristic. Signal 5 catches it by detecting the wrapping pattern itself.

**Detection procedure:**

```bash
# 1. Load the library wrapper registry (known UI libs that are commonly wrapped)
WRAPPER_LIBS = {
  # Tables / grids
  "@swimlane/ngx-datatable":   ["grid", "table", "data-table"],
  "@tanstack/react-table":     ["grid", "table", "data-table"],
  "ag-grid":                   ["grid", "table", "data-table"],
  "@angular/material/table":   ["grid", "table", "data-table"],
  "primeng/table":             ["grid", "table", "data-table"],
  "react-data-grid":           ["grid", "table", "data-table"],

  # Charts
  "chart.js":                  ["chart"],
  "plotly.js":                 ["chart"],
  "recharts":                  ["chart"],
  "@swimlane/ngx-charts":      ["chart"],
  "d3":                        ["chart", "visualization"],

  # Date pickers
  "flatpickr":                 ["date-picker", "date-range-picker"],
  "air-datepicker":            ["date-picker", "date-range-picker"],
  "react-datepicker":          ["date-picker"],
  "@angular/material/datepicker": ["date-picker"],

  # Dialogs / modals
  "sweetalert2":               ["modal", "dialog"],
  "@angular/material/dialog":  ["modal", "dialog"],
  "@angular/cdk/dialog":       ["modal", "dialog"],
  "react-modal":               ["modal", "dialog"],

  # Rich text
  "tinymce":                   ["rich-text-editor"],
  "quill":                     ["rich-text-editor"],
  "@ckeditor/ckeditor5":       ["rich-text-editor"],

  # Selects
  "ng-select":                 ["select", "dropdown", "multi-select"],
  "react-select":              ["select", "dropdown", "multi-select"],

  # File upload
  "ngx-file-drop":             ["file-upload", "drag-and-drop"],
  "react-dropzone":            ["file-upload", "drag-and-drop"],

  # Notifications
  "ngx-toastr":                ["toast", "notification"],
  "react-toastify":            ["toast", "notification"],
}

# 2. For each component file, check imports against the registry
for FILE in $(all_component_files); do
  IMPORTS=$(extract_imports "$FILE")  # grep import / require / from

  for lib in $IMPORTS; do
    if lib ∈ WRAPPER_LIBS.keys:
      # This component wraps a known library
      WRAPPER_DETECTED[FILE] = WRAPPER_LIBS[lib]

      # Check: is this the ONLY wrapper of this lib in the codebase?
      other_wrappers = grep_all_files_importing(lib, exclude=FILE)
      if count(other_wrappers) == 0:
        # De facto shared — the only gateway to this library
        SHARED_BY_WRAPPER[FILE] = WRAPPER_LIBS[lib]
        emit_signal(FILE, confidence="HIGH",
                    reason="sole wrapper of {lib} in codebase")
      elif count(other_wrappers) <= 2:
        # Still likely shared, but multiple wrappers exist — flag for review
        SHARED_BY_WRAPPER[FILE] = WRAPPER_LIBS[lib]
        emit_signal(FILE, confidence="MEDIUM",
                    reason="{N} wrappers of {lib} exist — consolidation candidate")
      # If many wrappers, treat each as feature-local (not shared)
  done
done
```

**Output: Phase 3 emits each wrapper to project-map.md § 3 as a SHARED component** even if Signal 4 consumer count is 1:

```markdown
#### grid-wrapper (wrapper of @swimlane/ngx-datatable)

| Aspect | Value |
|--------|-------|
| Path | frontend/app/users/user-list/components/grid-wrapper/grid-wrapper.component.ts |
| Status | **SHARED BY WRAPPER PATTERN** (Signal 5 HIGH) |
| Consumer count | 1 today |
| Wraps library | @swimlane/ngx-datatable |
| Inferred aliases | grid, table, data-table |
| Reason | Sole wrapper of ngx-datatable in codebase — architecturally sharable |
| Confidence | HIGH |
| Recommendation | File lives in feature folder but acts as shared. Consider moving to `frontend/app/shared/components/grid-wrapper/` for discoverability. |
```

Also added to `pipeline.yaml` shared_paths with `shared_by: wrapper-pattern` marker so Orchestrator reads it on every future story.

**Caveats:**
- If 3+ wrappers of the same lib exist, they're NOT auto-shared — that's usually accidental duplication, flagged as "consolidation candidate" in the promotion section (§ 3b).
- Signal 5 doesn't override Signals 1–4 when they disagree. If a wrapper has weird props that don't match "grid" taxonomy, the alias emit still requires Signal 2/3 match. Signal 5 only affects the SHARED/NOT-SHARED classification, not the alias semantics.

---

### Signal 6: Developer intent hints (MEDIUM — catches non-library shared components)

Not every shareable component wraps a library. Some are pure abstractions (a generic confirm dialog, a feature-flag gate, a permission-aware link). Developers can mark these as "intended shared" via conventions the analyzer will honor.

**Detection: four hint types, any of them triggers the signal.**

**Hint 1 — JSDoc / TSDoc annotations:**

```bash
# Read the first 30 lines of each component file, look for tags
grep -m 5 -E "@shared|@reusable|@provides" $FILE

# Examples the analyzer honors:
# /**
#  * @shared
#  */
#
# /**
#  * @shared
#  * @provides: [grid, table, data-table]
#  */
#
# // @shared
```

When `@provides` is given, use its list as the alias overrides. When only `@shared` is given, use Signals 2/3 to infer aliases as normal but mark the component as shared.

**Hint 2 — Filename conventions:**

```bash
# Filenames that the analyzer treats as explicit shared-intent:
#   *-wrapper.*    → wrapping pattern, treat as shared
#   *-base.*       → base component meant for extension
#   *-shared.*     → explicit shared marker
#   *-common.*     → explicit common marker
#   *.base.*       → same as *-base
#
# Examples:
#   grid-wrapper.component.ts     → SHARED
#   button.base.tsx               → SHARED
#   data-table-shared.js          → SHARED

for FILE in $(all_component_files); do
  basename=$(basename "$FILE")
  if basename matches /\-(wrapper|base|shared|common)\./i OR \.(base)\./i:
    INTENT_SHARED[FILE] = true
    emit_signal(FILE, confidence="MEDIUM",
                reason="filename convention suggests shared")
  fi
done
```

**Hint 3 — Folder conventions inside feature folders:**

```bash
# A feature folder that contains a wrappers/ or shared/ or base/ subfolder
#   app/users/components/wrappers/grid-wrapper.tsx    → SHARED
#   app/users/components/base/base-form.tsx           → SHARED
#   app/users/components/shared/user-badge.tsx        → SHARED
#   app/users/components/user-list.tsx                → feature-local (no marker)

if parent_dir(FILE) matches /^(wrappers|shared|base|common)$/:
  INTENT_SHARED[FILE] = true
  emit_signal(FILE, confidence="MEDIUM",
              reason="inside feature's wrappers/shared/base folder")
```

**Hint 4 — Explicit `@provides` comment block:**

```javascript
/**
 * @shared
 * @provides: [grid, table, data-table]
 * @consumers-expected: any list view requiring pagination + sorting
 */
export class GridWrapperComponent { ... }
```

The `@provides` list is an authoritative alias override — bypasses Signals 2/3 inference. Use when the developer knows what the component provides better than the taxonomy can infer (e.g., a niche domain component).

**Precedence when signals conflict:**

```
1. Signal 6 @provides     → authoritative for aliases (overrides taxonomy)
2. Signal 5 (wrapper)     → authoritative for shared/not-shared
3. Signal 6 @shared       → authoritative for shared/not-shared (same as Signal 5)
4. Signals 1-4            → used for alias inference and confidence
```

---

## Phase: classify_promotions (Phase 3b)

Extension to Phase 3 that catalogs promotion candidates with stronger recommendations than before.

A promotion candidate is any feature-local component that:
- Is used by 3+ different feature folders (existing rule), OR
- Matches Signal 5 (wrapper pattern) — auto-promoted in project-map.md, OR
- Matches Signal 6 (developer intent hint) — auto-promoted

### Step: classify_status (3b.1)

```
STATUS categories:
  TRUE_SHARED       — already in a shared folder (no action needed)
  AUTO_PROMOTED     — Signal 5 or Signal 6 triggered auto-promotion
  CROSS_FEATURE     — feature-local but used by 3+ features (promotion candidate)
  CONSOLIDATION     — 3+ wrappers of the same library (needs unification)
  FEATURE_LOCAL     — used by 1-2 features, no shared-intent signals (stays local)
```

### Step: emit_recommendations (3b.2)

For each AUTO_PROMOTED / CROSS_FEATURE / CONSOLIDATION component, write a recommendation with specific action:

```markdown
## 3b. Promotion Recommendations

### Auto-promoted (added to shared_paths on this scan)

| Component | Current path | Trigger | Action for dev |
|-----------|--------------|---------|----------------|
| grid-wrapper | app/users/.../grid-wrapper | Signal 5 (wraps ngx-datatable) | Cataloged as shared. Move file to `app/shared/components/grid-wrapper/` for discoverability. |
| user-badge | app/users/components/shared/user-badge.tsx | Signal 6 (folder `shared/`) | Cataloged. Consider renaming file to follow convention. |
| base-form | app/forms/base/base-form.tsx | Signal 6 (folder `base/`) | Cataloged as base component. |

### Cross-feature candidates (used by 3+ features, still feature-local)

| Component | Current path | Used by | Recommend |
|-----------|--------------|---------|-----------|
| date-range-picker | app/reports/.../date-range.tsx | reports, dashboard, audit | Move to `shared/` folder. Until then, Orchestrator will still suggest REUSE but the file lives in reports/. |

### Consolidation candidates (multiple wrappers of the same library)

| Library | Wrappers found | Recommend |
|---------|---------------|-----------|
| chart.js | 3 wrappers (`users/chart.tsx`, `reports/chart.tsx`, `dashboard/chart.tsx`) | Unify into one wrapper at `app/shared/components/chart-wrapper/`. All three re-implement the same bindings. |
| flatpickr | 2 wrappers (`users/date.tsx`, `reports/date-range.tsx`) | Two variants detected (single-date + range). Consider a single wrapper with a `range` prop. |
```

### Step: write_to_shared_paths (3b.3)

Auto-promoted components get added to `shared_paths` with a marker so the analyzer knows to re-check on rescan:

```yaml
shared_paths:
  frontend:
    ui_elements:
      - path: "frontend/app/users/user-list/components/grid-wrapper/"
        language: typescript
        framework: Angular18
        provides: [grid, table, data-table]
        shared_by: wrapper-pattern      # ← marks it as auto-promoted
        wraps_library: "@swimlane/ngx-datatable"
        consumers: 1
        confidence: HIGH
        note: "Sole wrapper of ngx-datatable. Move to app/shared/components/ for discoverability."
```

**Rescan behavior:** on next rescan, if a `shared_by: wrapper-pattern` entry now has a true shared path (moved by developer), the marker is removed. If consumer count grows to 3+ naturally, the auto-promotion sticks even without file movement.

---

## Output — catalog_shared_components (Phase 3)

Each shared component is cataloged in project-map.md with name, path, aliases, props, consumers, and confidence. pipeline.yaml shared_paths is updated with the aggregated `provides[]` list for each path.

### Layout (Cards, Panels, Sections)
(same table format)

### Usage clusters per component (populated after Phase 10c runs)

For each component with 5+ consumers, show intent clustering:

```markdown
#### sp-button

| Aspect | Value |
|--------|-------|
| Path | {frontend_path}/common/directive/spButton.js |
| Consumer count | 47 files |
| **Usage clusters** | 5 distinct intents — **⚠️ OVERLOADED** |

| Intent | Count | Example consumers |
|--------|-------|------------------|
| Action trigger (Save, Submit, Apply) | 18 | certListCtrl.js:34, roleEditCtrl.js:89 |
| Destructive confirm (Delete, Remove) | 12 | identityListCtrl.js:156, roleListCtrl.js:122 |
| Navigation (Go, Back, Next) | 8 | stepWizardCtrl.js:45, dashboardCtrl.js:67 |
| Toggle (Expand/Collapse) | 5 | accordionDirective.js:23 |
| Modal trigger | 4 | certDetailCtrl.js:89 |

**Recommendation:** Component is overloaded across 5 intent classes. Consider specialized variants:
- `sp-confirm-button` — for destructive actions (currently 12 uses reinventing the pattern)
- `sp-toggle-button` — for expand/collapse (5 uses)
- `sp-nav-button` — for navigation steppers (8 uses)

New tasks using this component should pick the intent explicitly. Orchestrator will flag this during LLD generation.
```

Components with 1–2 intent classes are marked **SINGLE-PURPOSE (healthy)**. 3 intents → **DUAL-PURPOSE (noted)**. 4+ → **OVERLOADED (flagged)**.

### PROMOTION CANDIDATES (feature-local but used by 3+ features)
| Name | Current path | Used by | Recommend |
|------|-------------|---------|-----------|
| dateRangePicker | {frontend_path}/accessReview/... | 3 features | Move to common/directive/ |
```

---

## Phase: catalog_shared_services (Phase 4)

*Example tables below are illustrative. Your project's scan produces tables populated with YOUR project's services — could be AuthService / PaymentService / NotificationService for any stack. Column structure is the same.*

### Frontend Services
```markdown
## 4. Shared Frontend Services

| Service | Path | Key methods | Used by |
|---------|------|-------------|---------|
| httpService | {frontend_path}/common/service/httpService.js | get(), post(), put(), delete(), handleError() | all features |
| permissionService | {frontend_path}/common/service/permissionService.js | hasRight(right), isAdmin(), getCurrentUser() | 20 features |
| notificationService | {frontend_path}/common/service/notificationService.js | success(msg), error(msg), warn(msg) | all features |
| dateValidationService | {frontend_path}/common/service/dateValidationService.js | validate(date), format(date, fmt), parse(str) | 5 features |
| navigationService | {frontend_path}/common/service/navigationService.js | goTo(url), back(), breadcrumb() | all features |
```

### Backend Services
```markdown
## 5. Shared Backend Services

| Service | Path | Key methods | Used by |
|---------|------|-------------|---------|
| AuditService | {backend_path}/service/AuditService.java | log(event), logBulk(events) | all REST resources |
| AuthorizationService | {backend_path}/service/AuthorizationService.java | checkRight(right), requireAdmin() | all REST resources |
| FilterService | {backend_path}/service/FilterService.java | buildFilter(params), applySort(query) | list endpoints |
| PaginationService | {backend_path}/service/PaginationService.java | paginate(query, page, size) | list endpoints |
```

---

## Phase: catalog_rest_endpoints (Phase 5)

The approach depends on the backend framework detected in discover_tech_stack (Phase 1). Use the matching discovery pattern:

**Java + JAX-RS / Spring:**
```bash
# Find files with @Path or @RequestMapping — $EXCLUDE_FLAGS from Step 0.1
find . -type f $EXCLUDE_FLAGS -name "*.java" -exec grep -l "@Path\|@RequestMapping" {} \; | while read f; do
  CLASS=$(basename $f .java)
  PATHS=$(grep -oP '@(Path|RequestMapping)\("([^"]+)"\)' $f)
  METHODS=$(grep -oP '@(GET|POST|PUT|DELETE|PATCH|GetMapping|PostMapping|PutMapping|DeleteMapping)' $f | sort -u)
  echo "$CLASS | $PATHS | $METHODS"
done
```

**Python Flask:**
```bash
find . -type f $EXCLUDE_FLAGS -name "*.py" -exec grep -l "@app.route\|@blueprint.route\|Blueprint" {} \; | while read f; do
  grep -oP "@\w+\.route\(['\"]([^'\"]+)['\"].*methods=\[([^\]]+)\]" $f
done
```

**Python FastAPI:**
```bash
find . -type f $EXCLUDE_FLAGS -name "*.py" -exec grep -l "APIRouter\|@app.get\|@app.post" {} \; | while read f; do
  grep -oP "@(app|router)\.(get|post|put|delete|patch)\(['\"]([^'\"]+)['\"]" $f
done
```

**Node Express:**
```bash
find . -type f $EXCLUDE_FLAGS \( -name "*.js" -o -name "*.ts" \) | xargs grep -l "app.get\|app.post\|router.get" | while read f; do
  grep -oP "(app|router)\.(get|post|put|delete|patch)\(['\"]([^'\"]+)['\"]" $f
done
```

**Output:**

*Example output table below is illustrative. Your output reflects what was found in YOUR project.*

```markdown
## 6. REST Endpoints

### Quick reference table
| Resource class | Base path | Methods | Reusability | Purpose |
|---------------|-----------|---------|-------------|---------|
| CertificationResource | /rest/ui/certifications | GET, POST, PUT | HIGH (9/10) | Certification CRUD + list |
| IdentityResource | /rest/ui/identities | GET, POST | HIGH (8/10) | Identity management |
| RoleResource | /rest/ui/roles | GET, POST, PUT, DELETE | MEDIUM (6/10) | Role CRUD |
| AccessReviewResource | /rest/ui/accessReviews | GET, POST | MEDIUM (5/10) | Access review management |
| BulkActionResource | /rest/ui/bulk-actions | POST | HIGH (10/10) | Generic bulk operations |

### Per-endpoint detail

Each endpoint below has:
- **Contract:** request body / response / query params (from extract_data_contracts (Phase 9))
- **Reusability:** score + hint (from score_endpoint_reusability (Phase 11))
- **Consumers:** frontend files that call it (from build_consumer_graph (Phase 10))
- **Stack trace:** full path FE → BE → service → DAO → table (from build_consumer_graph (Phase 10))

---

#### /rest/ui/certifications

| Aspect | Value |
|--------|-------|
| Resource class | `{backend_path}/web/rest/CertificationResource.java` |
| Base class | `BaseResource` |
| Auth | `@SPRight("CertifyAccess")` |
| Methods | GET, POST, PUT |
| **Reusability** | **HIGH** (score 9/10) |

**Contract — POST (create):**
```
Request body: CertificationCreate
  - name:      string, required, max 128
  - type:      enum [group, individual], required
  - reviewers: User[], required, min 1
  - dueDate:   string ISO8601, required
  - notes:     string, optional, max 500

Response (201): Certification DTO (full record)
```

**Contract — GET (list):**
```
Query params:
  - type:   enum [group, individual]  (optional filter)
  - status: enum [active, expired, pending]  (optional filter)
  - owner:  string (user id)  (optional filter)
  - page:   int, default 0
  - size:   int, default 50

Response: { items: CertificationSummary[], total, page, size }
```

**Consumers (3):**
- Frontend / AngularJS: `{frontend_path}/identity/certListCtrl.js:45`, `{frontend_path}/dashboard/certSummaryCtrl.js:22`
- Frontend / Angular 18: `{frontend_path_modern}/certificationReports/list.component.ts:67`

**Stack trace:**
```
certListCtrl.js (AngularJS)
  └── httpService.get('/rest/ui/certifications')
       └── CertificationResource.list()
            └── FilterService.buildFilter() + PaginationService.paginate()
                 └── CertificationDAO.findAll()
                      └── Hibernate → `cert` table (Oracle)
```

**Reusability hint:** Already highly reusable. Add `?fields=` projection to reach 10/10.

---

### Common REST patterns
- All resources extend BaseResource
- Auth via @SPRight annotation
- Standard list endpoint: GET with ?query, ?sort, ?page, ?size
- Standard detail: GET /{id}
- Error handling via ExceptionMapper
```

---

## Phase: catalog_templates (Phase 6)

Identify reusable templates/layouts/partials. Detection depends on the templating system:

**Server-rendered (JSF/XHTML, ERB, Jinja, Blade):**
Look in page/view/template folders for layout files and include fragments.

**SPA frameworks (React/Vue/Angular):**
Look for layout components, shared components in `layouts/`, `shared/`, `components/common/`.

*Example output below is illustrative (XHTML/JSF templates). Your output reflects what was found in YOUR project.*

```markdown
## 7. Templates & Partial Views

### Page templates (XHTML)
| Template | Path | Includes | Used for |
|----------|------|----------|---------|
| main-layout.xhtml | web/ui/page/layout/main-layout.xhtml | header, nav, footer | All pages |
| list-page.xhtml | web/ui/page/layout/list-page.xhtml | toolbar, grid, pagination | List pages |
| detail-page.xhtml | web/ui/page/layout/detail-page.xhtml | tabs, form, actions | Detail pages |

### Reusable partials (include fragments)
| Partial | Path | Purpose | Included by |
|---------|------|---------|------------|
| header.xhtml | web/ui/page/include/header.xhtml | Top navigation | All pages |
| filter-bar.xhtml | web/ui/page/include/filterBar.xhtml | Filter controls | List pages |
| action-toolbar.xhtml | web/ui/page/include/actionToolbar.xhtml | Bulk actions | List pages |
```

---

## Phase: catalog_config_and_build (Phase 7)

Catalog configuration files, message bundles, and build commands. Detection is framework-specific but the output format is the same.

*Example output below is illustrative (Ant+JSPM stack). Your output reflects YOUR build system — could be Maven+npm, Gradle+yarn, pip+Vite, whatever was detected in discover_tech_stack (Phase 1).*

```markdown
## 8. Configuration

### Module registrations
| File | Purpose | How to register |
|------|---------|----------------|
| {frontend_path}/common/module.js | AngularJS shared module | .directive('name', fn) |
| {frontend_path}/{feature}/module.js | Feature module | .controller, .directive, .service |
| config/init.xml | application initialization | Object definitions |
| config/UIConfig.xml | UI configuration | Page, Form definitions |

### Message bundles
| File | Purpose | Key format |
|------|---------|------------|
| {MessagesFile}.properties | English i18n | ui_{section}_{key} |

## 9. Build System

| Command | What it does | When to use |
|---------|-------------|-------------|
| ant core | Java compile only (fast) | After Java-only changes |
| ant build | Full build (Java + JS + resources) | After any JS changes |
| ant clean build | Clean + full build | Before review, after merges |
| ant jstests | Run JS unit tests | After JS changes |
| npm run build:ts | Angular 18 build | After TS changes |
```

---

## Output Format

Save to: `contexts/project-map.md`

```yaml
---
project: {name}
scanned_at: {date}
scanned_by: project-analyzer
tech_stack: [...]   # list populated from Phase 1 — e.g. [AngularJS, Angular18, ExtJS, Java, Ant, XHTML]
                    # or whatever was detected for the project
total_shared_components: {N}
total_rest_endpoints: {N}
total_shared_services: {N}
---
```

Followed by all 9 sections above.

---

## Phase: write_pipeline_yaml (Phase 8 — auto-populates agent config)

**The project-analyzer doesn't just write project-map.md — it also generates the `shared_paths`, `operation_patterns`, and `i18n` blocks for the pipeline config.** This means agents never work with hardcoded paths or manually-maintained config. The scan discovers it all.

**The pipeline config is split across multiple files** (see `contexts/config/pipeline.{PACK}.README.md` for the file map). Each generated block is written to the file that owns it:

| Block | Target file |
|---|---|
| `shared_paths` | `contexts/config/pipeline.{PACK}.analyzer.yaml` |
| `operation_patterns` | `contexts/config/pipeline.{PACK}.builds.yaml` |
| `i18n` | `contexts/config/pipeline.{PACK}.builds.yaml` |
| `component_naming` | `contexts/config/pipeline.{PACK}.analyzer.yaml` |
| `explorer_paths` (Phase 8c) | `contexts/config/pipeline.{PACK}.analyzer.yaml` |
| `analyzer_ignore` (Phase 8.6) | `contexts/config/pipeline.{PACK}.analyzer.yaml` |
| `skills.layer_map` additions (Phase 8.6) | `contexts/config/pipeline.{PACK}.skills.yaml` |
| `intent_classification.verb_synonyms` additions | `contexts/config/pipeline.{PACK}.yaml` (core) |

### What gets auto-generated

From the scan results in Phases 1-7, synthesize these config blocks:

**8a: shared_paths** — one entry per discovered shared directory, with:
- path (from Phase 2 folder analysis)
- language (from Phase 1 language detection)
- framework (from Phase 1 framework detection)
- **provides[]** — inferred from the components scanned (Phases 3-5)
- usage — inferred from the framework's convention

**8b: operation_patterns** — inferred from Phase 6 REST endpoint analysis:
- Look at the most common REST patterns in the codebase
- Extract: what frontend service is used, what base class, what services are called
- Output templates for fetch_list, create_record, update_record, delete_record, bulk_action

**8c: i18n** — inferred from Phase 8 configuration scan:
- messages_file path (from config scan)
- key_format (from existing keys in messages.properties)
- allowed_content / forbidden_content — apply sensible defaults, user can customize

### Generation procedure

```
STEP 1: Build shared_paths.frontend.ui_elements

  FOR each UI component directory found (catalog_shared_components (Phase 3)):
    Scan the directory's files to determine what UI primitives are there:
      grep for directive names / component names
      Map to standardized primitive names: button, input, select, radio, checkbox,
        dropdown, multi-select, date-picker, grid, modal, etc.

    Build entry:
      - path: {directory path}
        language: {from extensions found: .js→javascript, .ts→typescript, .tsx→tsx, .vue→vue, .svelte→svelte}
        framework: {detected from file contents}:
          - AngularJS   if .js + angular.module detected
          - Angular18+  if .ts + @Component decorator
          - React       if .jsx/.tsx + import React / export default function
          - Vue         if .vue + <template>/<script setup>
          - Svelte      if .svelte + <script>
          - Next.js     if React + app/ or pages/ directory + next.config
          - ExtJS       if .js + Ext.define
          - Other/Custom if none of the above patterns match
        provides: [list of primitive names found]
        usage: {directive-in-template | component-in-template | extend-base-class | file-based-routing}

STEP 2: Build shared_paths.frontend.services

  FOR each frontend service directory (catalog_shared_services (Phase 4)):
    Scan files, extract service purpose from name/methods:
      httpService → [http]
      permissionService → [auth, permission]
      dateValidationService → [date-validation]
      notificationService → [notification]

    Build entry with provides[] = [categorized service names]

STEP 3: Build shared_paths.backend.services + utilities

  FOR each backend service directory (catalog_rest_endpoints (Phase 5)):
    Scan Java/Python/.NET files, extract purpose from class name:
      AuditService → [audit]
      AuthorizationService → [authorization]
      FilterService → [filter]
      PaginationService → [pagination]

    Same for utility directories → extract from class names

STEP 4: Build shared_paths.backend.rest_endpoints + operation_patterns

  FOR rest_endpoints directory (catalog_templates (Phase 6)):
    Scan @Path classes, extract:
      base_class (grep for "extends"): BaseResource, BaseController, etc.
      http_methods (grep @GET/@POST/@PUT/@DELETE): aggregate list
      common_patterns: analyze paths for list/detail/bulk-action signatures

    For operation_patterns, inspect 3-5 representative Resource classes:
      - What frontend service calls them? (grep frontend for the paths)
      - What services do they inject/call? (AuditService, AuthorizationService, etc.)
      - What DAO pattern? (inject DAO class, call findAll/save/update)

    Build operation_patterns.fetch_list, create_record, update_record, etc.
    by observing what the existing code actually does.

STEP 5: Build shared_paths.frontend.templates

  FOR template directories (catalog_config_and_build (Phase 7)):
    Layout files → type: page-template, provides: list-page, detail-page, etc.
    Partial files → type: partial, provides: header, footer, filter-bar, etc.

STEP 6: Build shared_paths.tests

  FOR test directories (extract_data_contracts (Phase 9)):
    Determine framework (JUnit, Jasmine, Jest, pytest) from discover_tech_stack (Phase 1).
    Default provides: [unit-test, spec-helper]

STEP 7: Build shared_paths.docs

  FOR documentation directories:
    docs/, README.md, *.md at project root → type, language

STEP 8: Build i18n block

  FIND messages.properties (or equivalent):
    e.g. {messages_path}/{MessagesFile}.properties
    Node: src/i18n/en.json or similar
    .NET: Resources/*.resx

  Detect key_format by sampling existing keys:
    ui_cert_title, ui_common_submit → format: "ui_{section}_{key}"

  Default allowed_content:
    [static_labels, static_headings, static_errors, static_help, static_enums]

  Default forbidden_content (based on common anti-patterns):
    [entitlement_lists, application_lists, rule_lists, user_lists,
     role_lists, policy_lists, dynamic_dropdowns, per_tenant_content]

  User can customize these post-generation.
```

### Output: Writes to multiple files

**File 1: `contexts/project-map.md`** — human-readable documentation (for developers to read).

**Files 2-N: pipeline config YAMLs** — UPDATE the discovered blocks in their owning files per the routing table above (`pipeline.{PACK}.analyzer.yaml` for shared_paths/component_naming/explorer_paths; `pipeline.{PACK}.builds.yaml` for operation_patterns/i18n; `pipeline.{PACK}.yaml` core for intent_classification).

### How the update works (don't overwrite user config)

```
1. DISCOVER pipeline config files in contexts/config/:
     - pipeline.<pack>.yaml             → CORE
     - pipeline.<pack>.<view>.yaml      → SIBLINGS (skills, builds, analyzer, demo)

2. FOR EACH block to write (shared_paths, operation_patterns, i18n, ...):
     a. Look up owning file from the routing table above.
     b. READ that file. PARSE the yaml tree.
     c. PRESERVE user-customized sections (anything outside this specific block).
     d. PRESERVE entries flagged with `provides_overridden: true` (or similar
        user-override flag) inside the block — copy them through unchanged.
     e. REPLACE the rest of the block with the discovered values.
     f. WRITE with header comment:
        # Auto-generated by project-analyzer on {date}
        # DO NOT edit {block_name} manually — rerun 'Analyze project'
        # DO edit other sections — those are preserved across runs.

3. STAGE all touched files for the user to commit together.
```

**Why per-file writes:** the split layout exists so agents only load what they need (Orchestrator skips `pipeline.{PACK}.builds.yaml` entirely). Writing all blocks to one file would break that token-saving design.

### Step: refine_explorer_paths (8c — uses map_folder_structure output, W3)

Pack pipeline.yaml ships `explorer_paths` with sensible defaults for a typical project of that stack (e.g. a Java/AngularJS pack's defaults are `{frontend_path}/`, `{frontend_path_modern}/`, `{frontend_path_admin}/`, `{backend_path}/`). But your project may have unconventional folders — a plugin directory, a fork with extra modules, a monorepo sibling.

map_folder_structure (Phase 2)'s folder structure map already knows where code actually lives. Step 8c compares the two and proposes a diff.

**Algorithm:**

```
1. READ current pipeline.yaml.explorer_paths → declared_paths
2. READ Phase 2 output → discovered_roots (folders where primary-framework code lives)
3. COMPUTE diff:
   MISSING = discovered_roots NOT in declared_paths
   STALE   = declared_paths NOT in discovered_roots (folder doesn't exist or has no relevant code)

4. FILTER MISSING:
   - Keep only roots that contain ≥ rescan_hints.unmapped_detection.min_file_count files
     of a known language (from skills.layer_map)
   - Exclude build/vendor/test-fixture directories
   - Exclude single-purpose folders that wouldn't help Explorer's git log sync
     (e.g. `docs/`, `scripts/`, `assets/` — these don't contain scannable code)

5. IF MISSING is empty AND STALE is empty:
     SKIP — explorer_paths is already current

6. ELSE emit a diff preview:
```

**Diff preview format (part of the gate before writing):**

```markdown
## 🔍 explorer_paths refinement (Phase 8c)

Current `explorer_paths` (pipeline.yaml):
  - {frontend_path}/
  - {frontend_path_modern}/
  - {frontend_path_admin}/
  - {backend_path}/

Phase 2 discovered:
  + web/ui/plugins/           ← MISSING (12 AngularJS files not covered)
  + integration/connectors/   ← MISSING (34 Java files not covered)
  - {frontend_path_admin}/             ← STALE (directory exists but has 0 files under any layer_map path_glob)

Proposed updated explorer_paths:
  - {frontend_path}/
  - {frontend_path_modern}/
  - web/ui/plugins/          ← added
  - {backend_path}/
  - integration/connectors/  ← added
  # {frontend_path_admin}/ removed — no files match any layer_map entry

Impact: Explorer's codebase-map sync will now pick up changes in these directories
        on every story. Removed paths will stop being watched.
```

**Gate integration (user confirms, does NOT auto-apply):**

The pre-write gate (after Phase 8 runs) adds a new option — `Preview explorer_paths diff`. If the user picks that, they see the diff above and can:

```
> 👉 Pick one:
>   - Accept refinement   — update explorer_paths with all proposed changes
>   - Accept additions    — add MISSING entries, keep STALE paths
>   - Reject              — leave explorer_paths unchanged
>   - Show per-path       — inspect file counts behind each proposal
```

**Preservation rule:** `explorer_paths` edits made manually by the user (comments preserved, ordering preserved) are respected. Step 8c only proposes adds/removes — it doesn't reorder or reformat. If the user has a comment above a path explaining why they customized it, that comment stays put.

**Why not auto-apply:** `explorer_paths` changes affect every subsequent Explorer run. Wrong additions cause Explorer to scan irrelevant folders (token burn); wrong removals cause Explorer to miss real changes. User confirmation is cheap insurance.

---

## Phase: emit_rescan_guidance (Phase 8.5 — Rescan Menu + Drift Detection)

**Runs after every `Analyze project` AND every `Rescan ...` command.** Answers three questions:

1. **What CAN I rescan?** — menu of valid commands for THIS project (data-driven from layer_map + catalog_shared_components (Phase 3)/4/5 counts)
2. **What SHOULD I rescan?** — drift detection per scope (where has the codebase moved since last rescan)
3. **What's NOT MAPPED?** — gaps (languages or shared-looking directories the analyzer can't categorize)

Output goes to two places:
- **Transient:** appended to the analyzer's gate output (user sees it right after scanning)
- **Persisted:** written to `project-map.md` as a `## Rescan Guidance` section (team can read it without re-running the analyzer)

### Step: load_rescan_hints (8.5a)

Read `pipeline.yaml.rescan_hints` (pack-defaulted, user-overridable). Defaults:

```yaml
rescan_hints:
  enabled: true
  drift_thresholds:
    high_file_count: 25      # ⚠️  High priority above this
    medium_file_count: 10    # ℹ️  Medium priority above this
    low_file_count: 3        # Low (silent below this)
    stale_days: 60           # Scope flagged overdue after N days with no rescan
  unmapped_detection:
    enabled: true
    min_file_count: 3        # Don't flag single-file "languages"
    shared_dir_patterns:
      - shared
      - common
      - util
      - utilities
      - base
      - widgets
      - wrappers
```

If `rescan_hints.enabled: false` → skip Phase 8.5 entirely.

### Step: build_rescan_menu (8.5b — Check 1)

From `skills.layer_map` + catalog_shared_components (Phase 3)/4/5 counts, generate valid commands. **Only non-empty combinations appear.**

```
FOR each entry in layer_map:
  Record: layer (frontend|backend|tests), language, framework-key, aliases
  Count files in path_glob → {file_count}

FOR each (language, section) combination:
  Count matching entries in Phase 3 (components), Phase 4 (services),
  Phase 5 (endpoints), utilities
  IF count > 0 → add to "Stack + section" list
  IF count == 0 → omit (but remember for "did you mean" runtime hints)

Layer totals:
  frontend_total = sum file_counts across FE layer_map entries
  backend_total  = sum file_counts across BE layer_map entries
  tests_total    = sum file_counts across test layer_map entries
```

### Step: detect_drift (8.5c — Checks 2, 3, 4)

Read prior `last_rescan` metadata from existing project-map.md (if present — first-run has no baseline, so drift is SKIPPED on the first `Analyze project`).

```bash
# Scope-specific rescan history is tracked per layer/stack/section.
# Read from project-map.md rescan_log (appended by each rescan — see preservation rules):
#   rescan_log:
#     - scope: "frontend"
#       last_rescan: 2026-03-10
#       files_at_scan: 842
#     - scope: "Java/Services"
#       last_rescan: 2026-02-28
#       files_at_scan: 58
#     ...

FOR each scope (layer, stack, stack/section) in the menu:
  last_rescan_date = rescan_log[scope].last_rescan || creation_date
  files_at_last_scan = rescan_log[scope].files_at_scan || 0

  # Git-based drift count
  changed = git log --after="$last_rescan_date" --name-only --pretty=format:"" \
              -- {scope_paths} | sort -u | wc -l

  # File count delta
  current_files = count files in scope_paths now
  delta = current_files - files_at_last_scan

  # Classify by threshold
  IF changed >= high_file_count OR abs(delta) >= high_file_count:
    priority = HIGH
  ELIF changed >= medium_file_count OR abs(delta) >= medium_file_count:
    priority = MEDIUM
  ELIF changed >= low_file_count:
    priority = LOW (silent in most contexts)
  ELSE:
    priority = NONE (no mention)

  # Staleness independent of churn
  days_since = today - last_rescan_date
  IF days_since > stale_days AND changed > 0:
    add STALE flag to the entry
```

Output the drift block with items grouped by priority, each suggesting a concrete command.

### Step: detect_unmapped (8.5d — Checks 5, 6)

**Check 5 — Unmapped languages:**

```bash
# Gather all file extensions in the project — $EXCLUDE_FLAGS from Step 0.1
# replaces the hardcoded .git/node_modules/build/dist list with the full scan_exclusions set
all_extensions = find . -type f $EXCLUDE_FLAGS \
                   | sed -n 's/.*\.\([a-zA-Z0-9]\+\)$/\1/p' | sort | uniq -c | sort -rn

# Known extensions = union of all layer_map entries' extensions
known_extensions = yaml_get skills.layer_map[*] + shared_paths.*.extensions

FOR each (count, ext) in all_extensions:
  IF ext NOT IN known_extensions AND count >= unmapped_detection.min_file_count:
    # Map extension → language (built-in heuristic: .kt → Kotlin, .rs → Rust,
    # .go → Go, .rb → Ruby, .swift → Swift, .scala → Scala, .dart → Dart, etc.)
    add to unmapped_languages with suggested layer_map entry template
```

**Check 6 — Unmapped shared directories:**

```bash
# Find directories whose names match shared patterns
FOR pattern in rescan_hints.unmapped_detection.shared_dir_patterns:
  find . -type d $EXCLUDE_FLAGS -iname "*$pattern*"
  → candidate_dirs

FOR each candidate_dir:
  # Is it already covered by shared_paths?
  covered = any shared_paths.*.path matches candidate_dir or its parent

  IF NOT covered:
    # Classify by what's in it
    scan candidate_dir for file extensions → guess layer (FE if .ts/.tsx/.js/.jsx/.html;
                                                          BE if .java/.py/.rb/.go)
    add to unmapped_shared_dirs with suggested shared_paths entry
```

### Step: render_gate_output (8.5e — transient)

The block below is APPENDED to the `## ✅ Project Analysis Complete` gate output. Same block appears after every rescan, with scope-relevant sections highlighted.

```markdown
---

## 🧭 Rescan Menu (valid commands for this project)

Detected: {tech_stack_summary}

**Layer-scoped:**
  `Rescan frontend`  ({fe_file_count} files across {fe_layer_count} FE layers)
  `Rescan backend`   ({be_file_count} files across {be_layer_count} BE layers)
  `Rescan tests`     ({tests_file_count} files)

**Stack-scoped (broad):**
  `Rescan {Stack1}`  ← {framework_or_language_summary}
  `Rescan {Stack2}`  ← ...
  {one line per non-empty stack}

**Stack + section (non-empty combinations only):**
  `Rescan {Stack}/{Section}` ({count})
  {one line per non-empty combination}

**Section-scoped (cross-stack):**
  `Rescan components` | `services` | `endpoints` | `contracts` | `consumers`
  `Rescan templates` | `build` | `config` | `folders` | `stack` | `promotions`

**Scope-based:**
  `Rescan since {YYYY-MM-DD}` | `Rescan path: {dir}` | `Rescan since last rescan`

---

## 🔔 Drift Detected (since last rescan per scope)
{Omit block entirely on first-run Analyze project — no baseline}

**High priority (⚠️):**
  ⚠️  `{Scope}`: {N} files changed since last rescan ({date}) [+{STALE if over stale_days}]
       → Run: `{suggested command}`

**Medium priority (ℹ️):**
  ℹ️  `{Scope}`: {N} files changed
       → Run: `{suggested command}` (or wait — Review auto-syncs pipeline work)

{If drift counts all below low threshold:}
  ✓  Map is current across all scopes. No rescan needed.

---

## 🆕 Unmapped Content (gaps in layer_map / shared_paths)
{Omit "Unmapped languages" subsection if none}
{Omit "Unmapped shared dirs" subsection if none}

**Unmapped languages:**
  ⚠️  `.{ext}` files found ({N} in {path}) — no {Language} layer
       → FIX: add to pipeline.yaml skills.layer_map:
       ```yaml
       "{Layer}/{Language}":
         skills: [{pack}-{language}-standards.md]   # create skill first
         path_glob: "{inferred-path}/**"
         language: {language}
         aliases: ["{Language}"]
       ```
       → THEN run: `Rescan {frontend|backend}`

**Unmapped shared directories:**
  ⚠️  New shared-looking directory: `{path}` ({N} files)
       Not in shared_paths.{layer}.{section}
       → FIX: append to pipeline.yaml shared_paths.{layer}.{section}:
       ```yaml
         - path: "{path}"
           language: {language}
           framework: {framework}
           provides: [<TBD — fill in after rescan>]
           extensions: [{list}]
       ```
       → THEN run: `Rescan {framework}/{section}` (or `Rescan {layer}`)

{If both checks pass:}
  ✓  All detected file types and shared directories are mapped.
```

### Step: persist_to_project_map (8.5f)

Prepend this section to `project-map.md` (before section 1):

```markdown
## 🧭 Rescan Guidance

*Generated by project-analyzer on {scan_date}. Regenerated on every scan/rescan.*

### Menu
{same content as transient Rescan Menu block above — the menu is relatively
static, changes only when layer_map changes}

### Last Health Check ({scan_date})

**Drift snapshot:**
{bullet list of drift items found — or "✓ All scopes current"}

**Unmapped snapshot:**
{bullet list of unmapped items — or "✓ All content mapped"}

**Skill authoring snapshot:**
{bullet list — one line per layer with no skill file, formatted as:
   ⚠️  {Layer}: {reason} → suggested skill `{pack}-{slug}-standards.md`
   …or `✓  Every configured layer has a skill file.` if none}

---
```

**Why persist it:** the menu changes only when `layer_map` changes (rarely), and the health snapshot from the last scan lets anyone on the team see "what did the analyzer last tell us about drift" without running it themselves. Next `Analyze project` or any `Rescan ...` regenerates the section. The skill-authoring snapshot is the persisted view of `emit_skill_authoring_recommendations (8.6h)` — the full block with topic outlines lives in the analyzer transcript; project-map.md keeps the one-line summary so authoring debt is visible to the team without re-running the analyzer.

### Step: append_to_rescan_log (8.5g)

Every rescan MUST append an entry to `project-map.md`'s `rescan_log` metadata for the scope it rescanned:

```yaml
rescan_log:
  - scope: "frontend"
    last_rescan: 2026-04-18
    files_at_scan: 889
    rescan_command: "Rescan frontend"
    phases_run: [3, 3b, 4, 6, 6-enh, 10]
    changes: {added: 12, removed: 2, modified: 18}
  - scope: "project"
    last_rescan: 2026-01-15
    files_at_scan: 2847
    rescan_command: "Analyze project"
    phases_run: [1, 2, 3, 3b, 4, 5, 6, 6-enh, 7, 8, 9, 10, 11]
    changes: {initial_scan: true}
```

This log is **append-only** — never rewritten. Drift detection in Step 8.5c reads it to compute per-scope staleness.

### Step: handle_edge_cases (8.5h)

| Situation | Behavior |
|-----------|----------|
| First `Analyze project` (no prior map) | Drift block omitted entirely (no baseline). Menu + unmapped still shown. |
| `rescan_hints.enabled: false` | Entire Phase 8.5 skipped. |
| All drift below `low_file_count` | Drift block shows `✓ Map is current across all scopes.` |
| Scope has no files after rescan (e.g. deleted directory) | Drift shows as HIGH with "REMOVED" flag: "Scope `{X}` is empty — consider removing from layer_map." |
| Unmapped language has only 1–2 files | Silent (below `min_file_count`). |
| Unmapped shared dir contains 0 files | Silent (empty dirs ignored). |
| User had `provides_overridden: true` flags | Respected — those entries don't generate drift noise from rescans. |
| Layer has `skills: []` AND no `path_glob` (e.g. `Test`) | Skill recommendation skipped — Strategy-B-only layers are intentionally body-less. |
| Layer's skill file exists but is < 500 bytes | Treated as `stub_file` — recommend completing it, with same coverage outline. |
| Pack directory missing (`--no-pack` install) | Step 8.6h skipped entirely — no pack to author into. |
| User has `skill_recommendations_ignore` entries | Respected like analyzer_ignore — re-propose only on 2x evidence growth. |

### Gate before writing (with confidence review)

```
## ✅ Project Analysis Complete

**Discovered:**
- Languages: {list}
- Frameworks: {list}
- Databases: {list}
- {N} shared UI component directories ({M} components cataloged)
- {N} shared service directories ({M} services cataloged)
- {N} REST endpoints across {M} resource classes
- {N} reusable templates/partials
- {N} operation patterns extracted from code

**Alias Confidence Summary:**
- HIGH confidence ({N} components): filename + props + template + consumers agree
- MEDIUM confidence ({N} components): 2 signals matched
- LOW confidence ({N} components): need your review ↓

### LOW confidence aliases (please review before writing)

| Component | Proposed aliases | Why low confidence | Your call |
|-----------|-----------------|-------------------|-----------|
| spHelper.js | [utility] | Only filename matched — no props, no template | Confirm / Change / Skip |
| spPicker.js | [picker — ambiguous] | Has props `items` + `selected` but no clear domain | date-picker / user-picker / other |
| spWidget.js | [] | No matching alias in taxonomy | Name it manually or add to alias-taxonomy.md |

### Uncategorized components (no alias match)

These files are shared but don't match any standard alias pattern:

| File | Props/signals found | Recommendation |
|------|---------------------|----------------|
| spCustomChart.js | { data, options } | Add 'chart' alias or treat as domain-specific |
| spAuditLogViewer.js | { logs, filters } | Domain-specific → no standard alias |

**Files to write:**
1. contexts/project-map.md (new — includes `## 🧭 Rescan Guidance` section generated by emit_rescan_guidance (Phase 8.5))
2. Pipeline config YAMLs — routed per the table in Phase 8 above:
   - `pipeline.{PACK}.analyzer.yaml` — shared_paths (+ component_naming, explorer_paths)
   - `pipeline.{PACK}.builds.yaml`   — operation_patterns, i18n
   Your existing config sections preserved across all files.

{Phase 8.5 OUTPUT APPENDS HERE — see Phase 8.5e output format:
  - 🧭 Rescan Menu (valid commands for this project)
  - 🔔 Drift Detected (only if baseline exists — omitted on first run)
  - 🆕 Unmapped Content (omitted if fully mapped)
}

> 👉 `Go` — write both files with current classifications
>        `Review LOW` — walk through each LOW-confidence component one by one
>        `Preview pipeline.yaml` — show the diff before writing
>        `Preview project-map.md` — show the document (includes Rescan Guidance)
>        `Show rescan menu` — display the full rescan command surface
>        `Show drift only` — hide menu + unmapped, show drift priorities only
>        `Cancel` — abort
```

**`Review LOW` flow:** For each LOW-confidence component, analyzer shows:
- The file path
- The signals it found (filename, props, template, usage count)
- Top 3 possible aliases from taxonomy with match reasoning
- User picks one or types a custom alias

This ensures the agent never silently writes a wrong alias. HIGH and MEDIUM confidence entries are trusted; LOW requires explicit confirmation.

### Post-write gate (after `Go` completes)

After files are written, show a single-action pointer tailored to whether this was first scan or a rescan. Follows router Rule 1 (one next action, no roadmap).

**If first `Analyze project` (project-map.md just created):**

```
## ✅ Project map written

Files:
  contexts/project-map.md                       (new — includes Rescan Guidance section)
  contexts/config/pipeline.{PACK}.analyzer.yaml    (updated — shared_paths, component_naming)
  contexts/config/pipeline.{PACK}.builds.yaml      (updated — operation_patterns, i18n)
  contexts/config/pipeline.{PACK}.yaml             (updated — intent_classification, if changed)

> 👉 Commit all updated files, then start your first ticket:
     git add contexts/project-map.md contexts/config/pipeline.*
     git commit -m "chore: run project-analyzer"
     Then in your IDE: `Work on <TICKET-ID>`
```

**If `Rescan project` (full map refresh):**

```
## ✅ Project map rescanned

Changes applied: {N added, M modified, K removed}
Drift snapshot: {summary from emit_rescan_guidance (Phase 8.5)}

> 👉 Commit the refreshed map, then resume your work:
     git add contexts/project-map.md
     git commit -m "chore: rescan project-map"
```

**If targeted rescan (`Rescan frontend`, `Rescan Java/Services`, etc.):**

```
## ✅ Rescan complete — {scope}

Phases run: {phase_list}
Changes applied: {summary}

> 👉 Commit the scope update:
     git add contexts/project-map.md
     git commit -m "chore: rescan {scope}"
```

One action, contextually correct command. User can proceed or ignore.

### Rescan behavior

When `Rescan project` is run:
1. project-map.md gets diffed and updated (existing behavior)
2. pipeline.yaml's auto-generated sections also get diffed and updated
3. **User-edited sections in pipeline.yaml are NEVER touched**

This means the user can:
- Add `aliases` to a layer_map entry → persists across rescans
- Customize `i18n.forbidden_content` with project-specific types → persists
- Adjust `runtime.branching.base_branch` → persists
- Override any `shared_paths` entry's `provides[]` to add missing primitives → WARNING: next rescan will overwrite. Better to open an issue for analyzer improvement.

### User correction flow

If the analyzer misclassifies a `provides[]` entry (e.g., calls something a "dropdown" that's actually a "multi-select-with-search"), the user can:

1. Edit the entry in pipeline.yaml manually
2. Mark it with a special flag: `provides_overridden: true`
3. Analyzer will NOT overwrite on next rescan (honors the override)

```yaml
# Example override:
shared_paths:
  frontend:
    ui_elements:
      - path: "{frontend_path}/common/directive/"
        language: javascript
        framework: AngularJS
        provides: [button, input, select, multi-select-with-search, date-range-picker]
        provides_overridden: true   # ← protects this entry from rescan
        usage: "directive-in-template"
```

---

## Rescan Command Router (on-demand — run anytime)

Rescans let you refresh a SLICE of project-map.md without redoing the full 11-phase scan. Full rescan is 5–15 min on a mature codebase; a targeted rescan is typically 30s–2 min.

### Parsing rule: most-specific-match-first

Commands parse from longest match to shortest. Specificity order:

```
1. "Rescan <Stack>/<Section>"   → narrow (e.g. "Rescan Java/Services")
2. "Rescan <Stack>"              → broad by language/framework (e.g. "Rescan Java")
3. "Rescan <Layer>"              → broad by layer (e.g. "Rescan frontend")
4. "Rescan <Section>"            → section-only (e.g. "Rescan components")
5. "Rescan path: <dir>"          → by directory
6. "Rescan since <date>"         → by git history
7. "Rescan project"              → full rescan
8. "Rescan <anything-else>"      → treat the rest as a folder (legacy `Rescan {folder}` form)
```

If the token after `Rescan ` matches both a stack alias and a section name, stack wins (stacks are more specific — a single codebase has one `frontend` but many languages).

### Layer-based rescans

| Command | Scope | Phases run | project-map.md sections updated |
|---------|-------|-----------|--------------------------------|
| `Rescan frontend` | All FE layer_map entries | 3 → 3b → 4 (FE) → 6 → 6-enh → 10 (FE slice) | 3, 3b, 4 (FE), 6 |
| `Rescan backend` | All BE layer_map entries | 4 (BE) → 5 → 9 → 11 → 10 (BE slice) | 4 (BE), 5, 6 (endpoints), 9 |
| `Rescan tests` | All test layer_map entries | 3 (test fixtures) | 3 (test-fixture entries only) |

"All FE" = every `skills.layer_map` entry with `path_glob` starting in a frontend root (derived from `shared_paths.frontend.*.path` prefixes). Same principle for BE.

### Stack-specific rescans (BROAD)

Any key in `skills.layer_map` OR any of its `aliases:` becomes a valid stack command automatically. The analyzer reads layer_map at dispatch time — no hardcoded list.

| Command | Resolves to | Scope |
|---------|------------|-------|
| `Rescan Java` | layer_map entries where `language: java` | ALL Java code: backend services, utilities, REST resources |
| `Rescan AngularJS` | `layer_map["Frontend/AngularJS"]` (+ aliases) | AngularJS components, services, templates only |
| `Rescan Angular 18` | `layer_map["Frontend/Angular18"]` (+ aliases) | Angular 18 components, services, modules only |
| `Rescan ExtJS` | `layer_map["Frontend/ExtJS"]` (+ aliases) | ExtJS components only |
| `Rescan TypeScript` | all layer_map entries where `language: typescript` | ALL TS code regardless of framework |
| `Rescan Python` | all layer_map entries where `language: python` | ALL Python code |
| `Rescan JSF` / `Rescan XHTML` | `layer_map["Frontend/JSF"]` or `language: xhtml` | JSF/XHTML templates |

**Resolution algorithm:**
```
1. Normalize the stack token (lowercase, strip spaces/hyphens)
2. Match against layer_map keys (exact, then alias lookup)
   → if 1 match → that layer_map entry IS the scope
   → if multiple matches (e.g. "Java" matches both "Backend/Java" and "Tests/Java")
     → union all matches → scope is everything with language: java
   → if 0 matches → error: "Unknown stack 'X'. Known: <list from layer_map>"
3. Derive paths: layer_map[key].path_glob + any shared_paths entries with matching language
4. Run Phase 3 (components), Phase 4 (services), Phase 5 (endpoints — BE only) over those paths
5. Cascade dependent phases (see cascade table below)
```

### Stack/Section rescans (NARROW)

Combine a stack with a section for surgical updates:

| Command | Scope |
|---------|-------|
| `Rescan Java/Services` | Backend services written in Java (Phase 4 BE, Java entries only) |
| `Rescan Java/REST` | REST resources written in Java (Phase 5 + 9 + 11, Java entries only) |
| `Rescan Java/Utilities` | Java utility classes (Phase 4 BE utilities only) |
| `Rescan AngularJS/Components` | AngularJS shared components (Phase 3 + 3b, AngularJS only) |
| `Rescan AngularJS/Services` | AngularJS services (Phase 4 FE, AngularJS only) |
| `Rescan Angular 18/Components` | Angular 18 components (Phase 3 + 3b, Angular 18 only) |
| `Rescan Python/Services` | Python/Flask services (Phase 4 BE, Python only) |
| `Rescan Python/REST` | Python Flask routes (Phase 5 + 9 + 11, Python only) |

**Valid sections (after the `/`):** `Components`, `Services`, `REST` / `Endpoints`, `Utilities`, `Templates`, `Fixtures`, `Contracts`, `Consumers`.

If a stack/section combination is empty (e.g. `Rescan Java/Components` — Java doesn't render UI components in most stacks), analyzer returns: "No layer_map entries match Java × Components. Did you mean `Rescan Java/Services`?"

### Section-specific rescans (cross-stack)

| Command | Phase(s) | When to use |
|---------|---------|-------------|
| `Rescan components` | 3 + 3b | New shared UI component added outside pipeline |
| `Rescan services` | 4 (FE + BE) | Services reorganized |
| `Rescan endpoints` / `Rescan REST` | 5 + 9 + 11 | New REST resources merged |
| `Rescan contracts` | 9 | Request/response DTO changes |
| `Rescan consumers` | 10 | FE→BE call graph refresh |
| `Rescan templates` | 6 + 6-enh | Template refactor, new layout introduced |
| `Rescan build` / `Rescan build commands` | 7 (build system half) | `package.json` / `pom.xml` / `build.xml` changed |
| `Rescan config` | 7 (configuration half) | `init.xml` / `UIConfig.xml` / env files changed |
| `Rescan folders` | 2 | Directory reorganization |
| `Rescan stack` / `Rescan tech stack` | 1 | Added/removed dependencies; checks if new framework detected → proposes new layer_map entry |
| `Rescan promotions` | 3b only | Consumer counts changed, want promotion recommendations refreshed |

### Scope-based rescans

| Command | Scope |
|---------|-------|
| `Rescan since {YYYY-MM-DD}` | Files changed in git since that date (all matching phases re-run on the delta) |
| `Rescan since last rescan` | Files changed since the previous `last_rescan` metadata value |
| `Rescan path: {dir}` | All phases, limited to files under that directory |
| `Rescan {folder}` *(legacy)* | Same as `Rescan path:` — kept for backward compatibility |

### Full rescan

| Command | Scope |
|---------|-------|
| `Analyze project` | First time only — creates project-map.md. Errors if file already exists (suggests `Rescan project`). |
| `Rescan project` | Full 11-phase rescan with diff preview. Use after major external merges or quarterly hygiene. |

---

### Cascade / dependency logic

Phases feed each other. Rescans automatically cascade to maintain consistency:

| Rescan trigger | Must also re-run | Why |
|----------------|-----------------|-----|
| Phase 1 (stack) | — | Standalone. But if a NEW framework is detected, prompts user to propose a layer_map entry, then suggests follow-up `Rescan frontend` or `Rescan backend`. |
| Phase 3 (components) | Phase 3b | Promotion recommendations depend on component catalog. |
| Phase 3 + 10 | Phase 3b | Promotion needs consumer counts. |
| Phase 5 (endpoints) | Phase 9 + Phase 11 | Contracts and reusability depend on endpoint catalog. |
| Phase 6 (templates) | Phase 6-enh | Layout inheritance graph builds on template list. |
| Phase 9 (contracts) | Phase 11 | Reusability score uses contract data as input. |
| Phase 10 (consumers) | Phase 3b + Phase 11 | Consumer counts feed both promotion and reusability classification. |

The router computes the full set of phases needed for the requested scope before running. User sees the phase list up-front:

```
## Rescan — Java/REST

Scope:
  - Stack:    Java (layer_map: Backend/Java)
  - Section:  REST
  - Paths:    {backend_path}/web/rest/**

Phases to run: 5 → 9 → 11 (with Phase 10 re-slice for Java endpoints)

> 👉 Pick one:
>   - Go            — run the rescan
>   - Show phases   — detail what each phase will do
>   - Cancel
```

---

### Preservation rules (ALL rescans)

Every rescan MUST:

1. **Preserve metadata:** `created_by`, `created_at`, original story logs, prior `last_rescan` history (append, never overwrite the log).
2. **Update only:** `last_rescan`, `rescan_reason`, `rescan_scope`, `scanned_at`, and the in-scope sections.
3. **Never touch sections outside declared scope.** `Rescan Java` MUST NOT rewrite Phase 3 frontend component entries. `Rescan frontend` MUST NOT rewrite Phase 5 REST endpoints. Validation runs before write: any proposed change outside scope → abort with error.
4. **Honor `provides_overridden: true` and similar user-override flags** in pipeline.yaml (existing behavior — applies to every rescan).
5. **Maintain diff preview.** Even for narrow rescans, show the user what changed before applying. `Apply all / Apply additions only / Show details / Cancel` menu is universal.

### Rescan output header (all scopes)

```yaml
---
rescan_command: "Rescan Java/REST"   # literal user command
rescan_scope:
  stack: Java
  section: REST
  paths: ["{backend_path}/web/rest/**"]
phases_run: [5, 9, 10-slice, 11]
scanned_at: 2026-04-18
last_rescan: 2026-04-18
rescan_reason: "user-requested: new endpoints from PAQMAG-4501"
changes: {added: 3, removed: 0, modified: 2}
---
```

This header appears in the rescan report AND gets appended to the project-map.md metadata log (not overwritten — the log grows over time so you can audit what was refreshed when).

---

### Rescan preflight assertions (v15.1 — fail-fast on scope issues)

Before running ANY rescan, the router validates the resolved scope against the current project state. Fails fast with a specific error rather than proceeding with a bad scope and producing garbage output.

**Preflight checks (run in order; first failure aborts):**

```
1. MAP EXISTS
   IF contexts/project-map.md does not exist:
     ABORT: "No project-map.md found. First-time setup requires `Analyze project`,
            not `Rescan ...`. Run: Analyze project"

2. RESCAN_LOG PARSEABLE
   parse project-map.md rescan_log: metadata
   IF malformed YAML or missing required keys (scope, last_rescan, files_at_scan):
     ABORT: "rescan_log is malformed (see {file}:{line}). Manual fix required
            before rescanning. Do NOT proceed — incorrect log produces incorrect
            drift detection."

3. SCOPE RESOLVES
   resolved_scope = parse_rescan_command(command)
   IF resolved_scope is None:
     ABORT: "Cannot parse rescan command '{command}'.
            Valid forms: Rescan project | Rescan <Layer> | Rescan <Stack> |
                         Rescan <Stack>/<Section> | Rescan <Section> |
                         Rescan path: <dir> | Rescan since <date>
            See Rescan Command Router for the full grammar."

4. STACK EXISTS IN LAYER_MAP (for Rescan <Stack> and Rescan <Stack>/<Section>)
   IF stack token not in layer_map keys AND not in any entry's aliases[]:
     ABORT: "Unknown stack '{stack}'. Known stacks in this project:
            {list from layer_map keys + aliases}
            If you added a new language/framework, run `Rescan stack` first
            — it proposes new layer_map entries for unmapped content."

5. PATHS EXIST (for path-scoped rescans)
   FOR each path in resolved_scope.paths:
     IF path does not exist on disk:
       WARN: "Path '{path}' in layer_map does not exist — skipping.
             Consider running `Rescan folders` to refresh Phase 2 folder structure."
     IF path exists but contains 0 files matching any layer_map path_glob:
       WARN: "Path '{path}' exists but contains no scannable code for
             {framework}. This scope will produce an empty rescan."

6. SCOPE NON-EMPTY
   IF after path filtering, zero files remain in scope:
     ABORT: "Resolved scope matches 0 files. Nothing to rescan.
            Check that {paths} exist and contain code matching layer_map.
            Did you mean `Rescan project` (full) or a different stack?"

7. STACK × SECTION COMBINATION NON-EMPTY (for narrow rescans)
   IF resolved_scope is Stack/Section AND count == 0:
     Look up "did you mean" hint from the shipped stack×section map:
     ABORT: "No layer_map entries match {stack} × {section}.
            Non-empty {stack} combinations in this project:
            {list from Phase 8.5b menu}.
            Did you mean `Rescan {stack}/{nearest-non-empty-section}`?"

8. UNCOMMITTED CHANGES WARNING (non-blocking)
   IF git status --porcelain shows uncommitted changes in contexts/project-map.md:
     WARN: "You have uncommitted changes to contexts/project-map.md.
           Rescanning will apply diffs on top of unsaved state.
           Commit or stash first, or proceed with caution.
           (Use `Cancel` to abort the rescan.)"
     Wait for user Y/N confirmation before proceeding.

ALL CHECKS PASS → proceed to "Rescan flow (with DIFF — universal)" below.
```

**Error output format (universal):**

```
❌ Rescan preflight failed

Check {N} of 8 — {CheckName}

Reason: {specific message from above}

Suggested next step: {concrete action — not "try again"}

> 👉 Pick one:
>   - {specific_fix_command}   — {what it does}
>   - Show details             — display full diagnostics
>   - Cancel                   — abort rescan
```

**Rationale:** rescan commands are time-consuming (30s–15min) and write to persistent state. Failing fast at preflight is orders of magnitude cheaper than running a bad rescan, diffing against a corrupted baseline, and trying to undo the damage. Preflight turns "silently produces wrong output" into "refuses to start with a clear error."

### Rescan flow (with DIFF — universal)

Same flow as before, now applied per scope:

```
1. RESOLVE scope from command → paths + phases
2. READ existing project-map.md sections in scope → old_map_slice
3. SCAN only those paths → new_scan_slice
4. DIFF old vs new (scoped):

   ADDED (in codebase but not in map):
     + {file} ({category})

   REMOVED (in map but not in codebase):
     - {file} ({category})

   MODIFIED:
     ~ {file}
       was: {old api}
       now: {new api}

   UNCHANGED:
     = {N} entries

5. VALIDATE: every change is within declared scope (reject + warn if not)

6. PRESENT diff to user:

   ## Rescan — {command} — {date}

   **Changes since last rescan of this scope ({last_rescan_of_scope}):**

   ✅ ADDED: {N}
   ❌ REMOVED: {N}
   🔄 MODIFIED: {N}
   ═ UNCHANGED: {N}

   > 👉 Pick one:
   >   - Apply all                 — update scoped sections
   >   - Apply additions only      — add new, keep removed
   >   - Show details: {item}      — inspect a specific change
   >   - Cancel                    — no changes written

7. On "Apply all":
   UPDATE only the in-scope sections of project-map.md
   APPEND to metadata log (rescan_command, phases_run, changes)
   → proceed to Scope Summary Report (Step 8)

8. EMIT Scope Summary Report (v17 — always, after every successful rescan)
   See next subsection.
```

### Scope Summary Report (v17 — appended to every successful rescan)

After the diff is applied, emit a **current-state summary** showing what now exists in the rescanned scope. Not just the delta (which was in the diff) — the complete picture of everything in scope, so the user can verify the analyzer sees the codebase correctly.

**Format depends on scope type.** Below are templates for the common forms.

**For `Rescan frontend`:**

```markdown
## 📊 Rescan Summary — Frontend

**Tech stacks detected (this scope):**
  AngularJS 1.8    — 47 shared components, 8 services, 42 feature pages
  Angular 18       — 12 shared components, 3 services, 6 feature pages
  ExtJS 6.2        — 4 base classes, 0 services, 3 admin panels
  JSF 2.x          — layout templates only (28 pages)

**Reusable shared components by primitive:**
  select/dropdown   — sp-reviewer-select, sp-application-select, sp-role-select (3)
  modal             — sp-confirm-modal, sp-form-modal (2)
  date-picker       — sp-date-range-picker (1)
  grid              — sp-data-grid (1)
  button            — sp-action-button, sp-icon-button (2)
  pagination        — sp-paginator (1)
  autocomplete      — sp-user-autocomplete (1)
  {... one row per primitive with any components}

**Shared component locations (grouped by framework):**
  AngularJS  → {frontend_path}/common/directive/ (47 files, 9 primitives covered)
  Angular 18 → {frontend_path_modern}/shared/ (12 files, 5 primitives covered)
  ExtJS      → {frontend_path_admin}/common/ (4 base classes)

**Promotion candidates (from § 3b):**
  date-range-filter.js — used by 4 feature folders, currently at {frontend_path}/certifications/
  entity-card.js       — used by 3 feature folders, currently at {frontend_path}/identity/
  (2 total)

**Coverage gaps (primitives missing from shared_paths — may need CREATE):**
  tooltip             — no shared component found (one-off usage in 2 feature files)
  drag-drop-list      — no shared component found (custom per feature)
```

**For `Rescan backend`:**

```markdown
## 📊 Rescan Summary — Backend

**Tech stacks detected (this scope):**
  Java (Spring)     — 28 REST endpoints, 12 services, 34 utilities
  Hibernate ORM     — 47 entities, 23 DAOs

**REST endpoints by resource class:**
  CertificationResource   — 5 endpoints (GET, POST, PUT) — reusability HIGH
  IdentityResource        — 4 endpoints — reusability HIGH
  RoleResource            — 7 endpoints — reusability MEDIUM
  {... grouped with HIGH/MEDIUM/LOW summary}

**Shared backend services:**
  audit                   — AuditService ({backend_path}/service/)
  authorization           — AuthService, PermissionService
  filter                  — FilterService, QueryFilterBuilder
  {... one row per provides capability}

**Persistence layer:**
  ORM: Hibernate          — 47 entities, 23 DAO classes
  DB drivers detected:    Oracle (primary), PostgreSQL (tests)
  Migration tool:         Liquibase (config/liquibase/)
  Cache:                  Redis ({backend_path}/cache/RedisClient.java)

**Contract confidence breakdown (§ 9 — v15 markers):**
  HIGH:    19/28 endpoints (typed + validation)
  MEDIUM:   6/28 endpoints (typed, no validation)
  LOW:      2/28 endpoints (untyped, heuristic extraction)
  NONE:     1/28 endpoints (dynamic routing — /rest/dispatch)

**Endpoint reusability breakdown (§ 11):**
  HIGH (9-10): 12 endpoints — first-class reusable
  MED  (5-8):  11 endpoints — reusable with caveats
  LOW  (2-4):   4 endpoints — single-purpose
  FEATURE-LOCAL: 1 endpoint

**Consumer graph health (§ 10):**
  Endpoints with 0 consumers: 0 (clean — no dead endpoints)
  Endpoints with 1 consumer:  5 (FEATURE-LOCAL candidates)
  Endpoints with 3+ consumers: 15 (high reuse)
```

**For `Rescan endpoints`:**

```markdown
## 📊 Rescan Summary — REST Endpoints

**Endpoint catalog ({N} total):**
  {grouped-by-resource-class table with path, method, contract_confidence, reusability}

**Contract confidence distribution:**
  {same breakdown as above}

**Reusability distribution:**
  {same breakdown as above}

**Consumer graph:**
  {top 5 most-consumed endpoints + any zero-consumer endpoints}

**Stack correlation (§ 10d):**
  Endpoints called from AngularJS only:    18
  Endpoints called from Angular 18 only:    3
  Endpoints called from BOTH:               7 (dual-stack consumers)
```

**For `Rescan database` / `Rescan persistence`:** (section-scoped rescan)

```markdown
## 📊 Rescan Summary — Persistence Layer

**ORM detected:** Hibernate (via @Entity annotations, SessionFactory config)

**Entity catalog ({N} total):**
  Identity              — {backend_path}/object/Identity.java — 47 fields, 12 relationships
  Certification         — {backend_path}/object/Certification.java — 34 fields, 8 relationships
  {... top 20 by relationship count}

**DAO classes:**
  {count + locations}

**DB connection configured:**
  Primary:  Oracle (via app.properties jdbc.url)
  Test:     PostgreSQL (via hibernate-test.properties)

**Caching layer:**
  Redis: configured via {backend_path}/cache/RedisClient.java
  Cached entity types: Identity, Role, Entitlement (via @Cacheable)

**Migration state:**
  Tool: Liquibase
  Changelog: config/liquibase/master.xml
  Change sets: 142 (last: {date})
```

**For `Rescan frontend/Components` and other narrow scopes:** emit a smaller report focused on that slice (e.g. just the component table + primitives coverage).

**Universal sections at the end of every summary:**

```markdown
**Rescan metadata:**
  Command:       {exact user command}
  Scope:         {what was rescanned}
  Phases run:    {list}
  Duration:      {time}
  Changes:       {added, modified, removed}
  Next rescan hint: {if drift detected in unrelated scope, suggest follow-up}

**Pending rescan hints (from § Pending Rescan):**
  {if project-map has any — list with rescan commands to clear each}
```

**Design choice:** the Summary Report is ALWAYS emitted after a successful `Apply all` or `Apply additions only`. User can't hide it. Rationale — even when a rescan changes nothing, the user may have invoked it specifically to AUDIT the current state ("show me everything you see"). The Summary delivers that value independently of whether a diff was applied.

**Token cost:** Non-trivial but bounded (~200-400 lines per report). Report regenerates content that already lives in project-map.md sections — this is a VIEW, not new analysis. No re-scanning.

### When to use which command

| Situation | Recommended command |
|-----------|---------------------|
| Pipeline first setup | `Analyze project` |
| Another team merged a big feature | `Rescan project` (full) or `Rescan since {merge-date}` if you know it |
| Added a new npm/maven dependency | `Rescan stack` |
| New framework detected (`Rescan stack` flags it) | Follow-up: `Rescan frontend` or `Rescan backend` |
| Refactored shared AngularJS components | `Rescan AngularJS/Components` |
| Another team added Flask REST endpoints | `Rescan Python/REST` |
| Your Java backend team shipped new services | `Rescan Java/Services` |
| Whole frontend refactor | `Rescan frontend` |
| Whole backend refactor | `Rescan backend` |
| Template/layout restructure | `Rescan templates` |
| `package.json` / `pom.xml` changed | `Rescan build` |
| Directory reorganization | `Rescan folders` (map_folder_structure (Phase 2)) then `Rescan path: {new-location}` |
| Quarterly hygiene | `Rescan project` (full refresh with diff) |
| Suspect one dir is stale | `Rescan path: {dir}` |

### Auto-maintained between rescans

Review PART 5b keeps the map current for changes made BY the pipeline. Rescans are only needed for changes made OUTSIDE the pipeline (other teams, manual edits, dependency upgrades, external merges).

---

## Phase: propose_unconfigured_detections (Phase 8.6, v18)

**Runs after Phase 8.5 and before the pre-write gate.** Surfaces frameworks and shared directories the analyzer detected in the codebase that aren't represented in `pipeline.yaml`. User decides per-item whether to add, create new layer, or ignore.

### Why this phase exists

Previously, detected frameworks were captured in `project-map.md § 1 Tech Stack` (informational) and 🆕 Unmapped Content (with copy-paste stubs). Problem: config edits were manual, error-prone, and easy to forget. If a new framework showed up in your codebase, you'd see a note in project-map but no structured way to decide what to do about it.

Analyzer now elevates these detections to first-class gate decisions. It proposes with context; user approves/rejects per item; analyzer applies with attribution. Never silent, never forced.

### Step: collect_detections (8.6a)

Two detection sources:

```
SOURCE 1: Framework detections (from discover_tech_stack (Phase 1))
  FOR each framework detected in Phase 1 (Django, FastAPI, Conda, Celery, etc.):
    IF framework NOT in any layer_map key AND NOT in any layer_map aliases:
      evidence_count = count of files with framework's signature imports
      IF evidence_count >= rescan_hints.detection_thresholds.framework_min_files (default 3):
        CONFIDENCE:
          HIGH   — framework imports + structural usage (models/routes/schemas)
          MEDIUM — framework imports only, no structural usage
          LOW    — mentioned in config/README only (hidden by default)
        Add to DETECTIONS list

SOURCE 2: Shared directory detections (from Phase 2 + catalog_shared_components (Phase 3))
  FOR each directory name matching shared-dir patterns (shared/, common/, util/,
      utilities/, base/, widgets/, wrappers/, lib/, hooks/):
    IF directory NOT in any shared_paths.*.path:
      file_count = files matching any layer_map path_glob
      IF file_count >= rescan_hints.detection_thresholds.shared_dir_min_files (default 3):
        CONFIDENCE:
          HIGH   — name matches pattern + contains framework-recognized code
          MEDIUM — name matches + contains unrecognized code
        Add to DETECTIONS list
```

### Step: filter_by_ignore (8.6b)

Read `pipeline.yaml.analyzer_ignore:` (user-owned, empty by default). For each entry, check if current detection count has grown past the re-propose threshold:

```
FOR each detection in DETECTIONS:
  matching_ignore = analyzer_ignore.find(detection.name)
  IF matching_ignore exists:
    IF detection.evidence_count >= matching_ignore.evidence_at_ignore_time * 2:
      # Growth triggers re-propose — ignore is stale
      remove from analyzer_ignore list (mark for user confirmation)
      keep detection in DETECTIONS
      add note: "Re-proposing — evidence grew from {old} to {new} files"
    ELSE:
      remove detection from DETECTIONS (still suppressed)
```

User can also explicitly run `Reconsider ignored` to force re-display of the full ignore list for review.

### Step: filter_by_confidence (8.6c)

```
IF user ran `Show low-confidence detections`:
  show all confidence levels
ELSE:
  filter DETECTIONS to HIGH + MEDIUM only
  count LOW separately, display as footer note:
    "+ 3 low-confidence detections hidden. Run `Show low-confidence detections` to review."
```

### Step: render_proposals_gate (8.6d)

Appended to the pre-write gate output, after Phase 8.5 blocks:

```markdown
## 🔍 Detected but not configured (propose_unconfigured_detections (Phase 8.6))

The analyzer found frameworks/tools/directories in your codebase that aren't
in your pipeline.yaml configuration. Each is proposed with evidence so you
can decide.

───────────────────────────────────────────────────────────────────────────
1. Framework: Django
   Evidence:   22 files in backend/admin_panel/ with `from django.db import models`
               14 files with Django URL patterns
               3 files with Django admin registrations
   Confidence: HIGH (framework imports + structural usage + admin setup)

   Option A — Append to existing Backend/Python layer aliases:
     aliases: [python, flask, django]   ← enables `Rescan Django` command

   Option B — Create new Backend/Django layer (separate rescan scope):
     "Backend/Django":
       skills: []   # add a pack-specific Django standards skill if created
       path_glob: "backend/admin_panel/**"
       language: python
       aliases: [Django]
       desc: "Django admin models + views"

   Option C — Ignore (not a primary framework; legacy admin tool)

   > 👉 Pick one:
   >   - Apply A          — append alias to existing layer
   >   - Apply B          — create new Backend/Django layer
   >   - Ignore           — suppress until evidence grows 2x
   >   - Details          — show the 22 files that triggered this
   >   - Defer            — skip for now, re-propose next rescan

───────────────────────────────────────────────────────────────────────────
2. Framework: FastAPI
   Evidence:   8 files in backend/v2_api/ with `from fastapi import FastAPI`
               6 route definitions + 4 Pydantic schemas
   Confidence: HIGH
   {same A/B/C options structure}

───────────────────────────────────────────────────────────────────────────
3. Shared directory: backend/utils/shared/
   Evidence:   14 Python files (framework-recognized: Flask helpers)
               Directory matches `shared` pattern from rescan_hints
   Confidence: HIGH

   Option A — Append to shared_paths.backend.utilities:
     - path: "backend/utils/shared/"
       language: python
       framework: Flask
       extensions: [.py]
       provides: [<analyzer populates on next rescan>]

   Option B — Ignore (not actually shared — internal-only utilities)

   > 👉 Pick one: [...]

───────────────────────────────────────────────────────────────────────────
4. Build tool: Conda
   Evidence:   environment.yml in project root
               3 conda-build references in scripts/
   Confidence: MEDIUM (build tool, not a framework — informational)

   Option A — Record in § 1 Tech Stack only (no layer_map change)
   Option B — Ignore

   > 👉 Pick one: [...]

───────────────────────────────────────────────────────────────────────────

4 proposals. Decide individually or use batch operations:
  > `Apply all A`         — approve all Option A proposals (shows preview first)
  > `Apply all B`         — approve all Option B proposals (shows preview first)
  > `Ignore all`          — suppress all until evidence grows
  > `Decide one by one`   — default if no batch selection

+ 2 low-confidence detections hidden. Run `Show low-confidence detections` to review.
```

### Step: apply_selections (8.6e)

**When user selects per-item (e.g. "Apply A" for item 1):**

```
1. Show diff preview of the pipeline.yaml change BEFORE writing:
   ┌─────────────────────────────────────────────────────────────┐
   │ @@ skills.layer_map["Backend/Python"] @@                     │
   │    aliases:                                                   │
   │      - python                                                 │
   │      - flask                                                  │
   │ +    - django   # added by project-analyzer 2026-04-19        │
   │ +              # detected: 22 files in backend/admin_panel/   │
   └─────────────────────────────────────────────────────────────┘

   > 👉 `Confirm` — apply this change
   >    `Cancel`  — revert to gate, pick different option

2. On Confirm:
   WRITE the edit with attribution comment to the file that owns the block:
     - skills.layer_map / skills.extra_triggers   → pipeline.{PACK}.skills.yaml
     - analyzer_ignore                            → pipeline.{PACK}.analyzer.yaml
     - intent_classification.verb_synonyms        → pipeline.{PACK}.yaml (core)
   The comment preserves the reason across future rescans.

3. On Cancel:
   Return to the gate block; user picks a different option
```

**When user selects batch operation (e.g. "Apply all A"):**

```
1. Show CONSOLIDATED diff preview of ALL proposed Option-A changes:
   ┌─────────────────────────────────────────────────────────────┐
   │ @@ 1. Django — Option A @@                                    │
   │ {diff fragment}                                               │
   │                                                               │
   │ @@ 2. FastAPI — Option A @@                                   │
   │ {diff fragment}                                               │
   │                                                               │
   │ @@ 4. Conda — Option A @@                                     │
   │ {diff fragment}                                               │
   └─────────────────────────────────────────────────────────────┘
   Item 3 (shared dir) has no Option A matching batch type — skipped.

   > 👉 `Confirm all`       — apply all changes above
   >    `Review one by one` — walk through each instead
   >    `Cancel`            — revert to gate
```

**On Ignore:**

```
1. Append to analyzer_ignore (in pipeline.{PACK}.analyzer.yaml):
   - framework: Django
     reason: "{user-provided optional reason, or 'user choice' if skipped}"
     ignored_on: 2026-04-19
     evidence_at_ignore_time: 22

2. Prompt: "Reason for ignoring (optional, one line):"
   If user provides reason: store it; else: "user choice"

3. Re-propose threshold: 2x evidence_at_ignore_time (default).
   Configurable per-item via:
     analyzer_ignore:
       - framework: Django
         evidence_at_ignore_time: 22
         repropose_at: 100   # override default 2x (=44)
```

**On Defer:** no pipeline.yaml change. Item re-proposed on next analyzer run.

### Step: rerun_affected_phases (8.6f)

Applied changes in pipeline.yaml affect downstream phase output. After user confirms all edits:

```
IF any layer_map changes applied:
  → rerun catalog_shared_components (Phase 3), 3b, 4 (affected stacks) against NEW layer_map
  → project-map.md gets updated sections

IF any shared_paths changes applied:
  → rerun catalog_shared_components (Phase 3), 3b (detection) for newly mapped shared directory
  → provides[] auto-populated per Signal 1b suffix parsing

Emit updated Summary Report reflecting the new configuration.
```

This is what makes the gate actually USEFUL — not just "here's a stub, paste it yourself" but "apply this, and I'll rescan correctly."

### Step: hard_rules (8.6g)

1. **No silent edits.** Every pipeline.yaml write shows a diff + requires Confirm.
2. **Attribution comments preserved across rescans.** The `# added by project-analyzer 2026-04-19` comment stays. Users can remove it manually if desired; analyzer never rewrites it.
3. **User-provided config never touched.** If user hand-edited `aliases: [python, flask, something-custom]`, only NEW entries append. Existing entries preserved byte-for-byte.
4. **Ignore list is permanent until growth.** An ignored item doesn't re-propose just because time passed — evidence count must grow. Prevents nagging.
5. **`Reconsider ignored` is the escape valve.** User explicitly opts into reviewing all ignored items; analyzer then shows them with current evidence counts.
6. **LOW confidence default-hidden.** Respects Rule 4 from Phase 8.5 — don't flood users with weak signals.

### Step: emit_skill_authoring_recommendations (8.6h)

**Why this step exists.** Phase 8.6a–g is about *layer_map* coverage — does the YAML config know about every framework in the repo? But a layer can be **configured AND empty**: `skills: []` or pointing at a skill file that doesn't exist on disk. The pipeline still works (Surgeon falls back to kernel defaults), but quality drops — the standards skill is the agent's project-specific coding playbook for that layer. Empty layer = generic agent on a domain-specific codebase.

This step surfaces those gaps as authoring recommendations. It does NOT auto-create skill files (user-confirmed scope: skills only, no rules, no auto-stub). It tells the user *what to write* and *where it goes*.

**Read `rescan_hints.skill_recommendations.enabled` (default `true`)** — if `false`, skip this step.

#### Detection logic (8.6h.1)

Two sources of skill gaps:

```
SOURCE 1: Configured layer with empty/missing skill body
  FOR each entry in skills.layer_map:
    declared_skills = entry.skills (default: [])
    file_evidence_count = count of files matching entry.path_glob (from Phase 1/2 scan)

    IF file_evidence_count >= rescan_hints.skill_recommendations.min_files (default 3):
      FOR each skill_filename in declared_skills:
        skill_path = packs/{pack}/skills/{skill_filename}
        IF skill_path does NOT exist OR file size < 500 bytes (stub file):
          add to GAPS with reason="missing_file" or reason="stub_file"
      IF declared_skills is empty:
        add to GAPS with reason="no_skill_declared"

SOURCE 2: Newly accepted Phase 8.6 layer (no skill yet)
  FOR each detection user accepted in Phase 8.6 with Option B (new layer created):
    The new layer ships with `skills: []` by default —
    add to GAPS with reason="newly_added_layer", framework=detection.framework
```

A layer with `skills: []` is intentional ONLY if `path_glob` is also absent (e.g., the `Test` layer that resolves by Layer-string only). Skip those.

#### Topic outline lookup (8.6h.2)

For each gap, the analyzer composes a **suggested coverage outline** — what the skill should teach the agent. Built-in heuristics by framework:

```
FRAMEWORK_COVERAGE_HINTS:
  Angular18:
    coverage:
      - "Component pattern (NgModule-based, selector prefix, takeUntil cleanup)"
      - "Service pattern (HttpClient, providedIn vs providers)"
      - "Module structure (declarations, imports, providers)"
      - "Reactive forms (FormGroup, validators)"
      - "RxJS operators (switchMap, combineLatest, takeUntil)"
      - "NgRx (only if state management complexity warrants it)"
    reference_skill: your-project-angular18-standards.md

  Angular19:
    coverage:
      - "Standalone components (default — NO NgModule)"
      - "Signal-based reactivity (signal, computed, effect)"
      - "input() / output() function APIs over decorators"
      - "inject() function over constructor DI"
      - "New control flow (@if, @for, @switch)"
      - "Zoneless change detection (if enabled)"
    reference_skill: your-project-angular19-standards.md

  React:
    coverage:
      - "Function components only — no class components"
      - "Hooks (useState, useEffect cleanup, useReducer, custom hooks)"
      - "Data fetching (TanStack Query / SWR over hand-rolled useEffect)"
      - "Forms (react-hook-form + zod for non-trivial cases)"
      - "Performance (when to memo / useMemo / useCallback — not by default)"
    reference_skill: your-project-react-standards.md

  Vue3:
    coverage:
      - "<script setup> + Composition API (NOT Options API)"
      - "ref vs reactive — when each applies"
      - "computed for derived state, watch for side effects"
      - "Pinia (setup-style stores) — NOT Vuex"
      - "Composables for shared logic (NOT mixins)"
    reference_skill: your-project-vue3-standards.md

  Spring Boot:
    coverage:
      - "Constructor injection only (no @Autowired on fields)"
      - "@RestController + @Service + @Repository layering"
      - "@Transactional on service layer"
      - "DTO mapping (records for request/response, NOT entities)"
      - "jakarta.* imports (Spring Boot 3 — NOT javax.*)"
      - "Exception handling via @ControllerAdvice"
    reference_skill: your-project-java-standards.md (extend or split out)

  Django:
    coverage:
      - "Project structure (apps, models, views, URLs, settings)"
      - "ORM patterns (QuerySet chaining, select_related, prefetch_related)"
      - "Class-based vs function-based views"
      - "Forms and ModelForms"
      - "Migrations (makemigrations + migrate; never edit applied migrations)"
      - "Admin customization patterns"

  FastAPI:
    coverage:
      - "Pydantic models for request/response validation"
      - "Dependency injection via Depends()"
      - "Async route handlers — when async vs sync matters"
      - "Path operation organization (APIRouter)"
      - "OpenAPI doc customization"

  Express / Node:
    coverage:
      - "Async route handlers — wrap or use express-async-errors"
      - "Middleware order (logging → auth → routes → error)"
      - "Validation (zod / express-validator)"
      - "Error handling middleware (4-arg signature)"

  PostgreSQL / MySQL:
    coverage:
      - "Schema conventions (snake_case tables, plural names, surrogate keys)"
      - "Index strategy (covering, partial, expression indexes)"
      - "Migration tooling (Flyway / Liquibase / Alembic / Prisma)"
      - "JSONB usage rules (when to denormalize vs proper relational)"

  # Fallback for unknown framework — generic outline
  __default__:
    coverage:
      - "File and identifier naming conventions"
      - "Module / package layout"
      - "Error handling pattern"
      - "Testing pattern (framework, structure, what's mocked)"
      - "Common pitfalls specific to this framework"
```

Lookup order: exact framework name → framework family (e.g., `Angular18` falls back to `Angular`) → `__default__`.

#### Render block (8.6h.3 — transient, appended to gate)

Appended to the pre-write gate output, AFTER the Phase 8.6d "Detected but not configured" block:

```markdown
## 💡 Skill Authoring Recommendations

The analyzer found layers with file evidence in your repo but no project-specific
standards skill. The pipeline works without these — Surgeon falls back to kernel
defaults — but a project-tuned skill makes the agent's output match your team's
actual conventions instead of generic best-practice.

These are recommendations only. The analyzer does NOT auto-create skill files.

───────────────────────────────────────────────────────────────────────────
1. Layer:    Frontend/Angular19
   Status:   Configured, but `skills: []` (no skill declared)
   Evidence: 142 .ts files in frontend/src/, signal() usage detected,
             standalone components dominant

   Suggested skill: packs/{pack}/skills/{pack}-angular19-standards.md
   Suggested coverage:
     • Standalone components (default — NO NgModule)
     • Signal-based reactivity (signal, computed, effect)
     • input() / output() function APIs over decorators
     • inject() function over constructor DI
     • New control flow (@if, @for, @switch)
     • Zoneless change detection (if enabled)
   Reference:  packs/your-project/skills/your-project-angular19-standards.md

   After authoring, wire it in pipeline.{pack}.yaml:
     skills.layer_map["Frontend/Angular19"].skills:
       - {pack}-angular19-standards.md

───────────────────────────────────────────────────────────────────────────
2. Layer:    Backend/Java (Spring Boot 3 detected)
   Status:   `skills: [{pack}-java-standards.md]` declared but FILE NOT FOUND
             (expected packs/{pack}/skills/{pack}-java-standards.md)

   Suggested coverage (Spring Boot extension):
     • Constructor injection only (no @Autowired on fields)
     • @RestController + @Service + @Repository layering
     • @Transactional on service layer
     • DTO mapping (records for request/response, NOT entities)
     • jakarta.* imports (Spring Boot 3 — NOT javax.*)
     • Exception handling via @ControllerAdvice
   Reference:  packs/your-project/skills/your-project-java-standards.md

   {Identical wiring instructions — file already declared, just needs to exist}

───────────────────────────────────────────────────────────────────────────
3. Layer:    Backend/Database (PostgreSQL 15 detected)
   Status:   No layer in skills.layer_map. (Phase 8.6d already proposed the
             layer entry; this is the skill-side companion.)
   Evidence: 18 migration files in db/migrations/, JSONB columns in 4 tables

   Suggested skill: packs/{pack}/skills/{pack}-postgres-standards.md
   Suggested coverage:
     • Schema conventions (snake_case, plural names, surrogate keys)
     • Index strategy (covering, partial, expression indexes)
     • Migration tooling (Flyway / Liquibase / Alembic / Prisma)
     • JSONB usage rules (when to denormalize vs proper relational)
   Reference:  none in your-project pack — write fresh

───────────────────────────────────────────────────────────────────────────

3 layers without project-specific skills. Pipeline will use kernel defaults
until you author them.

> 👉 Options:
>   `Show topics for {N}`     — expand suggested coverage with example code blocks
>   `Mark {N} as 'using kernel default'` — record the choice; suppress until
>                                          repo evidence grows 2x
>   `Defer all`               — re-recommend on next analyzer/rescan run

{If all configured layers have skill files:}
  ✓  Every configured layer has a skill file. No authoring gaps detected.
```

#### Suppression and ignore (8.6h.4)

User can mark a layer as "kernel default is fine for this project":

```yaml
# Appended to pipeline.{pack}.analyzer.yaml
skill_recommendations_ignore:
  - layer: "Backend/Database"
    reason: "no project-specific DB conventions yet"
    ignored_on: 2026-05-08
    evidence_at_ignore_time: 18
    repropose_at: 36   # 2x evidence default; user-tunable
```

Same growth-triggered re-propose mechanism as Phase 8.6 ignore-list (Rule 4 from 8.6g).

#### Hard rules (8.6h.5)

1. **Recommendations only.** Never auto-create skill files. The user's authorship is the whole point — generic stubs would be worse than no skill.
2. **Reference the your-project pack when relevant.** If a comparable skill exists in `packs/your-project/skills/`, link it as a reference for the user to copy and adapt.
3. **Topic outlines are descriptive, not prescriptive.** They say "cover X" not "the rule for X is Y" — the user decides their team's actual rule.
4. **Silent on first run if no pack file exists.** If `packs/{pack}/` doesn't exist (e.g., user is running `--no-pack`), this step is skipped entirely.
5. **One recommendation per layer.** Even if a layer's `skills:` list has 3 missing files, emit ONE recommendation block per layer with all gaps consolidated.

### Example: full lifecycle

Day 0 — Fresh Python-stack project `Analyze project`:
- Detects: Flask (primary), Conda (build tool), pytest (testing)
- layer_map has Backend/Python with aliases [python, flask]
- propose_unconfigured_detections (Phase 8.6): no proposals (all detected frameworks are already represented)

Day 30 — Team adds a Django admin panel in `backend/admin_panel/`:
- User runs `Rescan Python`
- Phase 8.6 detects Django, 22 files, HIGH confidence, not in aliases
- Proposes Option A (append alias) / Option B (new layer) / Option C (ignore)
- User picks Option A
- Preview: `aliases: [python, flask, +django # added ...]`
- User confirms
- pipeline.yaml updated, Phase 3 rerun, `Rescan Django` now valid command

Day 60 — Team prototypes FastAPI in `backend/v2_api/`, 2 files only:
- Phase 8.6 detects FastAPI, 2 files → below 3-file threshold → not proposed
- Info captured in § 1 Tech Stack only

Day 90 — FastAPI grows to 8 files:
- Phase 8.6 detects FastAPI, 8 files, HIGH confidence → proposed
- User picks Option B (separate layer — wants distinct rescan)
- pipeline.yaml gets new Backend/FastAPI entry

Day 120 — Conda usage expands significantly:
- User had ignored Conda originally (evidence: 3 files). Now evidence: 12 files.
- 12 >= 3 * 2 = 6 → growth threshold exceeded
- Phase 8.6 re-proposes Conda with note: "Re-proposing — evidence grew from 3 to 12 files"

---

## Phase: extract_data_contracts (Phase 9)

For each REST endpoint discovered in catalog_rest_endpoints (Phase 5), extract its request body schema, response schema, and query parameter contract. This is what lets Orchestrator write precise LLD tasks ("the POST body must include `dueDate` as ISO8601") instead of vague ones ("POST to certifications endpoint").

### Step: openapi_fast_path (9a)

```bash
# Check for generated API spec — $EXCLUDE_FLAGS from Step 0.1
find . -type f $EXCLUDE_FLAGS \
       \( -name "openapi.json" -o -name "openapi.yaml" -o -name "swagger.json" \
          -o -name "api-docs" \) 2>/dev/null | head -5

# For Spring Boot + springdoc-openapi:
curl -s http://localhost:{port}/v3/api-docs 2>/dev/null

# For FastAPI:
curl -s http://localhost:{port}/openapi.json 2>/dev/null
```

**If found:** parse directly. Every endpoint has request/response schemas, required fields, types, validation rules already resolved. Map each `operationId` to the Resource class found in catalog_rest_endpoints (Phase 5).

### Step: framework_extraction (9b — fallback)

When no OpenAPI spec exists, extract from annotations / type hints / DTOs per framework.

**Java + JAX-RS (Jersey, Spring):**
```bash
# Request body: look for @RequestBody or method params without annotation
# Response: look at return type and trace through service + DTO classes

grep -E "@(RequestBody|POST|PUT|PATCH)" *.java | while read line; do
  # Extract method signature
  # Find param class → open class file → extract fields + @NotNull/@Size annotations
  # Find return type → trace through → extract response DTO fields
done
```

**Spring Boot:**
```bash
# @RequestBody classes + javax.validation annotations
# @ResponseBody / ResponseEntity<T> — extract T's fields
# Bean Validation: @NotBlank, @Size, @Email, @Pattern, @Min/@Max
```

**Python FastAPI:**
```bash
# Pydantic BaseModel classes in body/response
# response_model= parameter on decorators
# type hints on path params, query params
grep -B 2 "@app.post\|@router.post" *.py
# Parse function signature: def create_cert(cert: CertificationCreate) -> CertificationResponse
# Open CertificationCreate class → extract fields + Field() validators
```

**Python Flask:**
```bash
# marshmallow schemas, flask-pydantic, or raw request.json access patterns
# No type system enforcement by default — extract fields from request.json reads + model classes
grep -E "request\.json|request\.get_json|schema\.load" *.py
```

**Node Express + TypeScript:**
```bash
# Zod schemas, class-validator DTOs, or inline interface types
# Look for: req.body as XType, schema.parse(req.body), @Body() param
```

### Step: classify_and_normalize (9c)

For each endpoint, produce a normalized contract:

```yaml
endpoint: /rest/ui/certifications
method: POST
request_body:
  type: CertificationCreate
  fields:
    - { name: name, type: string, required: true, max_length: 128 }
    - { name: type, type: enum, values: [group, individual], required: true }
    - { name: reviewers, type: "User[]", required: true, min_items: 1 }
    - { name: dueDate, type: "string(ISO8601)", required: true }
    - { name: notes, type: string, required: false, max_length: 500 }
response:
  status_code: 201
  type: Certification
  fields:
    - { name: id, type: "string(UUID)" }
    - { name: name, type: string }
    # ... full list
query_params: []  # POST takes no query params
path_params: []

endpoint: /rest/ui/certifications
method: GET
request_body: null
response:
  type: "{ items: CertificationSummary[], total: int, page: int, size: int }"
  paginated: true
query_params:
  - { name: type, type: enum, values: [group, individual] }
  - { name: status, type: enum, values: [active, expired, pending] }
  - { name: owner, type: string, note: "user id" }
  - { name: page, type: int, default: 0 }
  - { name: size, type: int, default: 50 }
```

### Confidence levels (4-tier emission protocol — W2)

Every endpoint contract emitted by Phase 9 carries exactly one confidence tier. Orchestrator, Explorer, and Surgeon each consume the tier differently (see their agent prompts for tier-specific behavior).

| Tier | Source | What analyzer emits | Orchestrator behavior |
|------|--------|---------------------|-----------------------|
| **HIGH** | OpenAPI/Swagger spec; typed framework with runtime validation (FastAPI + Pydantic, Spring + @Valid, Zod, class-validator) | Full request + response schemas with types, required flags, constraints (min/max/pattern) | Generate precise LLD task with exact field list |
| **MEDIUM** | Typed framework without validation OR partial schema (method signature + some params, body shape inferred) | Partial schema — method + path + query params; body marked `inferred_from_consumer` or `incomplete` | LLD task with known params listed, body marked "Explorer must confirm via Phase E.2d wiring" |
| **LOW** | Untyped framework (Flask, Express without TS, raw servlet); contract extracted from code heuristics (dict keys referenced, `request.form['X']`) | Best-effort fields with confidence note per field | LLD task treats contract as heuristic; Surgeon must read consumer fully |
| **NONE** | Generic handler, dynamic routing (`/rest/dispatch/{action}`), reflection-based, or endpoint found by Phase 10 consumer grep but no resource class identified | Endpoint exists, contract marked `not_extractable`, reason field populated | LLD task treats endpoint as opaque; HALT for user if no consumer findable |

**Emission format (per endpoint in project-map.md § 6):**

```yaml
endpoint: /rest/ui/certifications
method: POST
contract_confidence: HIGH
contract_source: "openapi:swagger.json#/paths/~1rest~1ui~1certifications/post"
request_body:
  type: CertificationCreate
  fields:
    - { name: name, type: string, required: true, max_length: 128 }
    # ... full list
response:
  status_code: 201
  type: Certification

---

endpoint: /rest/ui/bulk
method: POST
contract_confidence: MEDIUM
contract_source: "code:{backend_path}/web/rest/BulkResource.java:145"
known_params:
  - { name: actionIds, type: "string[]", required: true, note: "extracted from @RequestParam" }
body_shape: inferred_from_consumer
inferred_note: "Method signature has `Map<String, Object> body` — no field-level schema"

---

endpoint: /rest/ui/dispatch
method: POST
contract_confidence: NONE
contract_source: null
not_extractable_reason: "Generic handler — action dispatch via body['action'] field; 14 distinct actions dispatched, no unified schema"
consumer_hint: "{frontend_path}/admin/dispatchHelper.js:45 — read for usage pattern"
```

**Confidence downgrade rule:** If Phase 9 extraction fails for any field in a HIGH-confidence endpoint, the endpoint gets downgraded to MEDIUM (not silently truncated). Same for MEDIUM → LOW. This way Orchestrator always knows when to trust the schema vs when to escalate to consumer-reading.

**Why 4 tiers, not 3:** NONE is semantically different from LOW. LOW means "I guessed; my guess might be wrong." NONE means "I couldn't guess at all — treat this endpoint as opaque." Downstream agents need that distinction: LOW still produces a best-effort LLD task; NONE requires a different path (either find a consumer or HALT).

### Step: store_contracts (9d)

---

## Phase: build_consumer_graph (Phase 10)

Links frontend files → backend endpoints → services → DAOs → DB tables. This builds the **stack trace** for every feature, so Orchestrator knows not just "this endpoint exists" but "this endpoint is consumed by 3 features in 2 different frontend stacks, and here's the idiomatic way each stack uses it."

Also detects when a single component is used across **semantically distinct purposes** — the "overloaded component" signal.

### Step: build_fe_be_edges (10a)

For each REST endpoint from catalog_rest_endpoints (Phase 5), find every consumer in the codebase:

```bash
for endpoint in $(list_endpoints); do
  # Normalize path pattern — strip path variables: /certifications/{id} → /certifications/
  pattern=$(normalize "$endpoint")

  # Search frontend code for this path — $GREP_EXCLUDE_FLAGS from Step 0.1
  grep -rln $GREP_EXCLUDE_FLAGS "'$pattern\|\"$pattern" \
    $(yaml_get shared_paths.frontend[].path) \
    --include="*.js" --include="*.ts" --include="*.tsx" --include="*.jsx" --include="*.vue"
done
```

For each consumer file, capture:
- Path
- Frontend stack (AngularJS / Angular18 / React / Vue / Next.js — from layer_map)
- Feature folder (e.g. `{frontend_path}/identity/` → feature "identity")
- Call site context (surrounding 10 lines around the call)

Output: `endpoint → [consumer, consumer, ...]` edges.

### Step: build_be_internal_graph (10b — endpoint → service → DAO → table)

For each Resource class from catalog_rest_endpoints (Phase 5), trace downstream through the backend:

```bash
# Java example:
# CertificationResource.list() calls FilterService + CertificationDAO
# CertificationDAO queries Hibernate session on Certification entity
# Certification entity maps to `cert` table (from @Table annotation or .hbm.xml)

grep -E "(@Inject|@Autowired|private final)" CertificationResource.java
# → FilterService, PaginationService, CertificationDAO

# Open each dependency, trace deeper:
# CertificationDAO.findAll() → session.createQuery("FROM Certification WHERE ...")
# Certification.java @Table(name="cert") → table `cert`
```

**For Flask/SQLAlchemy:**
```bash
# Blueprint route → service function → model class → __tablename__
grep -E "from .* import|db\.session\.query\(|\.query\.filter" *.py
```

**For Express/ORM (Prisma, TypeORM):**
```bash
grep -E "prisma\.\w+\.|getRepository\(" *.ts
```

### Step: classify_button_intents (10c — YAML decision tree)

For every button/clickable element in the codebase (shared and feature-local), classify intent into one of seven categories. This is what lets Orchestrator generate AC-appropriate LLD tasks downstream ("destructive-confirm" tasks require AC for confirmation text + undo; "navigation" tasks require AC for destination state; "bulk-action" requires AC for batch size limits).

**The seven intents:**

| Intent | Meaning | Representative labels |
|--------|---------|----------------------|
| `destructive-confirm` | Deletes/modifies data irreversibly, WITH confirmation | Delete, Remove, Revoke, Terminate, Cancel Subscription |
| `destructive-immediate` | Resets/clears state irreversibly, NO confirmation | Clear, Reset, Discard |
| `submit` | Writes a form's data to a backend | Save, Submit, Create, Update |
| `navigation` | Routes to another view, no data mutation | View, Open, Details, Next, Back |
| `async-action` | Triggers backend work, returns success/failure | Export, Generate, Approve, Certify, Publish |
| `toggle` | Flips a boolean state (local or via PATCH) | Enable, Disable, Show, Hide, Expand, Collapse |
| `bulk-action` | Applies an action to multiple selected items | Approve Selected, Bulk Reassign, Delete All |

**Decision tree (execute in priority_order, first match wins unless tiebreakers apply):**

```yaml
intent_classification:

  # Verb lexicons — packs can extend via intent_classification.verb_synonyms
  # in pipeline.yaml (project-specific additions merge with these defaults).
  verbs:
    destructive: [delete, remove, revoke, terminate, cancel, purge, drop, destroy, unassign]
    reset:       [clear, reset, discard, abandon]
    submit:      [save, submit, create, update, apply, confirm, add, register]
    navigate:    [view, open, details, next, back, previous, go, browse, show]
    async:       [export, generate, approve, certify, publish, send, run, trigger, process]
    toggle:      [enable, disable, show, hide, expand, collapse, activate, deactivate, pin, unpin]
    bulk_prefix: [bulk, all, selected, multiple, batch]

  priority_order:

    # 1. BULK — highest priority; bulk prefix overrides everything
    - check: bulk-action
      signals:
        - match: "label starts with any verbs.bulk_prefix OR label ends with 'Selected' / 'All'"
          weight: 3
          required: true
        - match: "handler iterates over selected items (map/forEach on array of IDs)"
          weight: 2
        - match: "http call receives array of IDs in body"
          weight: 2
      min_weight: 3

    # 2. DESTRUCTIVE-CONFIRM — destructive verb + confirmation required
    - check: destructive-confirm
      signals:
        - match: "label_verb in verbs.destructive"
          weight: 3
          required: true
        - match: "confirmation modal within 100 lines (grep for modal|confirm|dialog in handler scope)"
          weight: 2
        - match: "http_method in [DELETE, POST]"
          weight: 1
      min_weight: 4

    # 3. DESTRUCTIVE-IMMEDIATE — reset verb + NO confirmation
    - check: destructive-immediate
      signals:
        - match: "label_verb in verbs.reset"
          weight: 3
          required: true
        - match: "NO confirmation modal in handler scope"
          weight: 2
        - match: "handler calls state-reset function (setX([]), clearX(), resetX())"
          weight: 2
      min_weight: 5

    # 4. SUBMIT — form context or submit verb
    - check: submit
      signals:
        - match: "label_verb in verbs.submit"
          weight: 2
        - match: "ancestor <form> element OR ngSubmit / onSubmit directive"
          weight: 3
        - match: "http_method in [POST, PUT, PATCH] AND body is form-shaped (object, not array)"
          weight: 2
        - match: "formGroup.valid / form.$valid check before submit"
          weight: 1
      min_weight: 4

    # 5. NAVIGATION — router call, no http
    - check: navigation
      signals:
        - match: "handler calls router.navigate | $state.go | router.push | href attribute set"
          weight: 3
          required: true
        - match: "no http call in handler"
          weight: 2
        - match: "label_verb in verbs.navigate"
          weight: 1
      min_weight: 3

    # 6. ASYNC-ACTION — backend work triggered, not form submit
    - check: async-action
      signals:
        - match: "label_verb in verbs.async"
          weight: 2
        - match: "http_method is POST"
          weight: 2
        - match: "success notification / toast shown on response"
          weight: 2
        - match: "NO ancestor <form>"
          weight: 1
        - match: "NO destructive verb (excludes destructive-* which already matched)"
          weight: 1
      min_weight: 4

    # 7. TOGGLE — boolean flip, usually local state or PATCH one field
    - check: toggle
      signals:
        - match: "label_verb in verbs.toggle"
          weight: 3
          required: true
        - match: "handler flips a boolean (!prop | toggle() | X = !X)"
          weight: 2
        - match: "NO http call OR http_method is PATCH with single field"
          weight: 1
      min_weight: 4

  # Tiebreakers — if two intents score equal, apply in order
  tiebreakers:
    # Safety: destructive wins over submit if both match (rare but happens with
    # "Delete and Save" style confirm-and-persist flows — treat as destructive)
    - order: ["destructive-confirm", "destructive-immediate", "bulk-action", "submit",
              "async-action", "navigation", "toggle"]
    - on_remaining_tie: "ambiguous"  # emit both + flag for user review

  fallback: "unknown-intent"  # no rule matched — button has no clear pattern

  # How to handle `required: true` signals:
  # If a signal is marked required and the match is FALSE, that intent is
  # entirely disqualified (not just weight-reduced). This prevents
  # e.g. destructive-confirm firing on a "Save" button that happens to
  # have a confirmation modal (the required destructive verb check fails).
```

**Execution algorithm (for agent):**

```
FOR each button_element in the project:
  # Extract signals once per element
  label          = button's text content (after i18n resolution)
  label_verb     = first-word of label, lowercased, stemmed
  handler_scope  = function body reached from onClick/ng-click/(click)
  http_calls     = grep handler_scope for http.get/post/put/delete/patch, fetch, $http
  ancestor_form  = any <form> or formGroup ancestor in DOM
  has_modal      = grep handler_scope for modal|confirm|dialog services
  router_calls   = grep handler_scope for router.navigate|$state.go|router.push

  # Run checks in priority_order
  matches = []
  FOR each check in priority_order:
    # First verify required signals
    for signal in check.signals where signal.required == true:
      IF signal does not match → check is DISQUALIFIED, break

    # Sum weights of matching signals
    weight = sum(signal.weight for signal in check.signals if signal matches)

    IF weight >= check.min_weight:
      matches.append((check.name, weight))

  # Pick winner
  IF matches is empty → emit fallback ("unknown-intent")
  IF one match → emit that
  IF multiple matches:
    max_weight = max(m.weight for m in matches)
    top = [m for m in matches if m.weight == max_weight]
    IF len(top) == 1 → emit top[0]
    ELSE apply tiebreakers.order; if still tied → emit tiebreakers.on_remaining_tie ("ambiguous")
```

**Output (per button) added to project-map.md § 10:**

```yaml
button_intents:
  - location: "{frontend_path}/certifications/certList.xhtml:87"
    label: "Revoke"
    intent: destructive-confirm
    confidence: HIGH  # all signals matched
    signals_matched: [destructive_verb, confirmation_modal, http_DELETE]

  - location: "{frontend_path}/roles/roleBulk.xhtml:142"
    label: "Approve Selected"
    intent: bulk-action
    confidence: HIGH
    signals_matched: [bulk_prefix, iteration, array_in_body]

  - location: "{frontend_path}/identity/identityDetail.xhtml:56"
    label: "Magic Button"
    intent: unknown-intent
    confidence: LOW
    note: "No rule matched — label ambiguous, no verb detected"

  - location: "{frontend_path}/admin/settings.xhtml:203"
    label: "Apply"
    intent: ambiguous  # tied between submit and async-action
    candidates: [submit, async-action]
    note: "Applied tiebreakers.order → submit wins"
```

**Per-project customization (pack/user config):**

Packs ship the verb lexicons above as defaults. Projects with domain-specific vocabulary (e.g. a security-ops domain might use "Certify" as an async action, "Provision" as a submit) add synonyms in pipeline.yaml:

```yaml
# In pipeline.yaml (packs ship sensible defaults; user appends domain verbs)
intent_classification:
  verb_synonyms:
    async: [certify, provision, reassign, delegate]
    submit: [register, enroll, subscribe]
  # Full override of defaults is possible but rarely needed:
  # verbs: { ... full lexicon ... }
```

Additions merge with the shipped defaults. Full replacement requires the `verbs:` key (overrides everything).

### Step: detect_stack_correlation (10d)

For each pair of (frontend stack, backend endpoint) in the FE→BE edge list, detect patterns:

```
PATTERN 1: Single-stack feature
  feature `identity` uses only AngularJS ({frontend_path}/identity/)
  all identity REST calls come from AngularJS consumers
  → clean single-stack feature, pattern is clear

PATTERN 2: Multi-stack feature (migration in progress)
  feature `certification` has both AngularJS and Angular 18 consumers
  calling the same endpoints
  → migration-in-flight. Orchestrator should note which stack new
    work should target (from project-context.md active migrations)

PATTERN 3: Cross-feature reuse
  /rest/ui/users called by identity/, role/, dashboard/ features
  across both AngularJS and Angular 18
  → high-reuse endpoint. Any new feature needing user data should
    use this, not create a new endpoint.

PATTERN 4: Abandoned / orphan endpoint
  REST endpoint exists but no frontend consumer found
  → either legacy (dead code), internal-only (called by other BE),
    or very new. Flag for user review.
```

### Step: store_consumer_graph (10e)

Each REST endpoint entry gets `Consumers:` and `Stack trace:` subsections.
Each shared component entry gets a `Usage clusters:` subsection when overloaded.

---

## Phase: score_endpoint_reusability (Phase 11)

For each REST endpoint, classify reusability so Orchestrator can make better REUSE vs CREATE decisions.

### Step: score_each_endpoint (11a)

Score on five dimensions (0–2 each, max 10):

| Dimension | 0 | 1 | 2 |
|-----------|---|---|---|
| **Filterability** | No filter params | 1–2 filter params | Generic filter DTO (all fields filterable) |
| **Pagination** | Not paginated | Fixed page size | `?page=` + `?size=` configurable |
| **Field selection** | Fixed response | Include/exclude flags | `?fields=` projection |
| **Response genericity** | Feature-specific shape | Some generic wrapper | Generic `{items, total}` or similar |
| **Consumer diversity** | 1 consumer (build_consumer_graph (Phase 10)) | 2–3 consumers | 4+ consumers across features |

```bash
score_endpoint() {
  local endpoint=$1
  local filter_score=$(count_filter_params "$endpoint")
  local pagination_score=$(detect_pagination "$endpoint")
  local field_score=$(detect_field_selection "$endpoint")
  local response_score=$(classify_response_genericity "$endpoint")
  local consumer_score=$(count_distinct_consumers "$endpoint")

  echo $((filter_score + pagination_score + field_score + response_score + consumer_score))
}
```

### Step: classify_tier (11b)

| Total score | Classification | Meaning |
|-------------|----------------|---------|
| 8–10 | **HIGH** | Generic, well-designed endpoint. Reuse it for new features that fit. |
| 5–7 | **MEDIUM** | Reusable for similar features. Check if your use case fits the existing filter/response shape. |
| 2–4 | **LOW** | Feature-specific. Probably need a sibling endpoint rather than reuse. |
| 0–1 | **FEATURE-LOCAL** | Don't try to reuse. Create a new endpoint. |

### Step: extension_hints (11c)

For MEDIUM/LOW endpoints, extract a hint about what would unlock reuse:

```
/rest/ui/certifications (MEDIUM, score 6)
  Filterable: YES (type, status, owner)
  Paginated: YES
  Field selection: NO
  Response: feature-specific CertificationSummary
  Consumers: 3 (certification, dashboard, reports)
  → Extension hint: "Add ?fields= query param to unlock higher reuse"

/rest/ui/certifications/{id}/reassign (LOW, score 2)
  Filterable: N/A (non-list endpoint)
  Single-purpose action on certification
  → Reuse hint: "None — this is the right shape for its job"
```

---

## Phase: build_layout_graph (Phase 6-enh — Layout Inheritance Graph)

Extension to catalog_templates (Phase 6)'s template discovery. In addition to distinguishing templates from partials, detect how pages inherit from layouts.

### Extraction per templating system

**XHTML / JSF:**
```bash
# <ui:composition template="/pages/layout/main-layout.xhtml">
grep -l "ui:composition template" web/ui/page/**/*.xhtml | while read page; do
  parent=$(grep -oP 'template="\K[^"]+' "$page")
  # Record edge: $page → $parent
done

# <ui:include src="..."> tracks partial includes
```

**Handlebars / Mustache (Express, etc.):**
```bash
# {{> partial-name}} and `layout: 'main'` front-matter
```

**Jinja2 (Flask):**
```bash
# {% extends "base.html" %} + {% include "partial.html" %}
```

**Angular / React / Vue:**
```bash
# Routes with layout wrappers (next.js app/ layouts; angular RouterOutlet hierarchy)
# Typically structural — detect via file system convention (app/(dashboard)/layout.tsx)
```

### Output: inheritance graph section

```markdown
## 7. Templates & Partial Views (enhanced)

### Layout inheritance graph

```
main-layout.xhtml (root)
├── list-page.xhtml (extends main)
│   ├── certification/certList.xhtml (extends list-page) — uses filter-bar, action-toolbar
│   ├── identity/identityList.xhtml (extends list-page) — uses filter-bar, action-toolbar
│   └── role/roleList.xhtml (extends list-page) — uses filter-bar
├── detail-page.xhtml (extends main)
│   ├── certification/certDetail.xhtml (extends detail-page) — uses tab-header, action-toolbar
│   └── identity/identityDetail.xhtml (extends detail-page)
└── dashboard-layout.xhtml (extends main)
    └── dashboard/home.xhtml (extends dashboard-layout)
```

### Partial usage frequency

| Partial | Used by | Used across features |
|---------|---------|----------------------|
| header.xhtml | All pages (via main-layout) | universal |
| filter-bar.xhtml | 12 list pages | 5 features |
| action-toolbar.xhtml | 8 list + 4 detail pages | 4 features |
| pagination.xhtml | 10 list pages | 4 features |
| notification-panel.xhtml | 2 pages | 1 feature — LOW reuse |
```

This inheritance graph lets Orchestrator answer "what layout should a new list page extend?" with the right answer automatically.

---

## How phases 9–11 change downstream behavior

| Agent | Before | After |
|-------|--------|-------|
| **Orchestrator** | "POST to /rest/ui/certifications" (vague) | "POST with `{name, type, reviewers, dueDate}` — dueDate must be ISO8601. Response is Certification DTO. Pattern: AngularJS stack per feature `certification`'s conventions (uses FilterService + PaginationService)." |
| **Orchestrator (reuse decision)** | "Endpoint exists → REUSE" | "Endpoint is HIGH reusability (score 9). Existing filter/pagination support your use case. Consumer examples in IdentityCtrl.js:45, DashboardCtrl.js:22 — copy their call pattern." |
| **Orchestrator (component decision)** | "sp-button exists → USE" | "sp-button is OVERLOADED (5 intent classes). For destructive confirm action, follow the pattern from RoleListCtrl.js:122 which uses sp-confirm-button variant. Plain sp-button is for navigation/action-trigger." |
| **Explorer** | "Find consumer for sp-reviewer-selector" (grep-based) | Consumer list pre-computed in project-map.md. Explorer just looks it up. |
| **Review PART 3 (blast radius)** | grep-based search | Uses pre-computed consumer graph for exact impact analysis. |
| **Ship** | Unchanged | Unchanged. Labels + commits are metadata-level. |

---



The project-analyzer produces **two artifacts** that downstream agents consume:

| File | Purpose | Read by |
|------|---------|---------|
| `contexts/project-map.md` | Human-readable catalog (tech stack, folders, components, endpoints) | Orchestrator (for shared component lookup), Explorer (for scan scope), Surgeon (for build commands), Review (for promotion detection) |
| `contexts/config/pipeline.yaml` (`shared_paths`, `operation_patterns`, `i18n` blocks) | Machine-readable config for reuse discovery | Explorer Step E.0 (reuse discovery), Surgeon Step 0a (reuse verification + i18n check), Orchestrator B.3 (task decomposition) |

One scan → both files populated → no manual config needed. When the user runs `Analyze project`:

1. Scan discovers: tech stack, DB, folders, shared components, REST APIs, services, templates
2. project-map.md gets written with human-readable sections
3. pipeline.yaml's `shared_paths` block gets populated with provides[], language, framework per path
4. pipeline.yaml's `operation_patterns` block gets populated by inspecting how existing code does fetch/create/update/delete
5. pipeline.yaml's `i18n` block gets populated with discovered messages_file path + default allowed/forbidden lists

All subsequent stories use both files — no manual pipeline.yaml editing needed for shared_paths/operation_patterns/i18n.

---

## Rules

- First run creates project-map.md AND auto-populates pipeline.yaml sections
- Subsequent rescans show DIFF before updating both files
- **Preserve user-edited sections in pipeline.yaml** (meta, skills, jira, subagents, runtime.branching, layer_map) — only replace auto-generated sections
- Honor `provides_overridden: true` flags — user customizations persist across rescans
- Scan ONLY — never modify code
- Output is `contexts/project-map.md` (project-level, not per-epic)
- Focus on SHARED/REUSABLE resources — don't catalog every feature file
- Keep component entries compact: name, path, public interface, consumer count
- Group by CATEGORY (buttons, inputs, grids) not by alphabetical order
- REST endpoints: capture path + methods + purpose + **contract + reusability + consumers + stack trace** (phases 9, 10, 11)
- Templates: capture what's reusable + **layout inheritance graph** (Phase 6 enhanced)
- Flag promotion candidates (feature-local used by 3+ features)
- Flag **OVERLOADED components** (4+ distinct intent classes from classify_button_intents (Phase 10c))
- Classify endpoint reusability: HIGH / MEDIUM / LOW / FEATURE-LOCAL (score_endpoint_reusability (Phase 11))
- Rescan always shows DIFF — never silently overwrite
- **Phase ordering:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Later phases depend on earlier phase outputs (Phase 10 needs endpoints from 5 + components from 3; Phase 11 needs consumer counts from 10).
- **Confidence levels** on data contracts (extract_data_contracts (Phase 9)): HIGH (OpenAPI spec / typed framework with validation), MEDIUM (typed framework without validation), LOW (untyped framework, extracted heuristically), OMIT (cannot extract).
- Skip Phase 9 contract extraction for endpoints where confidence would be LOW and the framework is untyped — flag as "contract not extractable" rather than write low-confidence data.
- **Tool Usage Ledger (MANDATORY):** Before rendering the final `[Step N/5] {agent} — DONE` gate, append your run's block to `$TOOL_USAGE_FILE` per `agent-flow.mdc § Tool Usage Tracking`. Block schema, counting rules, and aggregation are defined there — do NOT duplicate the schema in this file. Applies to all run modes (story / bug / bundle / standalone). Skipped block triggers a post-execution-verification warning.
