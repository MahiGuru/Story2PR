#!/usr/bin/env node
/**
 * split-pipeline.mjs — convert between the monolithic pipeline.<pack>.yaml seed
 * (one file, source-of-truth for install) and the runtime-ready sibling YAMLs
 * that agents actually read.
 *
 * Usage:
 *   node contexts/tools/split-pipeline.mjs split [--source PATH] [--dest DIR] [--pack <name>] [--force]
 *   node contexts/tools/split-pipeline.mjs merge [--source DIR] [--dest PATH] [--pack <name>]
 *
 *   split: contexts/pipeline.<pack>.yaml → contexts/config/pipeline.<pack>.*.yaml
 *   merge: contexts/config/pipeline.<pack>.*.yaml → contexts/pipeline.<pack>.yaml
 *
 * Comment-preserving (text-based section extraction).
 *
 * Used by:
 *   - npm run install-pipeline (splits at install time)
 *   - ad-hoc by pack authors who maintain the monolithic source
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { parseArgs } from 'util';

// ── Routing ──────────────────────────────────────────────────────────────
// Maps each split file (suffix) to the top-level YAML keys it owns.
// Keep in sync with each pack's pipeline.<pack>.README.md "File map" table.
//
// Suffix '' means the core file: pipeline.<pack>.yaml.
// Other suffixes produce: pipeline.<pack>.<suffix>.yaml.
export const ROUTING = {
  '':         { sections: ['meta', 'subagents', 'intent_classification', 'runtime', 'jira', 'mcp_servers', 'mcp_roles', 'docs_publish_target', 'mcp_guidance'],
                description: 'CORE — every agent loads this' },
  'skills':   { sections: ['skills'],
                description: 'Loaded by: Orchestrator, Surgeon, Explorer' },
  'builds':   { sections: ['builds', 'component_structure', 'operation_patterns', 'i18n'],
                description: 'Loaded by: Surgeon, Review' },
  'analyzer': { sections: ['shared_paths', 'explorer_paths', 'scan_exclusions', 'component_naming', 'rescan_hints', 'analyzer_ignore'],
                description: 'Loaded by: project-analyzer, Explorer' },
  'e2e.test': { sections: ['demo'],
                description: 'E2E / Demo / browser verification config — loaded by: AC-E2E-Check' },
};

// Canonical section order in the monolithic file (matches the original pre-split layout)
export const MONOLITHIC_ORDER = [
  'meta', 'skills', 'shared_paths', 'operation_patterns', 'i18n',
  'subagents', 'builds', 'component_structure', 'explorer_paths',
  'scan_exclusions', 'component_naming', 'intent_classification',
  'rescan_hints', 'analyzer_ignore', 'runtime', 'demo', 'jira',
  'mcp_servers', 'mcp_roles', 'docs_publish_target', 'mcp_guidance',
];

// ── Section ownership (drives section-aware merge on re-install) ────────
// Two policies:
//   'analyzer' — section is written by project-analyzer (or analyzer-mutated).
//                On --merge-config, the dev's current content is PRESERVED
//                even if the new pack seed reorganized the section. This keeps
//                discovered shared_paths / operation_patterns / i18n alive.
//   'pack'     — section is pack-defined. On --merge-config, the new pack's
//                content REPLACES the dev's current content (and the old file
//                is backed up to .bak.<ts>). Dev hand-edits to pack-owned
//                sections — e.g. flipping mcp_servers.figma.skip — survive
//                ONLY because of the .bak; manually re-apply after merge.
//
// Default for any section not listed below is 'pack' (safer — pack changes
// always reach the dev unless the section is explicitly analyzer-owned).
export const SECTION_OWNERS = {
  // analyzer-WRITTEN — preserve dev's content on merge
  shared_paths:        'analyzer',
  operation_patterns:  'analyzer',
  i18n:                'analyzer',
  analyzer_ignore:     'analyzer',
  // pack-DEFINED — incoming wins on merge
  meta:                  'pack',
  skills:                'pack',
  subagents:             'pack',
  builds:                'pack',
  component_structure:   'pack',
  explorer_paths:        'pack',
  scan_exclusions:       'pack',
  component_naming:      'pack',
  intent_classification: 'pack',
  rescan_hints:          'pack',
  runtime:               'pack',
  demo:                  'pack',
  jira:                  'pack',
  mcp_servers:           'pack',
  mcp_roles:             'pack',
  docs_publish_target:   'pack',
  mcp_guidance:          'pack',
};

function splitFilename(pack, suffix) {
  return suffix ? `pipeline.${pack}.${suffix}.yaml` : `pipeline.${pack}.yaml`;
}

// ── Comment stripping (runtime splits only) ──────────────────────────────
//
// Runtime split files are loaded by agents at every pre-flight — each comment
// line costs tokens. Pack authors keep their rich comments in the monolithic
// seed (packs/<pack>/pipeline.<pack>.yaml) and in pipeline.<pack>.forauthor.
// readme.md; the installer writes slim, comment-stripped splits to
// contexts/config/ so agent context stays tight.
//
// Strategy: drop lines that are pure whitespace+comment. Preserve YAML data,
// indentation, and inline values. Collapse 3+ consecutive blank lines to 1.
// Inline trailing comments on value lines are kept for safety (rare in packs;
// regex-stripping them risks breaking quoted strings that contain '#').
export function stripCommentLines(text) {
  return text
    .split('\n')
    .filter(line => !/^\s*#/.test(line))  // drop lines that START with # (possibly indented)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')           // collapse multiple consecutive blanks
    .replace(/^\n+/, '')                  // strip leading blanks
    .replace(/\n+$/, '\n');               // normalize trailing to single \n
}

// ── Section extraction (text-based, preserves comments) ──────────────────

function isTopLevelKey(line) {
  return /^([a-z_][a-z0-9_]*):/.test(line) && !line.startsWith(' ') && !line.startsWith('\t');
}

function topLevelKeyName(line) {
  const m = line.match(/^([a-z_][a-z0-9_]*):/);
  return m ? m[1] : null;
}

/**
 * Walk back from end of block; split off the trailing comment/blank lines that
 * visually belong to the NEXT section, not this one.
 *
 * Example block end:
 *     foo: bar
 *
 *     # ─── NEW SECTION ─────────────────────────
 *     # Some explanation
 *
 * The blank + 2 comment lines + blank get re-attributed to the next section.
 */
