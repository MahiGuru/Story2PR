#!/usr/bin/env node
/**
 * mcp-roles-fixture-test.mjs — PR 1 tests for mcp_roles + mcp_guidance
 *
 * Scope: validator checks V1–V4 added in PR 1.
 * No behavior change to live agent runs; only config-level validation.
 *
 * Usage:
 *   node contexts/tools/mcp-roles-fixture-test.mjs [--verbose]
 *
 * Exit codes: 0 — all cases pass, 1 — any case failed.
 *
 * How it works: each fixture is a minimal parsed-config object passed
 * directly to validate(). We then assert on the presence / absence of
 * specific substrings in the resulting Report's errors/warnings. We
 * deliberately ignore unrelated validator messages — fixtures are
 * minimal and will naturally produce noise from checks that aren't
 * relevant to mcp_roles. Substring matching is sufficient for V1–V4.
 */

import { validate } from './validate.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const VERBOSE = process.argv.includes('--verbose');

// ── Fixture scaffolding ──────────────────────────────────────────────────
// Minimum required top-level shape so the main validator doesn't bail
// before reaching our Check 11. `mcp_roles` / `mcp_guidance` / `mcp_servers`
// are overlaid per fixture.
function baseFixture(overlay = {}) {
  return {
    meta: { schema_version: 2, pack: 'testpack' },
    skills: { layer_map: { 'Backend/Test': { skills: [], build: 'build-test' } } },
    builds: { commands: { 'build-test': { cmd: 'echo test' } } },
    ...overlay,
  };
}

// Convenience: call validate() and return errors + warnings as joined strings
// so tests can substring-match easily.
function run(overlay) {
  const [report] = validate(baseFixture(overlay), REPO_ROOT, 'fixture');
  return {
    errors: report.errors,
    warnings: report.warnings,
    all: [...report.errors, ...report.warnings].join('\n'),
  };
}

// ── Assertion helpers ────────────────────────────────────────────────────
let passed = 0, failed = 0;
const results = [];

function assert(name, cond, detail = '') {
  if (cond) { passed++; results.push({ name, ok: true }); }
  else      { failed++; results.push({ name, ok: false, detail }); }
}

function containsInErrors(report, substr)   { return report.errors.some(m => m.includes(substr)); }
function containsInWarnings(report, substr) { return report.warnings.some(m => m.includes(substr)); }
function notContainsInErrors(report, substr){ return !report.errors.some(m => m.includes(substr)); }

// ═════════════════════════════════════════════════════════════════════════
// V1 — all four mandatory role keys must be present
// ═════════════════════════════════════════════════════════════════════════

// F1a · all four roles present → no V1 errors
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   github:    { auth: 'token', config: { command: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: 'github', docs_source: 'atlassian',
    },
    mcp_guidance: {},
  });
  assert('F1a · all four roles declared → no role-missing errors',
    notContainsInErrors(report, 'is mandatory'),
    VERBOSE ? JSON.stringify(report, null, 2) : '');
}

// F1b · missing one role (vcs) → V1 error
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      docs_source: 'atlassian',
      // vcs missing
    },
  });
  assert('F1b · missing mcp_roles.vcs → error names it',
    containsInErrors(report, 'mcp_roles.vcs: missing'));
}

// F1c · missing multiple roles → multiple V1 errors
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } } },
    mcp_roles: { story_source: 'atlassian' },
  });
  assert('F1c · missing three roles → three errors',
    containsInErrors(report, 'mcp_roles.design_source: missing') &&
    containsInErrors(report, 'mcp_roles.vcs: missing') &&
    containsInErrors(report, 'mcp_roles.docs_source: missing'));
}

// F1d · entire mcp_roles block absent → warning (not error, for back-compat)
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } } },
    // no mcp_roles
  });
  assert('F1d · mcp_roles missing entirely → warning (back-compat path)',
    containsInWarnings(report, 'mcp_roles: missing'));
}

// ═════════════════════════════════════════════════════════════════════════
// V2 — every mcp_roles value must reference a real mcp_servers key
// ═════════════════════════════════════════════════════════════════════════

// F2a · value references unknown MCP → error
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: 'bitbucket',                          // not in mcp_servers
      docs_source: 'atlassian',
    },
  });
  assert('F2a · unknown mcp key → error names the offender',
    containsInErrors(report, "references 'bitbucket'"));
}

// F2b · fallback list with unknown member → error for the bad one only
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   github:    { auth: 'token', config: { command: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: ['github', 'gitlab'],                 // gitlab not declared
      docs_source: 'atlassian',
    },
  });
  assert('F2b · fallback list with bad member → error only on bad member',
    containsInErrors(report, "references 'gitlab'") &&
    notContainsInErrors(report, "references 'github'"));
}

