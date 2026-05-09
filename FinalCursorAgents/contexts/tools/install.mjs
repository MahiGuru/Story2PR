#!/usr/bin/env node
/**
 * install.mjs — Agent Pipeline installer (v11)
 *
 * Installs the kernel + a project pack into a target project, for either
 * Cursor (.cursor/) or Claude Code (.claude/) as the host.
 *
 * Safe to re-run — preserves your existing pipeline.yaml and project-context.md.
 *
 * Usage:
 *   node tools/install.mjs --project-root ~/work/myproject                    # default: cursor
 *   node tools/install.mjs --project-root ~/work/myproject --target cursor    # explicit
 *   node tools/install.mjs --project-root ~/work/myproject --target claude    # Claude Code
 *   node tools/install.mjs --output-dir ./staged --target claude
 *   npm run install-pipeline -- --project-root ~/work/myproject
 *   npm run install-pipeline:claude -- --project-root ~/work/myproject
 */

import { existsSync, readdirSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, chmodSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { parseArgs } from 'util';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { splitMonolithic, mergeSplitContent } from './split-pipeline.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Script lives in contexts/tools/ — release root is two levels up
const SCRIPT_DIR = resolve(__dirname, '..', '..');

// ── Helpers ──────────────────────────────────────────────────────────────
function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

function ensureDir(dir, dryRun = false) {
  if (dryRun) { console.log(`  [DRY] mkdir -p ${dir}`); return; }
  mkdirSync(dir, { recursive: true });
}

function cp(src, dest, dryRun = false) {
  if (dryRun) { console.log(`  [DRY] cp ${src} → ${dest}`); return; }
  copyFileSync(src, dest);
}

function writeText(dest, content, dryRun = false) {
  if (dryRun) { console.log(`  [DRY] write ${dest} (${content.length} chars)`); return; }
  writeFileSync(dest, content);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
}

// ── Format conversions (cursor → claude) ─────────────────────────────────

/**
 * Strip Cursor-specific frontmatter keys that Claude Code doesn't use.
 * Currently: `alwaysApply: <bool>` — in Claude Code, all files in
 * .claude/rules/ are auto-loaded, so this key is noise (harmless if left,
 * but stripped for hygiene).
 *
 * Keeps `description:` — both hosts use it.
 */
function stripCursorOnlyFrontmatter(text) {
  const lines = text.split('\n');
  // Find frontmatter block
  if (lines[0]?.trim() !== '---') return text;
  let fmEnd = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { fmEnd = i; break; }
  }
  if (fmEnd === -1) return text;
  const fm = lines.slice(1, fmEnd);
  const filtered = fm.filter(ln => !/^\s*alwaysApply\s*:/.test(ln));
  return [lines[0], ...filtered, ...lines.slice(fmEnd)].join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    'target':        { type: 'string', default: 'cursor' },
    'pack':          { type: 'string', default: 'your-project' },
    'no-pack':       { type: 'boolean', default: false },
    'project-root':  { type: 'string' },
    'output-dir':    { type: 'string' },
    'force-config':  { type: 'boolean', default: false },
    'merge-config':  { type: 'boolean', default: false },
    'no-mcp':        { type: 'boolean', default: false },
    'no-validate':   { type: 'boolean', default: false },
    'dry-run':       { type: 'boolean', default: false },
    'list-packs':    { type: 'boolean', default: false },
    'with-handoff-hook': { type: 'boolean', default: false },
    'help':          { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Agent Pipeline Installer (v11)

Usage: node contexts/tools/install.mjs [OPTIONS]
       npm run install-pipeline -- [OPTIONS]
       npm run install-pipeline:cursor -- [OPTIONS]
       npm run install-pipeline:claude -- [OPTIONS]

Options:
  --target <host>       cursor (default) | claude
                        cursor → installs to .cursor/ with .mdc rules + flat skills
                        claude → installs to .claude/ with .md rules + dir skills
  --pack <n>            Pack to install (default: your-project)
  --no-pack             Install kernel only, no pack
  --project-root <path> Target project root (default: current directory)
  --output-dir <path>   Staging mode: build to <path> for manual copy later
  --force-config        Overwrite existing pipeline.yaml splits AND project-
                        context.md from the pack seed. Existing files are backed
                        up to <file>.bak.<timestamp>. Loses analyzer-written
                        content (shared_paths, operation_patterns, i18n) unless
                        you cherry-pick it back from the .bak file.
  --merge-config        Section-aware merge: pack-owned sections (mcp_servers,
                        skills, builds, runtime, jira, …) take the new pack
                        seed's content; analyzer-owned sections (shared_paths,
                        operation_patterns, i18n, analyzer_ignore) preserve the
                        dev's existing content. Existing files are backed up to
                        <file>.bak.<timestamp> for safety. Use this when
                        upgrading the pack seed without losing analyzer state.
                        Mutually exclusive with --force-config.
  --no-mcp              Skip mcp.sample.json generation
  --no-validate         Skip running the validator after install
  --dry-run             Print what would be done without making changes
  --list-packs          List packs available in this release and exit
  --with-handoff-hook   [--target claude ONLY] Install the Claude Code Stop
                        hook that auto-copies the next-agent handoff trigger
                        to the clipboard and shows a desktop notification
                        when the assistant finishes a turn. Opt-in because
                        it modifies .claude/settings.json. If passed with
                        --target cursor, the installer warns and skips the
                        hook — Cursor users already get clickable cursor://
                        deeplinks rendered directly in every agent's gate
                        output (no hook needed, no script required).
  -h, --help            Show this help

Host differences:
  Cursor                .cursor/agents/*.md    .cursor/rules/*.mdc    .cursor/skills/*.md
  Claude Code           .claude/agents/*.md    .claude/rules/*.md     .claude/skills/<name>/SKILL.md
`);
  process.exit(0);
}

// ── List packs ───────────────────────────────────────────────────────────
if (args['list-packs']) {
  const packsDir = join(SCRIPT_DIR, 'packs');
  console.log(`Available packs in ${packsDir}/:`);
  if (isDir(packsDir)) {
    const found = readdirSync(packsDir).filter(p => isDir(join(packsDir, p)));
    if (found.length) found.forEach(p => console.log(`  - ${p}`));
    else console.log('  (none)');
  } else {
    console.log('  (no packs/ directory found in release)');
  }
  process.exit(0);
}

// ── Validate --target ────────────────────────────────────────────────────
const TARGET = args.target.toLowerCase();
if (!['cursor', 'claude'].includes(TARGET)) {
  console.error(`ERROR: --target must be 'cursor' or 'claude', got '${args.target}'`);
  process.exit(2);
}

// ── Validate flag combinations ───────────────────────────────────────────
// --with-handoff-hook is strictly for --target claude. Cursor has no hook
// system; handoff-as-deeplink is baked into agent gate output instead.
// Accepting the combo silently would create orphan .claude/ directories on
// cursor-only installs and mislead users into thinking something is active.
if (args['force-config'] && args['merge-config']) {
  console.error('');
  console.error('ERROR: --force-config and --merge-config are mutually exclusive.');
  console.error('  --force-config: overwrite ALL split files from pack seed (loses analyzer writes)');
  console.error('  --merge-config: merge pack-owned sections in, preserve analyzer-owned sections');
  console.error('  Pick one. Plain re-install (no flag) preserves all existing splits.');
  console.error('');
  process.exit(2);
}

if (args['with-handoff-hook'] && TARGET !== 'claude') {
  console.error('');
  console.error(`ERROR: --with-handoff-hook requires --target claude (got --target ${TARGET}).`);
  console.error('');
  console.error('  Why: Stop hooks are a Claude Code feature. Cursor has no hook system —');
  console.error('  its handoff mechanism is clickable `cursor://` deeplinks rendered directly');
  console.error('  in each agent\'s gate output (no hook, no script, no settings.json).');
  console.error('');
  console.error('  Fix one of:');
  console.error('    • Drop the flag:        npm run install-pipeline:cursor -- --project-root <path>');
  console.error('    • Switch to claude:     npm run install-pipeline:claude -- --project-root <path> --with-handoff-hook');
  console.error('    • Install for BOTH:     run the installer twice, once per --target, --with-handoff-hook on the claude run only.');
  console.error('');
  process.exit(2);
}

// Per-target path/format config
const TARGET_CONFIG = {
  cursor: {
    hostDir:      '.cursor',
    ruleExt:      '.mdc',
    skillsLayout: 'flat',      // <name>.md flat file
    label:        'Cursor',
  },
  claude: {
    hostDir:      '.claude',
    ruleExt:      '.md',
    skillsLayout: 'dir',       // <name>/SKILL.md per-skill directory
    label:        'Claude Code',
  },
}[TARGET];

// ── Sanity checks ────────────────────────────────────────────────────────
const DRY = args['dry-run'];
const PACK = args.pack;
const NO_PACK = args['no-pack'];

if (!isDir(join(SCRIPT_DIR, 'agent-pipeline'))) {
  console.error(`ERROR: agent-pipeline/ not found in ${SCRIPT_DIR}`);
  process.exit(1);
}

let PACK_DIR = '';
if (!NO_PACK) {
  PACK_DIR = join(SCRIPT_DIR, 'packs', PACK);
  if (!isDir(PACK_DIR)) {
    console.error(`ERROR: pack '${PACK}' not found at ${PACK_DIR}`);
    const packsDir = join(SCRIPT_DIR, 'packs');
    if (isDir(packsDir)) {
      const avail = readdirSync(packsDir).filter(p => isDir(join(packsDir, p)));
      if (avail.length) console.error(`Available packs: ${avail.join(', ')}`);
    }
    process.exit(1);
  }
}

// ── Resolve project root ─────────────────────────────────────────────────
let PROJECT_ROOT = args['project-root'] ? resolve(args['project-root']) : process.cwd();
let MODE = 'install';

if (args['output-dir']) {
  if (args['project-root']) {
    console.error('ERROR: --output-dir and --project-root are mutually exclusive.');
    process.exit(2);
  }
  MODE = 'output-dir';
  PROJECT_ROOT = resolve(args['output-dir']);
  ensureDir(PROJECT_ROOT, DRY);
}

// Auto-create --project-root when the parent exists but the leaf doesn't.
// If the parent is missing too, that's probably a typo — fail loud.
if (!DRY && !isDir(PROJECT_ROOT)) {
  const parent = dirname(PROJECT_ROOT);
  if (isDir(parent)) {
    console.log(`→ Target directory does not exist — creating: ${PROJECT_ROOT}`);
    ensureDir(PROJECT_ROOT, DRY);
  } else {
    console.error(`ERROR: target directory does not exist: ${PROJECT_ROOT}`);
    console.error(`       (parent directory ${parent} also missing — check for typos)`);
    process.exit(1);
  }
}

PROJECT_ROOT = resolve(PROJECT_ROOT);

if (PROJECT_ROOT === SCRIPT_DIR) {
  console.error('ERROR: refusing to install into the release directory itself.');
  console.error('Pass --project-root <path> or --output-dir <path>.');
  process.exit(1);
}

// ── Locate pack config templates ─────────────────────────────────────────
// Layout:
//   packs/{pack}/pipeline.{pack}.yaml          → monolithic seed (pack-author source-of-truth)
//   packs/{pack}/project-context.{pack}.md     → prose context (release-shipped template)
//
// At install, the seed is copied to the user's project at contexts/pipeline.{pack}.yaml
// and then split into runtime sibling YAMLs under contexts/config/.
let EXAMPLE_PIPELINE = '', EXAMPLE_CONTEXT = '';
if (!NO_PACK) {
  const seedYaml = join(SCRIPT_DIR, 'packs', PACK, `pipeline.${PACK}.yaml`);
  const ctxMd    = join(SCRIPT_DIR, 'packs', PACK, `project-context.${PACK}.md`);

  if (isFile(seedYaml)) EXAMPLE_PIPELINE = seedYaml;
  else console.error(`WARNING: no pipeline.${PACK}.yaml found at packs/${PACK}/pipeline.${PACK}.yaml for pack '${PACK}'`);

  if (isFile(ctxMd)) EXAMPLE_CONTEXT = ctxMd;
  else console.error(`WARNING: no project-context.${PACK}.md found at packs/${PACK}/project-context.${PACK}.md for pack '${PACK}'`);
}

// ── Plan summary ─────────────────────────────────────────────────────────
console.log(`Source:       ${SCRIPT_DIR}`);
console.log(MODE === 'output-dir' ? `Output dir:   ${PROJECT_ROOT}` : `Target:       ${PROJECT_ROOT}`);
console.log(`Host:         ${TARGET_CONFIG.label} (${TARGET})`);
console.log(`Install dir:  ${TARGET_CONFIG.hostDir}/`);
console.log(`Pack:         ${NO_PACK ? '(none, kernel only)' : PACK}`);
if (DRY) console.log('Mode:         DRY RUN');
console.log('');

// ── Per-target install primitives ────────────────────────────────────────

/**
 * Install an agent file. Same format for both hosts; just copy.
 */
function installAgent(srcFile, destAgentsDir, dryRun) {
  const destFile = join(destAgentsDir, basename(srcFile));
  cp(srcFile, destFile, dryRun);
}

/**
 * Install a rule file.
 *   cursor: keep .mdc extension and content verbatim.
 *   claude: rename .mdc→.md, strip `alwaysApply:` line from frontmatter.
 */
function installRule(srcMdcFile, destRulesDir, dryRun) {
  const srcName = basename(srcMdcFile);            // e.g. agent-flow.mdc
  const stem = srcName.replace(/\.mdc$/, '');
  const destName = stem + TARGET_CONFIG.ruleExt;   // agent-flow.mdc or agent-flow.md
  const destFile = join(destRulesDir, destName);

  if (TARGET === 'cursor') {
    cp(srcMdcFile, destFile, dryRun);
  } else {
    // claude: transform content
    if (dryRun) {
      console.log(`  [DRY] convert ${srcMdcFile} → ${destFile} (strip alwaysApply)`);
    } else {
      const content = readFileSync(srcMdcFile, 'utf8');
      writeText(destFile, stripCursorOnlyFrontmatter(content));
    }
  }
}

/**
 * Read the `name:` field from a skill file's YAML frontmatter.
 * Falls back to the filename stem if no frontmatter or no `name:`.
 *
 * This matters for Claude Code: the directory name must match the skill's
 * identity, which lives in frontmatter (not the filename — e.g. the kernel
 * skill is shipped as `SKILL.md` but declares `name: agent-pipeline-flow`).
 */
function readSkillName(srcFile) {
  const stem = basename(srcFile).replace(/\.md$/, '');
  let content;
  try { content = readFileSync(srcFile, 'utf8'); } catch { return stem; }
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return stem;
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.trim() === '---') break;
    const m = ln.match(/^\s*name\s*:\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  return stem;
}

/**
 * Install a skill file.
 *   cursor: copy <name>.md flat into skills/.
 *   claude: create <skill-name>/SKILL.md directory (skill-name from frontmatter).
 */
function installSkill(srcFile, destSkillsDir, dryRun) {
  const srcName = basename(srcFile);               // e.g. your-project-angular18-standards.md

  if (TARGET === 'cursor') {
    cp(srcFile, join(destSkillsDir, srcName), dryRun);
  } else {
    // claude: each skill is its own directory. Use frontmatter `name:` as
    // the canonical identifier — NOT the filename stem (they can differ,
    // e.g. kernel ships `SKILL.md` with `name: agent-pipeline-flow`).
    const skillName = readSkillName(srcFile);
    const skillDir = join(destSkillsDir, skillName);
    ensureDir(skillDir, dryRun);
    cp(srcFile, join(skillDir, 'SKILL.md'), dryRun);
  }
}

/**
 * Install all files matching an extension from srcDir using an installer fn.
 */
function installAll(srcDir, ext, installerFn, destDir, dryRun) {
  if (!isDir(srcDir)) return 0;
  const files = readdirSync(srcDir).filter(f => f.endsWith(ext));
  for (const f of files) installerFn(join(srcDir, f), destDir, dryRun);
  return files.length;
}

// ── 1. Kernel ────────────────────────────────────────────────────────────
console.log(`→ Installing kernel into ${TARGET_CONFIG.hostDir}/`);
const AGENTS_DIR = join(PROJECT_ROOT, TARGET_CONFIG.hostDir, 'agents');
const RULES_DIR  = join(PROJECT_ROOT, TARGET_CONFIG.hostDir, 'rules');
const SKILLS_DIR = join(PROJECT_ROOT, TARGET_CONFIG.hostDir, 'skills');
ensureDir(AGENTS_DIR, DRY);
ensureDir(RULES_DIR, DRY);
ensureDir(SKILLS_DIR, DRY);

const kA = installAll(join(SCRIPT_DIR, 'agent-pipeline', 'agents'), '.md',  installAgent, AGENTS_DIR, DRY);

// Lazy-loaded mode flow files (bundle-*-flow.md, standalone-*-flow.md, explorer-bug.md).
// These live at agent-pipeline/agents/modes/*.md and MUST land at <host>/agents/modes/<file>.md
// because the agent prompts reference them as `modes/<flavor>-<agent>-flow.md`.
// installAll is non-recursive by design — handle the modes/ subdir explicitly.
const MODES_SRC  = join(SCRIPT_DIR, 'agent-pipeline', 'agents', 'modes');
const MODES_DEST = join(AGENTS_DIR, 'modes');
let kAm = 0;
if (isDir(MODES_SRC)) {
  ensureDir(MODES_DEST, DRY);
  kAm = installAll(MODES_SRC, '.md', installAgent, MODES_DEST, DRY);
}

const kR = installAll(join(SCRIPT_DIR, 'agent-pipeline', 'rules'),  '.mdc', installRule,  RULES_DIR,  DRY);
const kS = installAll(join(SCRIPT_DIR, 'agent-pipeline', 'skills'), '.md',  installSkill, SKILLS_DIR, DRY);
console.log(`  kernel: ${kA} agent(s), ${kAm} mode flow(s), ${kR} rule(s), ${kS} skill(s)`);

// ── 2. Pack ──────────────────────────────────────────────────────────────
if (!NO_PACK) {
  console.log(`→ Installing pack: ${PACK}`);
  const pR = installAll(join(PACK_DIR, 'rules'),  '.mdc', installRule,  RULES_DIR,  DRY);
  const pS = installAll(join(PACK_DIR, 'skills'), '.md',  installSkill, SKILLS_DIR, DRY);
  const pA = installAll(join(PACK_DIR, 'agents'), '.md',  installAgent, AGENTS_DIR, DRY);
  console.log(`  pack '${PACK}': ${pA} agent(s), ${pR} rule(s), ${pS} skill(s)`);
}

// ── 3. Project configs ───────────────────────────────────────────────────
console.log('→ Installing project config files');
ensureDir(join(PROJECT_ROOT, 'contexts', 'config'), DRY);

// Ticket input file — ready-to-fill, lives at contexts/ticket-input.md
// (the template in the release repo is shipped as ticket-input.template.md).
// Users who want to run --offline or --skip atlassian fill this in before triggering.
// Preserved on re-install unless --force-config is passed.
const inputTpl = join(SCRIPT_DIR, 'contexts', 'config', 'ticket-input.template.md');
if (isFile(inputTpl)) {
  ensureDir(join(PROJECT_ROOT, 'contexts'), DRY);
  const inputDest = join(PROJECT_ROOT, 'contexts', 'ticket-input.md');
  if (isFile(inputDest) && !args['force-config']) {
    console.log(`  ticket-input.md: preserved (already exists; use --force-config to replace with fresh template)`);
  } else if (isFile(inputDest) && args['force-config']) {
    const bak = `${inputDest}.bak.${timestamp()}`;
    if (!DRY) renameSync(inputDest, bak);
    console.log(`  ticket-input.md: backed up to ${basename(bak)}`);
    cp(inputTpl, inputDest, DRY);
    console.log(`  ticket-input.md: replaced with fresh template`);
  } else {
    cp(inputTpl, inputDest, DRY);
    console.log(`  ticket-input.md: created at contexts/ticket-input.md (edit this for --offline / --skip atlassian runs)`);
  }
}

/**
 * Install the pipeline config by splitting the pack's monolithic seed into the
 * runtime sibling YAMLs that agents actually read. The monolithic seed itself
 * is NOT copied to the user's project — only the 5 splits land there. Users
 * who want a single-file view can regenerate one on demand via
 * `npm run pipeline:merge`.
 *
 *   packs/<pack>/pipeline.<pack>.yaml        ← source (release repo, never copied)
 *   contexts/config/pipeline.<pack>.yaml     ← CORE split (runtime)
 *   contexts/config/pipeline.<pack>.skills.yaml
 *   contexts/config/pipeline.<pack>.builds.yaml
 *   contexts/config/pipeline.<pack>.analyzer.yaml
 *   contexts/config/pipeline.<pack>.e2e.test.yaml
 *
 * Preserve/refresh/force semantics:
 *   - If a split file exists AND no --force-config: preserve (user edits + analyzer writes survive)
 *   - With --force-config: back up existing, re-split from the pack seed
 *   - Fresh install (no existing splits): split everything from the pack seed
 */
function installPipelineConfigSplit(examplePath, pack, dryRun) {
  if (!examplePath) {
    console.error(`  pipeline config: no seed found for pack '${pack}' — skipping`);
    return;
  }

  // Split the pack seed directly into runtime sibling YAMLs under contexts/config/.
  // No intermediate seed copy in the user's project — agents read the splits.
  const splitDestDir = join(PROJECT_ROOT, 'contexts', 'config');
  ensureDir(splitDestDir, dryRun);

  const seedText = readFileSync(examplePath, 'utf8');
  const outputs = splitMonolithic(seedText, pack);

  for (const [filename, content] of Object.entries(outputs)) {
    const outPath = join(splitDestDir, filename);
    const exists = isFile(outPath);

    // Branch: --merge-config (section-aware merge, preserves analyzer-owned sections)
    if (exists && args['merge-config']) {
      const currentText = readFileSync(outPath, 'utf8');
      const { merged, log } = mergeSplitContent(currentText, content);
      const bak = `${outPath}.bak.${timestamp()}`;
      console.log(`  ${filename}: merging (pack-owned sections updated, analyzer-owned preserved)`);
      for (const line of log) console.log(line);
      if (dryRun) {
        console.log(`  [DRY] backup ${basename(outPath)} → ${basename(bak)}`);
        console.log(`  [DRY] write merged ${filename} (${merged.length} chars)`);
      } else {
        renameSync(outPath, bak);
        writeFileSync(outPath, merged);
        console.log(`    backup: ${basename(bak)}`);
      }
      continue;
    }

    // Branch: --force-config (overwrite from seed, full backup)
    if (exists && args['force-config']) {
      const bak = `${outPath}.bak.${timestamp()}`;
      if (!dryRun) renameSync(outPath, bak);
      console.log(`  ${filename}: backed up to ${basename(bak)}`);
    } else if (exists) {
      // Branch: no flag — preserve (today's default)
      console.log(`  ${filename}: preserved (already exists; use --merge-config to absorb pack changes, --force-config to re-split)`);
      continue;
    }

    // Fresh write OR after force-config backup
    if (dryRun) {
      console.log(`  [DRY] split write ${filename} (${content.length} chars)`);
    } else {
      writeFileSync(outPath, content);
      console.log(`  ${filename}: split from pack seed (${content.length} bytes)`);
    }
  }

  // Also copy the TEAM MEMBER pipeline editor's guide (if shipped by the pack)
  // so users have the how-to guide next to their split files.
  //
  // NOTE: pipeline.<pack>.forauthor.readme.md (the pack-author guide) stays in
  // the release repo at packs/<pack>/ — it's NOT copied to user projects.
  const readmeSrc  = join(SCRIPT_DIR, 'packs', pack, `pipeline.${pack}.readme.md`);
  const readmeDest = join(splitDestDir, `pipeline.${pack}.readme.md`);
  if (isFile(readmeSrc)) {
    cp(readmeSrc, readmeDest, dryRun);
    console.log(`  pipeline.${pack}.readme.md: installed (team member guide)`);
  }
}

// Helper: install one config file with preserve/refresh/force semantics
// destSubdir: 'config' for machine config, '' for contexts/ root (prose)
function installConfigFile(examplePath, destName, friendlyName, destSubdir = 'config') {
  if (!examplePath) return;
  const destDir = destSubdir
    ? join(PROJECT_ROOT, 'contexts', destSubdir)
    : join(PROJECT_ROOT, 'contexts');
  const destPath = join(destDir, destName);

  if (isFile(destPath) && !args['force-config']) {
    if (MODE === 'output-dir') {
      // Output-dir mode: refresh from shipped example (ephemeral build artifact)
      cp(examplePath, destPath, DRY);
      console.log(`  ${friendlyName}: refreshed from shipped example (output-dir mode)`);
    } else {
      console.log(`  ${friendlyName}: preserved (already exists; use --force-config to overwrite)`);
    }
  } else if (isFile(destPath) && args['force-config']) {
    const bak = `${destPath}.bak.${timestamp()}`;
    if (!DRY) renameSync(destPath, bak);
    console.log(`  ${friendlyName}: backed up to ${basename(bak)}`);
    cp(examplePath, destPath, DRY);
    console.log(`  ${friendlyName}: replaced with shipped example`);
  } else {
    cp(examplePath, destPath, DRY);
    console.log(`  ${friendlyName}: created from shipped example`);
  }
}

// ── v14.0-14.2 → v14.3 path migration ───────────────────────────────────
// Before v14.3, project-map.md and project-context.md lived in contexts/config/.
// v14.3 moves them to contexts/ root. On install, detect + migrate existing files.
function migrateV142Paths() {
  const legacyConfig = join(PROJECT_ROOT, 'contexts', 'config');
  const newRoot      = join(PROJECT_ROOT, 'contexts');
  const toMigrate = [
    { file: 'project-map.md',     reason: 'generated catalog' },
    { file: 'project-context.md', reason: 'prose context' }
  ];

  let migrated = 0;
  for (const { file, reason } of toMigrate) {
    const oldPath = join(legacyConfig, file);
    const newPath = join(newRoot, file);

    if (!isFile(oldPath)) continue;
    if (isFile(newPath)) {
      console.log(`  migration: ${file} already at new location, skipping`);
      continue;
    }

    if (DRY) {
      console.log(`  [DRY] would migrate ${file}: contexts/config/ → contexts/ (${reason})`);
    } else {
      renameSync(oldPath, newPath);
      console.log(`  ✓ migrated ${file}: contexts/config/ → contexts/ (${reason})`);
    }
    migrated++;
  }
  if (migrated > 0) {
    console.log(`  → ${migrated} file(s) migrated. Review + commit with:`);
    console.log(`    git add -A contexts/ && git commit -m "chore: migrate project-map + project-context to contexts/ root (v14.3)"`);
  }
}

// Run migration BEFORE installing config files so the new install doesn't
// double up with a fresh template while the old file sits orphaned in config/.
console.log('→ Checking for v14.0-14.2 paths to migrate');
migrateV142Paths();

// Pipeline config — install as the monolithic seed at contexts/pipeline.<pack>.yaml,
// then split into runtime sibling YAMLs under contexts/config/ that agents read.
installPipelineConfigSplit(EXAMPLE_PIPELINE, PACK, DRY);
installConfigFile(EXAMPLE_CONTEXT,  'project-context.md',    'project-context.md',    '');       // contexts/ root

// contexts/README.md — how-to-use guide for the contexts/ folder, including
// the first-time "tech lead runs Analyze project once" instructions. Ships
// alongside the files it describes so team members can read it in-place.
const contextsReadme = join(SCRIPT_DIR, 'contexts', 'README.md');
if (isFile(contextsReadme)) {
  installConfigFile(contextsReadme, 'README.md', 'contexts/README.md', '');
}

// ── 3.5. Tooling ─────────────────────────────────────────────────────────
console.log('→ Installing tooling');
ensureDir(join(PROJECT_ROOT, 'contexts', 'tools'), DRY);
ensureDir(join(PROJECT_ROOT, 'contexts', 'tools', 'vendor'), DRY);
for (const f of ['validate.mjs', 'mcp-sample-generator.mjs', 'install.mjs', 'help.mjs', 'README.md', 'split-pipeline.mjs', 'audit-file-reads.mjs']) {
  const src = join(SCRIPT_DIR, 'contexts', 'tools', f);
  if (isFile(src)) cp(src, join(PROJECT_ROOT, 'contexts', 'tools', f), DRY);
}
// Vendored js-yaml (MIT) — lets tools run with zero npm deps at the project
for (const f of ['js-yaml.mjs', 'LICENSE-js-yaml']) {
  const src = join(SCRIPT_DIR, 'contexts', 'tools', 'vendor', f);
  if (isFile(src)) cp(src, join(PROJECT_ROOT, 'contexts', 'tools', 'vendor', f), DRY);
}

// ── 3.6. (No npm dependencies at the project side.) ─────────────────────
// Tools use a vendored js-yaml ESM bundle under contexts/tools/vendor/ —
// the project doesn't need its own package.json or node_modules/. This keeps
// installs clean and avoids colliding with a project's existing package.json.

// ── 3.7. Claude Code Stop hook (opt-in, --target claude only) ───────────
// Copies handoff-hook.sh to .claude/hooks/ and registers it as a Stop hook
// in .claude/settings.json. Fires when the assistant finishes a turn,
// extracts the handoff trigger (e.g. "@explorer.md Run the explorer"),
// copies to clipboard, and emits a desktop notification.
//
// Argument validation above rejects --with-handoff-hook on non-claude targets,
// so reaching this block guarantees TARGET === 'claude'. Cursor users get
// handoff-as-a-deeplink directly in agent gate output (no hook required).
if (args['with-handoff-hook']) {
  console.log('→ Installing Claude Code handoff Stop hook');
  installHandoffHook(PROJECT_ROOT, DRY);
}

function installHandoffHook(projectRoot, dryRun) {
  const srcHook = join(SCRIPT_DIR, 'agent-pipeline', 'hooks', 'handoff-hook.sh');
  if (!isFile(srcHook)) {
    console.error('  WARNING: agent-pipeline/hooks/handoff-hook.sh not found in release — skipping');
    return;
  }

  // 1. Copy the hook script into the target's .claude/hooks/ directory.
  const claudeDir = join(projectRoot, '.claude');
  const hooksDir  = join(claudeDir, 'hooks');
  ensureDir(hooksDir, dryRun);
  const destHook  = join(hooksDir, 'handoff-hook.sh');
  cp(srcHook, destHook, dryRun);
  if (!dryRun) {
    try { chmodSync(destHook, 0o755); } catch { /* ignore chmod failures on Windows */ }
  }
  console.log(`  handoff-hook.sh: copied to .claude/hooks/`);

  // 2. Register the hook in .claude/settings.json (merge, don't clobber).
  const settingsPath = join(claudeDir, 'settings.json');
  const hookCommand  = `bash "${destHook}"`;

  if (dryRun) {
    console.log(`  [DRY] would register Stop hook → ${settingsPath}`);
    return;
  }

  let settings = {};
  if (isFile(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      console.error(`  WARNING: .claude/settings.json exists but is invalid JSON — skipping hook registration. Fix the file and re-run with --with-handoff-hook.`);
      return;
    }
  }

  settings.hooks      = settings.hooks || {};
  settings.hooks.Stop = settings.hooks.Stop || [];

  // Dedup: skip if a handoff-hook entry is already present (re-install safe).
  const already = settings.hooks.Stop.some(h =>
    h && typeof h.command === 'string' && h.command.includes('handoff-hook.sh')
  );

  if (already) {
    console.log(`  .claude/settings.json: Stop hook already registered — skipping`);
    return;
  }

  settings.hooks.Stop.push({ command: hookCommand });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`  .claude/settings.json: Stop hook registered (bash ${destHook})`);
}