function findCommentTail(block) {
  let i = block.length - 1;
  // First strip trailing blank lines
  while (i >= 0 && block[i].trim() === '') i--;
  // Then walk back through comment lines (with possible blank-line gaps)
  let lastContentLine = i;
  while (i >= 0) {
    const ln = block[i].trim();
    if (ln === '' || ln.startsWith('#')) i--;
    else break;
  }
  // i now points to the last "content" (non-comment, non-blank) line.
  // Anything after i+1 (inclusive of blanks/comments) belongs to next section.
  return {
    keep: block.slice(0, i + 1),
    tail: block.slice(i + 1),
  };
}

export function extractSections(text) {
  const lines = text.split('\n');
  const sections = {};
  let currentKey = null;
  let currentBlock = [];
  let prelude = [];

  for (const line of lines) {
    if (isTopLevelKey(line)) {
      const newKey = topLevelKeyName(line);
      if (currentKey) {
        const { keep, tail } = findCommentTail(currentBlock);
        sections[currentKey] = keep.join('\n').replace(/\n+$/, '');
        currentBlock = [...tail, line];
      } else {
        const { keep, tail } = findCommentTail(currentBlock);
        prelude = keep;
        currentBlock = [...tail, line];
      }
      currentKey = newKey;
    } else {
      currentBlock.push(line);
    }
  }
  if (currentKey) {
    sections[currentKey] = currentBlock.join('\n').replace(/\n+$/, '');
  }

  return {
    prelude: prelude.join('\n').replace(/\n+$/, ''),
    sections,
  };
}

// ── File headers ─────────────────────────────────────────────────────────

function splitFileHeader(pack, suffix, description) {
  const filename = splitFilename(pack, suffix);
  return [
    '# ═══════════════════════════════════════════════════════════════════════',
    `# ${filename}  —  ${description}`,
    '# ═══════════════════════════════════════════════════════════════════════',
    `# AUTO-SPLIT from contexts/pipeline.${pack}.yaml at install time.`,
    '#',
    '# Edit this file directly to change config — agents read from here.',
    `# Re-running install with --force-config will overwrite this from the seed.`,
    '#',
    `# See contexts/config/pipeline.${pack}.README.md for the full file map (if shipped).`,
    '# ═══════════════════════════════════════════════════════════════════════',
  ].join('\n');
}

