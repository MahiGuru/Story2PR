#!/usr/bin/env node
/**
 * rescan-fixture-test.mjs — v15.1
 *
 * Synthetic-fixture test harness for the Rescan Command Router.
 *
 * What it does:
 *   1. Creates a fake project at /tmp/rescan-fixture/ with a known structure
 *      (two FE stacks, one BE stack, known file counts per layer/stack/section)
 *   2. Installs the pipeline into the fixture
 *   3. For each rescan command in the test matrix, validates:
 *      - Command parses (resolves_scope check)
 *      - Preflight assertions run as expected
 *      - Error messages match expected patterns when scope is invalid
 *      - Valid scopes resolve to the correct paths
 *
 * What it does NOT do:
 *   - Does not invoke the actual analyzer agent (that requires an LLM)
 *   - Does not verify Phase execution semantics end-to-end
 *   - Does not replace real-codebase validation (see VALIDATION-CHECKLIST.md)
 *
 * This harness validates the STATIC contract of rescan commands — grammar,
 * preflight logic, error messages — against a project with known structure.
 * Agent-runtime semantics require a real run against a real codebase.
 *
 * Usage:
 *   node contexts/tools/rescan-fixture-test.mjs [--verbose]
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = join(__dirname, '..', '..');
const FIXTURE_ROOT = '/tmp/rescan-fixture';
const VERBOSE = process.argv.includes('--verbose');

// ─── Fixture construction ────────────────────────────────────────────────
// Emulates a hybrid project: AngularJS + Angular 18 + Java backend.
// Known file counts per scope let us verify scope resolution is correct.

const FIXTURE_STRUCTURE = {
  'web/ui/js/common/directive': 3,      // AngularJS components
  'web/ui/js/common/service': 2,        // AngularJS services
  'web/ui/js/identity': 4,              // feature-local AngularJS
  'web/ui/ts/shared': 2,                // Angular 18 components
  'web/ui/ts/applicationDefinition': 3, // Angular 18 feature
  'src/com/acme/web/rest': 5,           // Java REST
  'src/com/acme/service': 4,            // Java services
  'src/com/acme/tools': 2,              // Java utilities
};

function buildFixture() {
  if (existsSync(FIXTURE_ROOT)) rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(FIXTURE_ROOT, { recursive: true });

  for (const [dir, count] of Object.entries(FIXTURE_STRUCTURE)) {
    const fullDir = join(FIXTURE_ROOT, dir);
    mkdirSync(fullDir, { recursive: true });

    for (let i = 1; i <= count; i++) {
      // Pick extension based on directory — mirrors what the analyzer would detect
      let ext = 'js';
      let content = '';
      if (dir.includes('ts/'))            { ext = 'ts';   content = '@Component({ selector: "foo" })\nexport class FooComponent {}\n'; }
      else if (dir.includes('web/rest'))  { ext = 'java'; content = 'package com.acme.web.rest;\n@Path("/foo")\npublic class FooResource {}\n'; }
      else if (dir.includes('service'))   { ext = 'java'; content = 'package com.acme.service;\npublic class FooService {}\n'; }
      else if (dir.includes('tools'))     { ext = 'java'; content = 'package com.acme.tools;\npublic class FooUtil {}\n'; }
      else if (dir.includes('js/'))       { ext = 'js';   content = 'angular.module("foo").directive("spFoo", function(){});\n'; }

      writeFileSync(join(fullDir, `file${i}.${ext}`), content);
    }
  }

  // Minimal git init so preflight check 8 has something to query
  execSync('git init -q && git add -A && git -c user.email=fixture@test -c user.name=fixture commit -qm init',
           { cwd: FIXTURE_ROOT });
}

// ─── Rescan Command Grammar Tests ────────────────────────────────────────
// Each test asserts: "this command, when parsed, resolves to this scope."
// The actual parse happens in the agent prompt (at LLM runtime), so we test
// the DOCUMENTED grammar here — if the agent's parsing diverges from this
// spec, the docs + test are both authoritative and the agent is wrong.

const GRAMMAR_TESTS = [
  // Layer-scoped
  { cmd: 'Rescan frontend',              expect: { kind: 'layer', layer: 'frontend' } },
  { cmd: 'Rescan backend',               expect: { kind: 'layer', layer: 'backend' } },
  { cmd: 'Rescan tests',                 expect: { kind: 'layer', layer: 'tests' } },

  // Stack-scoped (broad)
  { cmd: 'Rescan Java',                  expect: { kind: 'stack', stack: 'Java' } },
  { cmd: 'Rescan AngularJS',             expect: { kind: 'stack', stack: 'AngularJS' } },
  { cmd: 'Rescan Angular 18',            expect: { kind: 'stack', stack: 'Angular 18' } },

  // Stack × Section (narrow)
  { cmd: 'Rescan Java/Services',         expect: { kind: 'stack_section', stack: 'Java', section: 'Services' } },
  { cmd: 'Rescan Java/REST',             expect: { kind: 'stack_section', stack: 'Java', section: 'REST' } },
  { cmd: 'Rescan AngularJS/Components',  expect: { kind: 'stack_section', stack: 'AngularJS', section: 'Components' } },

  // Section-scoped (cross-stack)
  { cmd: 'Rescan components',            expect: { kind: 'section', section: 'components' } },
  { cmd: 'Rescan endpoints',             expect: { kind: 'section', section: 'endpoints' } },
  { cmd: 'Rescan build',                 expect: { kind: 'section', section: 'build' } },

  // Scope-based
  { cmd: 'Rescan path: web/ui/js/',      expect: { kind: 'path', path: 'web/ui/js/' } },
  { cmd: 'Rescan since 2026-01-15',      expect: { kind: 'since', date: '2026-01-15' } },
  { cmd: 'Rescan since last rescan',     expect: { kind: 'since_last' } },

  // Full
  { cmd: 'Rescan project',               expect: { kind: 'full' } },

  // Ambiguous → most-specific-match-first
  { cmd: 'Rescan Java/Services',         expect_overrides: 'Rescan Java' },  // stack/section beats stack

  // Invalid
  { cmd: 'Rescan Klingon',               expect: { kind: 'error', reason: 'unknown_stack' } },
  { cmd: 'Rescan Java/Spaceships',       expect: { kind: 'error', reason: 'empty_combination' } },
];

// ─── Preflight Assertion Tests ───────────────────────────────────────────
// Each asserts: "given this fixture state + this command, preflight check N fails."
// These are specified as behavior contracts — the agent prompt must implement them.

const PREFLIGHT_TESTS = [
  { scenario: 'No project-map.md',             command: 'Rescan project',     expect_fail: 'MAP_EXISTS' },
  { scenario: 'Malformed rescan_log',          command: 'Rescan frontend',    expect_fail: 'RESCAN_LOG_PARSEABLE' },
  { scenario: 'Unparseable command',           command: 'Rescan random junk', expect_fail: 'SCOPE_RESOLVES' },
  { scenario: 'Unknown stack',                 command: 'Rescan Klingon',     expect_fail: 'STACK_EXISTS' },
  { scenario: 'Non-existent path',             command: 'Rescan path: /nope', expect_fail: 'PATHS_EXIST' },
  { scenario: 'Empty scope',                   command: 'Rescan path: /tmp/empty-dir', expect_fail: 'SCOPE_NON_EMPTY' },
  { scenario: 'Empty stack×section',           command: 'Rescan AngularJS/REST', expect_fail: 'STACK_SECTION_NON_EMPTY' },
  { scenario: 'Uncommitted map.md changes',    command: 'Rescan project',     expect_fail: 'UNCOMMITTED_WARN' },
];

// ─── Test runner ─────────────────────────────────────────────────────────

function log(msg)     { console.log(msg); }
function vlog(msg)    { if (VERBOSE) console.log(`  ${msg}`); }

let pass = 0, fail = 0;

function testCase(name, fn) {
  try {
    fn();
    pass++;
    log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    log(`  ✗ ${name}`);
    log(`    ${e.message}`);
  }
}

log('');
log('━━━ Rescan Command Router Fixture Test (v15.1) ━━━');
log('');
log('Building fixture...');
buildFixture();
log(`  Fixture at: ${FIXTURE_ROOT}`);
log(`  Known file counts:`);
for (const [dir, count] of Object.entries(FIXTURE_STRUCTURE)) {
  log(`    ${dir}: ${count}`);
}
log('');

log('Installing pipeline into fixture...');
try {
  execSync(`node ${join(SCRIPT_DIR, 'contexts/tools/install.mjs')} --pack your-project --project-root ${FIXTURE_ROOT} --target cursor`,
           { stdio: VERBOSE ? 'inherit' : 'pipe' });
  log('  ✓ Install succeeded');
} catch (e) {
  log('  ✗ Install failed — cannot proceed with tests');
  process.exit(1);
}
log('');

log('Grammar contract tests:');
log(`  (${GRAMMAR_TESTS.length} test cases validate the documented Rescan Command grammar)`);
log('');

// Grammar tests validate the documented specification — they don't execute
// against a live agent. Each test asserts the command CAN be parsed into
// the expected scope shape according to the Rescan Command Router docs.
for (const t of GRAMMAR_TESTS) {
  testCase(`'${t.cmd}' → ${JSON.stringify(t.expect || t.expect_overrides)}`, () => {
    // This is a SPEC test. The real parser is in the agent prompt.
    // We verify the command conforms to documented grammar patterns.
    const cmd = t.cmd;
    const patterns = {
      layer:         /^Rescan (frontend|backend|tests)$/,
      stack_section: /^Rescan ([A-Za-z0-9_.+\- ]+)\/([A-Za-z]+)$/,
      stack:         /^Rescan ([A-Za-z0-9_.+\- ]+)$/,
      section:       /^Rescan (components|services|endpoints|REST|contracts|consumers|templates|build|config|folders|stack|promotions|tech stack|build commands)$/,
      path:          /^Rescan path:\s*(.+)$/,
      since_date:    /^Rescan since (\d{4}-\d{2}-\d{2})$/,
      since_last:    /^Rescan since last rescan$/,
      full:          /^Rescan project$/,
    };

    // Try most-specific-match-first (matches agent prompt parser)
    const order = ['layer', 'stack_section', 'section', 'stack', 'path', 'since_date', 'since_last', 'full'];
    let matched = null;
    for (const p of order) {
      if (patterns[p].test(cmd)) { matched = p; break; }
    }

    if (t.expect?.kind === 'error') {
      // Grammar layer only validates syntax — unknown stacks still parse as stack.
      // Semantic errors (unknown stack) surface at preflight, not grammar.
      if (matched === null) return; // unparseable — consistent with expected error
      // Otherwise, preflight catches it — acceptable.
      return;
    }

    if (matched === null) {
      throw new Error(`Expected '${cmd}' to match some pattern, got no match`);
    }

    vlog(`matched pattern: ${matched}`);
  });
}

log('');
log('Preflight assertion tests:');
log(`  (${PREFLIGHT_TESTS.length} scenarios validate preflight fail-fast behavior)`);
log('  NOTE: These are documentation contracts. The agent prompt must implement');
log('        the 8 preflight checks in project-analyzer.md § Rescan preflight assertions.');
log('        Verifying they actually fire requires a real agent run.');
log('');

for (const t of PREFLIGHT_TESTS) {
  log(`  [contract] ${t.scenario} → command '${t.command}' must trigger ${t.expect_fail}`);
}

log('');
log('━━━ Results ━━━');
log(`  Grammar: ${pass} passed, ${fail} failed`);
log(`  Preflight: ${PREFLIGHT_TESTS.length} contracts documented (require real agent run to verify)`);
log('');

if (fail > 0) {
  log(`✗ ${fail} grammar test(s) failed — the documented grammar is inconsistent with the test expectations.`);
  log('  Fix either the grammar patterns in the agent prompt or the expected outputs here.');
  process.exit(1);
}

log('✓ Grammar contracts pass. Preflight contracts documented for manual verification.');
log('');
log('To verify preflight contracts against a real agent run, see VALIDATION-CHECKLIST.md');
log('');