// ── 4. MCP sample generation ─────────────────────────────────────────────
if (args['no-mcp']) {
  console.log('');
  console.log('→ Skipping mcp.sample.json generation (--no-mcp)');
} else if (DRY) {
  console.log('');
  console.log(`[DRY] Would generate contexts/config/mcp.sample.json`);
} else {
  const pipelineYaml = join(PROJECT_ROOT, 'contexts', 'config', 'pipeline.yaml');
  const generator = join(PROJECT_ROOT, 'contexts', 'tools', 'mcp-sample-generator.mjs');
  if (isFile(pipelineYaml) && isFile(generator)) {
    console.log('');
    console.log(`→ Generating mcp.sample.json (reference for developers)`);
    try {
      execSync(
        `node "${generator}" --pipeline-yaml "${pipelineYaml}" --project-root "${PROJECT_ROOT}"`,
        { cwd: PROJECT_ROOT, stdio: 'inherit' }
      );
    } catch {
      console.error('  ⚠ mcp.sample.json generation had warnings (non-fatal)');
    }
  }
}

// ── 5. Validate ──────────────────────────────────────────────────────────
if (!args['no-validate'] && !DRY) {
  const pipelineYaml = join(PROJECT_ROOT, 'contexts', 'config', 'pipeline.yaml');
  const validator = join(PROJECT_ROOT, 'contexts', 'tools', 'validate.mjs');
  if (isFile(pipelineYaml) && isFile(validator)) {
    console.log('');
    console.log('→ Validating installed config');
    try {
      execSync(`node "${validator}" --repo-root "${PROJECT_ROOT}"`, { cwd: PROJECT_ROOT, stdio: 'inherit' });
    } catch (e) {
      console.error(`  ⚠ Validation failed. Review errors above.`);
      process.exit(1);
    }
  }
}