function monolithicHeader(pack) {
  return [
    '# ═══════════════════════════════════════════════════════════════════════',
    `# pipeline.${pack}.yaml — MONOLITHIC SEED (source-of-truth for install)`,
    '# ═══════════════════════════════════════════════════════════════════════',
    '#',
    '# This file is the source of truth at INSTALL time. Running:',
    `#   npm run install-pipeline -- --pack ${pack}`,
    '# splits this file into runtime sibling YAMLs under contexts/config/:',
    `#   pipeline.${pack}.yaml          (core: meta, runtime, jira, mcp, subagents, intent)`,
    `#   pipeline.${pack}.skills.yaml   (skills.layer_map + per-agent skills)`,
    `#   pipeline.${pack}.builds.yaml   (builds, component_structure, operation_patterns, i18n)`,
    `#   pipeline.${pack}.analyzer.yaml (shared_paths, scan_exclusions, rescan_hints, ...)`,
    `#   pipeline.${pack}.e2e.test.yaml  (E2E / Demo / browser verification config)`,
    '#',
    '# Each agent loads ONLY the sibling files it needs (saves tokens).',
    '#',
    '# AFTER install, edit the split files in contexts/config/ — agents read from there.',
    '# project-analyzer also writes back to the split files (shared_paths, operation_patterns, i18n).',
    '#',
    '# This monolithic seed is used only on initial install or when re-installing',
    '# with --force-config. Run `node contexts/tools/split-pipeline.mjs merge` to',
    '# regenerate this seed from the current split files (loses analyzer-written content',
    '# unless you commit the split files first).',
    '# ═══════════════════════════════════════════════════════════════════════',
  ].join('\n');
}

// ── Split: monolithic → siblings ─────────────────────────────────────────

export function splitMonolithic(monolithicText, pack, { stripComments = true } = {}) {
  const { sections } = extractSections(monolithicText);
  const outputs = {};

  for (const [suffix, config] of Object.entries(ROUTING)) {
    const blocks = [];
    for (const key of config.sections) {
      if (sections[key]) blocks.push(sections[key]);
    }
    if (blocks.length === 0) continue;
    const filename = splitFilename(pack, suffix);
    const raw = splitFileHeader(pack, suffix, config.description) + '\n\n' + blocks.join('\n\n') + '\n';
    // Runtime splits are comment-stripped by default for token efficiency.
    // Pass { stripComments: false } to keep comments (e.g. for debugging).
    outputs[filename] = stripComments ? stripCommentLines(raw) : raw;
  }

  return outputs;
}

// ── Section-aware merge (used by `install --merge-config`) ──────────────
//
// Take a dev's CURRENT split file (which may carry analyzer writes + dev edits)
// plus the INCOMING split content freshly produced from the new pack seed, and
// produce a merged file according to SECTION_OWNERS.
//
// Policy:
//   For each top-level section that appears in either side:
//     - owner 'analyzer' AND current has it → preserve current (dev's writes)
//     - owner 'analyzer' AND current missing → use incoming (initial stub)
//     - owner 'pack'                          → use incoming (pack changes win)
//     - section in current only AND owner 'pack' → drop (pack removed it)
//     - section in current only AND owner 'analyzer' → keep (don't lose data)
//
// Output ordering: follows incoming's section order (= new pack's intent).
// Sections kept from current that aren't in incoming get appended at the end.
//
// Comments INSIDE each section block are preserved (we work at the section
// granularity using extractSections). The file's prelude (everything before
// the first section) is taken from incoming so updated header docs reach the dev.
//
// Returns { merged: string, log: string[] }. Log is per-section, ready to print.
export function mergeSplitContent(currentText, incomingText) {
  const cur = extractSections(currentText);
  const inc = extractSections(incomingText);
  const log = [];

  const out = [];
  if (inc.prelude) out.push(inc.prelude);

  const seen = new Set();
  // Pass 1: walk incoming sections in their declared order
  for (const key of Object.keys(inc.sections)) {
    seen.add(key);
    const owner = SECTION_OWNERS[key] || 'pack';
    if (owner === 'analyzer' && cur.sections[key] != null) {
      out.push(cur.sections[key]);
      log.push(`    ${key}: preserved (analyzer-owned, ${countLines(cur.sections[key])} lines)`);
    } else if (owner === 'analyzer') {
      out.push(inc.sections[key]);
      log.push(`    ${key}: added from pack seed (analyzer-owned, initial stub)`);
    } else {
      // pack-owned
      out.push(inc.sections[key]);
      const action = cur.sections[key] != null
        ? (cur.sections[key] === inc.sections[key] ? 'unchanged' : 'updated from pack seed')
        : 'added from pack seed';
      log.push(`    ${key}: ${action} (pack-owned)`);
    }
  }
  // Pass 2: sections in current but not in incoming
  for (const key of Object.keys(cur.sections)) {
    if (seen.has(key)) continue;
    const owner = SECTION_OWNERS[key] || 'pack';
    if (owner === 'analyzer') {
      out.push(cur.sections[key]);
      log.push(`    ${key}: kept (analyzer-owned, not in new pack seed)`);
    } else {
      log.push(`    ${key}: removed (pack-owned, no longer in pack seed)`);
    }
  }

  // Runtime splits are comment-stripped (agents pay tokens for every comment).
  // Pack-author comments live in the monolithic seed + forauthor.readme.md.
  const merged = stripCommentLines(out.join('\n\n') + '\n');
  return { merged, log };
}