// F2c · empty list value → valid opt-out (no error)
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   github:    { auth: 'token', config: { command: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: [],                                    // opted out
      docs_source: 'atlassian',
    },
  });
  assert('F2c · empty list → valid opt-out, no error',
    !containsInErrors(report, 'mcp_roles.vcs'));
}

// F2d · null value → valid opt-out (no error)
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: null,  // opted out
      vcs: 'atlassian', docs_source: 'atlassian',
    },
  });
  assert('F2d · null value → valid opt-out, no error',
    !containsInErrors(report, 'mcp_roles.design_source'));
}

// F2e · null opt-out + unknown MCP reference in same config
// Verifies that null is silent BUT other checks still run (V2 still flags unknown refs)
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian',
      design_source: null,                        // opted out (silent)
      vcs: 'bitbucket',                           // unknown MCP (error)
      docs_source: 'atlassian',
    },
  });
  assert('F2e · null is silent; other V2 checks still fire',
    !containsInErrors(report, 'mcp_roles.design_source') &&
    containsInErrors(report, "references 'bitbucket'"));
}

// F2f · opt-out role with matching guidance → no orphan warning
// Covers the edge case: author opts role out but kept its guidance block.
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   github:    { auth: 'token', config: { command: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: 'github', docs_source: [],             // opted out
    },
    mcp_guidance: {
      docs_source: 'For docs, we use local README files only.',
    },
  });
  assert('F2f · guidance for opted-out role → no orphan warning',
    !containsInWarnings(report, 'mcp_guidance.docs_source: orphan'));
}

// ═════════════════════════════════════════════════════════════════════════
// V3 — mcp_guidance keys must correspond to declared mcp_roles keys
// ═════════════════════════════════════════════════════════════════════════

// F3a · matching guidance key → no orphan warning
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   github:    { auth: 'token', config: { command: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: 'github', docs_source: 'atlassian',
    },
    mcp_guidance: {
      story_source: 'Use atlassian primarily; odoo for ODO- prefix.',
    },
  });
  assert('F3a · guidance key matches a role → no orphan warning',
    !containsInWarnings(report, 'orphan'));
}

// F3b · guidance key without matching role → orphan warning
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   github:    { auth: 'token', config: { command: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: 'github', docs_source: 'atlassian',
    },
    mcp_guidance: {
      notifications: 'Use Slack for alerts.',   // no 'notifications' role
    },
  });
  assert('F3b · orphan guidance key → warning',
    containsInWarnings(report, 'mcp_guidance.notifications: orphan'));
}

// F3c · guidance value is not a string → error
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   github:    { auth: 'token', config: { command: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: 'github', docs_source: 'atlassian',
    },
    mcp_guidance: {
      story_source: { not: 'a string' },        // wrong type
    },
  });
  assert('F3c · non-string guidance value → error',
    containsInErrors(report, 'mcp_guidance.story_source: expected a string'));
}

// ═════════════════════════════════════════════════════════════════════════
// V4 (reshaped) — retired fields in mcp_servers produce per-server warnings
// PR 1b: used_by / required / skip / fallback_prompt are removed; legacy
// packs with these fields get a one-shot deprecation warning per server.
// ═════════════════════════════════════════════════════════════════════════

// F4a · legacy fields present → per-server retired-fields warning
{
  const report = run({
    mcp_servers: {
      atlassian: { auth: 'oauth', config: { url: 'x' }, used_by: ['orchestrator'], required: true },
      github:    { auth: 'token', config: { command: 'x' }, skip: false, fallback_prompt: '...' },
      figma:     { auth: 'token', config: { command: 'x' } },
    },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: 'github', docs_source: 'atlassian',
    },
  });
  assert('F4a · retired fields on atlassian → per-server warning',
    containsInWarnings(report, "mcp_servers.atlassian: field(s) 'used_by', 'required' are retired"));
  assert('F4a · retired fields on github → per-server warning',
    containsInWarnings(report, "mcp_servers.github: field(s) 'skip', 'fallback_prompt' are retired"));
  assert('F4a · figma has no retired fields → no warning for figma',
    !containsInWarnings(report, 'mcp_servers.figma: field(s)'));
}

// F4b · clean slim mcp_servers → no retired-field warnings
{
  const report = run({
    mcp_servers: { atlassian: { auth: 'oauth', config: { url: 'x' } },
                   github:    { auth: 'token', config: { command: 'x' } },
                   figma:     { auth: 'token', config: { command: 'x' } } },
    mcp_roles: {
      story_source: 'atlassian', design_source: 'figma',
      vcs: 'github', docs_source: 'atlassian',
    },
  });
  assert('F4b · clean mcp_servers → no retired-field warnings',
    !containsInWarnings(report, 'are retired'));
}

// ═════════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════════

console.log('');
for (const r of results) {
  const mark = r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${r.name}`);
  if (!r.ok && r.detail) console.log(`      ${r.detail.replace(/\n/g, '\n      ')}`);
}
console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

process.exit(failed > 0 ? 1 : 0);