// ── Done ─────────────────────────────────────────────────────────────────
console.log('');
if (DRY) {
  console.log('Dry run complete. No changes were made.');
} else if (MODE === 'output-dir') {
  console.log(`✓ Build complete (staged — ${TARGET_CONFIG.label} target, copy to target, then finalize)`);
  console.log('');
  console.log('Next steps:');
  console.log('');
  console.log('  1. Copy to your project:');
  console.log(`       cp -r ${PROJECT_ROOT}/${TARGET_CONFIG.hostDir}  /path/to/project/`);
  console.log(`       cp -r ${PROJECT_ROOT}/contexts                  /path/to/project/`);
  console.log('');
  console.log('     (No package.json copy needed — tools have a vendored js-yaml under');
  console.log('      contexts/tools/vendor/ and run with plain `node`.)');
  console.log('');
  console.log('  2. Each developer: set up their personal MCP config');
  console.log('       See contexts/config/mcp.sample.README.md for setup instructions.');
  console.log('');
  console.log(`  3. Smoke test: open the project in ${TARGET_CONFIG.label} and try`);
  console.log(`       'Work on <TICKET-ID>'`);
} else {
  console.log(`✓ Install complete (${TARGET_CONFIG.label} target)`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Review and customize:`);
  console.log(`       ${PROJECT_ROOT}/contexts/config/pipeline.yaml         (skills, subagents, builds, mcp_servers)`);
  console.log(`       ${PROJECT_ROOT}/contexts/project-context.md           (stack, team, migrations)`);
  console.log(`  2. Set up MCP servers in your personal ${TARGET_CONFIG.label} config:`);
  console.log(`       See ${PROJECT_ROOT}/contexts/config/mcp.sample.README.md for instructions.`);
  console.log(`  3. Re-validate after edits:  node contexts/tools/validate.mjs`);
  console.log(`  4. Regenerate MCP sample:    node contexts/tools/mcp-sample-generator.mjs --project-root .`);
  if (TARGET === 'cursor') {
    console.log(`  5. Smoke test: open the project in Cursor and try 'Work on <TICKET-ID>'`);
  } else {
    console.log(`  5. Smoke test: open the project in Claude Code and try 'Work on <TICKET-ID>'`);
  }
  console.log('');
  console.log('Next time you upgrade the pack release:');
  console.log('  • Pure agent/tool refresh (no pipeline.yaml change wanted): just re-run install (no flags).');
  console.log('  • Pack seed evolved AND project-analyzer ran here:           re-run with --merge-config');
  console.log('     (pack-owned sections updated, analyzer-owned shared_paths/i18n preserved).');
  console.log('  • Reset everything to pack defaults:                          re-run with --force-config');
  console.log('     (then re-run project-analyzer agent to rebuild shared_paths from disk).');
}