function countLines(text) {
  return text.split('\n').length;
}

// ── Merge: siblings → monolithic ─────────────────────────────────────────

export function mergeSplitsToMonolithic(splitDir, pack) {
  const allSections = {};

  for (const suffix of Object.keys(ROUTING)) {
    const filename = splitFilename(pack, suffix);
    const path = join(splitDir, filename);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const { sections } = extractSections(text);
    Object.assign(allSections, sections);
  }

  // Build monolithic in canonical order
  const blocks = [monolithicHeader(pack)];
  for (const key of MONOLITHIC_ORDER) {
    if (allSections[key]) blocks.push(allSections[key]);
  }
  return blocks.join('\n\n') + '\n';
}

// ── CLI ──────────────────────────────────────────────────────────────────

function isMain() {
  // Detect direct invocation. Skips when imported.
  return import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const op = positional[0];
  if (!op || (op !== 'split' && op !== 'merge')) {
    console.error('Usage:');
    console.error('  node contexts/tools/split-pipeline.mjs split [--source PATH] [--dest DIR] [--pack <name>] [--force]');
    console.error('  node contexts/tools/split-pipeline.mjs merge [--source DIR] [--dest PATH] [--pack <name>]');
    process.exit(2);
  }

  const { values: args } = parseArgs({
    args: process.argv.slice(3),
    options: {
      source: { type: 'string' },
      dest:   { type: 'string' },
      pack:   { type: 'string', default: 'your-project' },
      force:  { type: 'boolean', default: false },
    },
    strict: true,
  });

  const PACK = args.pack;
  const repoRoot = process.cwd();

  if (op === 'split') {
    // Smart source default:
    //   - release/pack repo: packs/<pack>/pipeline.<pack>.yaml (pack source)
    //   - user project:      contexts/pipeline.<pack>.yaml (installed seed)
    let source;
    if (args.source) {
      source = resolve(args.source);
    } else {
      const packSeedPath = join(repoRoot, 'packs', PACK, `pipeline.${PACK}.yaml`);
      const installedSeedPath = join(repoRoot, 'contexts', `pipeline.${PACK}.yaml`);
      if (existsSync(packSeedPath))           source = packSeedPath;
      else if (existsSync(installedSeedPath)) source = installedSeedPath;
      else                                     source = installedSeedPath;  // for error message
    }
    const dest = args.dest ? resolve(args.dest) : join(repoRoot, 'contexts', 'config');
    if (!existsSync(source)) { console.error(`source not found: ${source}`); process.exit(1); }
    mkdirSync(dest, { recursive: true });

    const monolithic = readFileSync(source, 'utf8');
    const outputs = splitMonolithic(monolithic, PACK);

    let written = 0, skipped = 0;
    for (const [filename, content] of Object.entries(outputs)) {
      const outPath = join(dest, filename);
      if (existsSync(outPath) && !args.force) {
        console.log(`  ${filename}: preserved (already exists; use --force to overwrite)`);
        skipped++;
      } else {
        writeFileSync(outPath, content);
        console.log(`  ${filename}: ${existsSync(outPath) ? 'updated' : 'created'} (${content.length} bytes)`);
        written++;
      }
    }
    console.log(`split: ${written} written, ${skipped} skipped`);
  } else {
    // merge — smart default destination:
    //   - release/pack repo: writes to packs/<pack>/pipeline.<pack>.yaml (pack source)
    //   - user project:      writes to contexts/pipeline.<pack>.yaml (installed seed)
    // Override with --dest.
    const source = args.source ? resolve(args.source) : join(repoRoot, 'contexts', 'config');
    if (!existsSync(source)) { console.error(`source dir not found: ${source}`); process.exit(1); }

    let dest;
    if (args.dest) {
      dest = resolve(args.dest);
    } else {
      const packSeedPath = join(repoRoot, 'packs', PACK, `pipeline.${PACK}.yaml`);
      const installedSeedPath = join(repoRoot, 'contexts', `pipeline.${PACK}.yaml`);
      if (existsSync(packSeedPath))       dest = packSeedPath;        // pack-author / release repo
      else                                 dest = installedSeedPath;   // user project
    }

    const merged = mergeSplitsToMonolithic(source, PACK);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, merged);
    console.log(`merge: ${dest} written (${merged.length} bytes)`);
  }
}
