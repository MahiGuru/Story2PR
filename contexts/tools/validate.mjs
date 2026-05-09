#!/usr/bin/env node
/**
 * validate.mjs — validate pipeline.yaml and (optionally) regenerate the
 * Layer Map Catalog from it.
 *
 * Part of the agent-pipeline kernel.
 *
 * Usage:
 *   node tools/validate.mjs                          # validate
 *   node tools/validate.mjs --emit-catalog           # stdout
 *   node tools/validate.mjs --update-catalog         # write _catalog.md
 *   node tools/validate.mjs --config PATH            # explicit path
 *   node tools/validate.mjs --quiet                  # CI mode
 *
 * Exit codes: 0 — pass, 1 — errors, 2 — env problem
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { parseArgs } from 'util';
import yaml from './vendor/js-yaml.mjs';

// ── ANSI colors ──────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = (code) => isTTY ? code : '';
const RED = c('\x1b[31m'), GREEN = c('\x1b[32m'), YELLOW = c('\x1b[33m');
const BOLD = c('\x1b[1m'), DIM = c('\x1b[2m'), RESET = c('\x1b[0m');

const SUPPORTED_SCHEMA = 2;

// ── Core: normalize a layer string the same way Surgeon does ─────────────
function norm(s) {
  return s.trim().toLowerCase().replace(/[\s/\\\-_]+/g, '/').replace(/^\/|\/$/g, '');
}

// ── Filesystem helpers ───────────────────────────────────────────────────
function globDir(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(ext));
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// ── Config discovery ─────────────────────────────────────────────────────
//
// Pipeline config layout:
//   pipeline.<pack>.yaml             — CORE (one dot after "pipeline.")
//   pipeline.<pack>.<view>.yaml      — sibling views (skills, builds, analyzer, demo)
//
// `discoverConfigFiles` returns { coreFile, siblingFiles, configDir }.
// `loadAndMerge` reads them all and returns one merged config + a key→file
// index used for the cross-file collision check.

function discoverConfigFiles(repoRoot) {
  const configDir = join(repoRoot, 'contexts', 'config');
  if (!existsSync(configDir)) return { coreFile: null, siblingFiles: [], configDir };

  const all = readdirSync(configDir).filter(f => f.endsWith('.yaml') && !f.endsWith('.example.yaml'));

  const coreCandidates = [];
  const siblings = [];

  for (const f of all) {
    const m = f.match(/^pipeline\.(.+)\.yaml$/);
    if (!m) continue;
    // m[1] is the pack stem — "<pack>" (core) or "<pack>.skills" (sibling)
    if (m[1].includes('.')) siblings.push(f);
    else coreCandidates.push(f);
  }

  const coreFile = coreCandidates.length > 0 ? coreCandidates.sort()[0] : null;
  return { coreFile, siblingFiles: siblings.sort(), configDir };
}

function loadAndMerge(coreFile, siblingFiles, configDir) {
  const merged = {};
  const fileForKey = {};
  const collisions = [];
  const parseErrors = [];

  const files = coreFile ? [coreFile, ...siblingFiles] : siblingFiles;

  for (const f of files) {
    const path = join(configDir, f);
    let parsed;
    try {
      parsed = yaml.load(readFileSync(path, 'utf8'));
    } catch (e) {
      parseErrors.push({ file: f, message: e.message });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      parseErrors.push({ file: f, message: 'top-level YAML is not a mapping' });
      continue;
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (k in merged) {
        collisions.push({ key: k, files: [fileForKey[k], f] });
      }
      merged[k] = v;
      fileForKey[k] = f;
    }
  }

  return { merged, fileForKey, collisions, parseErrors, files };
}

/**
 * Locate skill directories across both host layouts:
 *   - Cursor (.cursor/skills/): flat <name>.md files
 *   - Claude Code (.claude/skills/): each skill is a <name>/SKILL.md directory
 *   - Source packs (packs / star / skills/): always flat (release format)
 *
 * Returns [{dir, layout: 'flat'|'dir'}] so callers know how to enumerate.
 */
function findSkillDirs(repoRoot) {
  const dirs = [];
  const cursorDir = join(repoRoot, '.cursor', 'skills');
  if (isDir(cursorDir)) dirs.push({ dir: cursorDir, layout: 'flat' });
  const claudeDir = join(repoRoot, '.claude', 'skills');
  if (isDir(claudeDir)) dirs.push({ dir: claudeDir, layout: 'dir' });
  const packs = join(repoRoot, 'packs');
  if (isDir(packs)) {
    for (const p of readdirSync(packs)) {
      const sd = join(packs, p, 'skills');
      if (isDir(sd)) dirs.push({ dir: sd, layout: 'flat' });
    }
  }
  return dirs;
}

/**
 * Agents are flat .md files in both host layouts, so no per-entry layout needed.
 */
function findAgentDirs(repoRoot) {
  const dirs = [];
  const cursorInstalled = join(repoRoot, '.cursor', 'agents');
  if (isDir(cursorInstalled)) dirs.push(cursorInstalled);
  const claudeInstalled = join(repoRoot, '.claude', 'agents');
  if (isDir(claudeInstalled)) dirs.push(claudeInstalled);
  const kernel = join(repoRoot, 'agent-pipeline', 'agents');
  if (isDir(kernel)) dirs.push(kernel);
  const packs = join(repoRoot, 'packs');
  if (isDir(packs)) {
    for (const p of readdirSync(packs)) {
      const ad = join(packs, p, 'agents');
      if (isDir(ad)) dirs.push(ad);
    }
  }
  return dirs;
}

/**
 * Returns a Set of logical skill filenames (e.g. "<pack>-<layer>-standards.md")
 * matching the refs in pipeline.yaml, regardless of on-disk layout.
 *
 *   flat layout:  <name>.md              → "<name>.md"
 *   dir layout:   <name>/SKILL.md        → "<name>.md"  (normalized)
 */
function allSkillFiles(skillEntries) {
  const files = new Set();
  for (const { dir, layout } of skillEntries) {
    if (layout === 'flat') {
      for (const f of globDir(dir, '.md')) files.add(f);
    } else {
      // 'dir' layout: each subdir containing SKILL.md is a skill
      try {
        for (const entry of readdirSync(dir)) {
          const subdir = join(dir, entry);
          try {
            if (statSync(subdir).isDirectory() && existsSync(join(subdir, 'SKILL.md'))) {
              files.add(entry + '.md');
            }
          } catch { /* ignore dangling entries */ }
        }
      } catch { /* ignore unreadable dir */ }
    }
  }
  return files;
}

function allAgentFiles(agentDirs) {
  const files = new Set();
  for (const d of agentDirs) {
    for (const f of globDir(d, '.md')) files.add(f);
  }
  return files;
}

// ── Report ───────────────────────────────────────────────────────────────
export class Report {
  constructor() { this.errors = []; this.warnings = []; }
  err(msg) { this.errors.push(msg); }
  warn(msg) { this.warnings.push(msg); }
  get ok() { return this.errors.length === 0; }
  print() {
    if (this.errors.length) {
      console.log(`${BOLD}${RED}ERRORS (${this.errors.length})${RESET}`);
      for (const e of this.errors) console.log(`  ${RED}✗${RESET} ${e}`);
    }
    if (this.warnings.length) {
      console.log(`${BOLD}${YELLOW}WARNINGS (${this.warnings.length})${RESET}`);
      for (const w of this.warnings) console.log(`  ${YELLOW}!${RESET} ${w}`);
    }
    if (!this.errors.length && !this.warnings.length)
      console.log(`${BOLD}${GREEN}✓ all checks passed${RESET}`);
    else if (!this.errors.length)
      console.log(`${BOLD}${GREEN}✓ no errors${RESET} (${this.warnings.length} warning(s))`);
  }
}

// ── Validation ───────────────────────────────────────────────────────────
// Accepts a pre-parsed config object (caller drives single- or multi-file load).
// `sourceLabel` is used in error messages — caller passes the path or "merged".
// `fileForKey` (optional) is the key→sibling-file index from a multi-file load,
// used only by Check 11 to attribute collision-prone keys to their files.
export function validate(parsed, repoRoot, sourceLabel = '<config>', fileForKey = null) {
  const r = new Report();

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    r.err(`top-level config in ${sourceLabel} is not a mapping`);
    return [r, null];
  }

  const p = parsed;

  // ── Check 0: meta.schema_version ──
  const meta = p.meta || {};
  const sv = meta.schema_version;
  if (sv == null) {
    r.warn(`meta.schema_version not declared (expected: ${SUPPORTED_SCHEMA})`);
  } else if (sv !== SUPPORTED_SCHEMA) {
    r.warn(`meta.schema_version=${sv}, this validator supports schema_version=${SUPPORTED_SCHEMA}`);
  }

  // ── Check 0b: project identity — REMOVED ──
  // The `project:` block (ticket_prefixes / epic_prefix / branch_patterns)
  // was never consumed by any agent prompt. Agents use `runtime.branching.*`
  // for branch logic and extract the ticket prefix from the trigger itself.
  // The block was dead config; removed to avoid misleading pack authors.
  // Presence of a stale `project:` block is silently ignored (not an error,
  // not a warning — the data is just unused).

  // ── Check 1: required top-level keys ──
  const skills = p.skills;
  if (!skills || typeof skills !== 'object') {
    r.err('missing or invalid required top-level key: skills');
    return [r, p];
  }
  const lm = skills.layer_map;
  if (!lm || typeof lm !== 'object' || Object.keys(lm).length === 0) {
    r.err('skills.layer_map is missing, empty, or not a mapping');
    return [r, p];
  }
  const builds = p.builds || {};
  const buildCmds = builds.commands || {};
  if (Object.keys(buildCmds).length === 0) {
    r.warn("missing builds.commands — Surgeon Step 3 build resolution will fail");
  }

  // ── Check 2: no duplicate normalized canonical keys ──
  const seenCanonical = {};
  for (const cid of Object.keys(lm)) {
    const n = norm(cid);
    if (n in seenCanonical && seenCanonical[n] !== cid) {
      r.err(`skills.layer_map: keys '${seenCanonical[n]}' and '${cid}' both normalize to '${n}' — duplicate entry`);
    } else {
      seenCanonical[n] = cid;
    }
  }

  // ── Check 3: alias collisions ──
  const aliasIndex = {};
  for (const [cid, entry] of Object.entries(lm)) {
    if (!entry || typeof entry !== 'object') {
      r.err(`skills.layer_map['${cid}'] is not a mapping`);
      continue;
    }
    const nCid = norm(cid);
    if (!(nCid in aliasIndex)) aliasIndex[nCid] = [cid, `canonical key '${cid}'`];
    for (const alias of entry.aliases || []) {
      const nAlias = norm(alias);
      if (nAlias in aliasIndex) {
        const [otherCid, otherSrc] = aliasIndex[nAlias];
        if (otherCid !== cid) {
          r.err(`alias '${alias}' on layer '${cid}' collides with ${otherSrc} (both normalize to '${nAlias}')`);
        }
      } else {
        aliasIndex[nAlias] = [cid, `alias on '${cid}'`];
      }
    }
  }

  // ── Check 4: referenced skill files exist on disk ──
  const skillDirs = findSkillDirs(repoRoot);
  const available = allSkillFiles(skillDirs);
  if (skillDirs.length === 0) {
    r.warn("no skill directories found (checked .cursor/skills/, .claude/skills/, and packs/*/skills/) — skipping skill existence checks");
  }

  function checkSkill(filename, source) {
    if (skillDirs.length > 0 && !available.has(filename)) {
      r.err(`skill '${filename}' referenced by ${source} not found on disk`);
    }
  }

  for (const [cid, entry] of Object.entries(lm)) {
    if (!entry || typeof entry !== 'object') continue;
    for (const s of entry.skills || []) checkSkill(s, `skills.layer_map['${cid}'].skills`);
    for (const s of entry.always_add || []) checkSkill(s, `skills.layer_map['${cid}'].always_add`);
  }
  for (let i = 0; i < (skills.extra_triggers || []).length; i++) {
    const t = skills.extra_triggers[i];
    if (!t || typeof t !== 'object') { r.err(`skills.extra_triggers[${i}] is not a mapping`); continue; }
    for (const s of t.add || []) checkSkill(s, `skills.extra_triggers[${i}].add`);
  }
  const orch = skills.orchestrator || {};
  if (orch.lld_generator) checkSkill(orch.lld_generator, 'skills.orchestrator.lld_generator');
  const expl = skills.explorer || {};
  for (const key of ['bug_router', 'bug_frontend', 'bug_backend']) {
    if (expl[key]) checkSkill(expl[key], `skills.explorer.${key}`);
  }

  // ── Check 5: path_glob presence on non-composite layers ──
  const NAMING_BASED_OK = new Set(['Test', 'Tests']);
  for (const [cid, entry] of Object.entries(lm)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.resolve === 'composite') continue;
    if (!('path_glob' in entry) && !NAMING_BASED_OK.has(cid)) {
      r.warn(`skills.layer_map['${cid}']: no path_glob declared — Strategy A (file-based resolution) cannot reach this layer`);
    }
  }

  // ── Check 6: layer_map[].build must reference existing builds.commands key ──
  for (const [cid, entry] of Object.entries(lm)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.resolve === 'composite') continue;
    const b = entry.build;
    if (b && !(b in buildCmds)) {
      r.err(`skills.layer_map['${cid}'].build='${b}' is not declared in builds.commands (known: ${Object.keys(buildCmds).sort().join(', ')})`);
    }
  }

  // ── Check 7: subagents (optional, validated if present) ──
  const VALID_EPS = {
    orchestrator_amend_request: new Set(['amended', 'cancelled', 'unchanged']),
    orchestrator_image_analysis: new Set(['complete', 'partial', 'failed', 'skipped']),
    surgeon_pre_task: new Set(['continue', 'skip_task', 'abort']),
    surgeon_post_task: new Set(['continue', 'redo_task', 'abort']),
    review_post_check: new Set(['continue', 'fail_review', 'flag_for_user']),
  };
  const sa = p.subagents;
  if (sa && typeof sa === 'object') {
    const agentDirs = findAgentDirs(repoRoot);
    const availableAgents = allAgentFiles(agentDirs);

    for (const [epName, decls] of Object.entries(sa)) {
      if (!(epName in VALID_EPS)) {
        r.err(`subagents: extension point '${epName}' is not valid (valid: ${Object.keys(VALID_EPS).sort().join(', ')})`);
        continue;
      }
      if (!Array.isArray(decls)) continue;
      const validVerbs = VALID_EPS[epName];
      for (let i = 0; i < decls.length; i++) {
        const decl = decls[i];
        if (!decl || typeof decl !== 'object') { r.err(`subagents.${epName}[${i}] is not a mapping`); continue; }
        const saFile = decl.file;
        if (saFile) {
          if (agentDirs.length > 0 && !availableAgents.has(saFile)) {
            r.err(`subagent '${saFile}' referenced by subagents.${epName}[${i}] not found on disk`);
          }
        } else {
          r.err(`subagents.${epName}[${i}] missing required 'file' key`);
        }
        const ret = decl.return;
        if (ret && Array.isArray(ret)) {
          const unknown = ret.filter(v => !validVerbs.has(v));
          if (unknown.length > 0) {
            r.err(`subagents.${epName}[${i}] declares unknown return verb(s) ${JSON.stringify(unknown.sort())} — valid for ${epName}: ${JSON.stringify([...validVerbs].sort())}`);
          }
        } else if (ret == null) {
          r.warn(`subagents.${epName}[${i}] missing 'return' key — parent agent won't know what verbs to expect`);
        }
      }
    }
    if (agentDirs.length === 0) {
      r.warn("no agent directories found (checked .cursor/agents/, .claude/agents/, and packs/*/agents/) — skipping subagent file existence checks");
    }
  }

  // ── Check 8: runtime.contexts_layout (optional) ──
  const runtime = p.runtime || {};
  const cl = runtime.contexts_layout;
  if (cl != null) {
    if (typeof cl !== 'object' || Array.isArray(cl)) {
      r.err('runtime.contexts_layout: must be a mapping');
    } else {
      const nbe = cl.nested_by_epic;
      if (nbe != null && typeof nbe !== 'boolean') r.err(`runtime.contexts_layout.nested_by_epic: must be bool, got ${typeof nbe} (${JSON.stringify(nbe)})`);
      const efc = cl.epic_folder_case;
      if (efc != null && !['lower', 'preserve'].includes(efc)) r.err(`runtime.contexts_layout.epic_folder_case: must be 'lower' or 'preserve', got ${JSON.stringify(efc)}`);
      const sf = cl.standalone_folder;
      if (sf != null) {
        if (typeof sf !== 'string' || !sf) r.err(`runtime.contexts_layout.standalone_folder: must be a non-empty string, got ${JSON.stringify(sf)}`);
        else if (/[/\\ ]/.test(sf) || sf.startsWith('.')) r.err(`runtime.contexts_layout.standalone_folder: must be a single folder name (got ${JSON.stringify(sf)})`);
      }
      const cmf = cl.codebase_map_filename;
      if (cmf != null) {
        if (typeof cmf !== 'string' || !cmf.endsWith('.md')) r.err(`runtime.contexts_layout.codebase_map_filename: must end in '.md', got ${JSON.stringify(cmf)}`);
        else if (/[/\\]/.test(cmf)) r.err(`runtime.contexts_layout.codebase_map_filename: must be a bare filename (got ${JSON.stringify(cmf)})`);
      }
    }
  }

  // ── Check 9: runtime.trigger (optional) ──
  const tr = runtime.trigger;
  if (tr != null) {
    if (typeof tr !== 'object' || Array.isArray(tr)) {
      r.err('runtime.trigger: must be a mapping');
    } else {
      const ick = tr.inline_context_keyword;
      if (ick != null && !['required', 'optional'].includes(ick)) {
        r.err(`runtime.trigger.inline_context_keyword: must be 'required' or 'optional', got ${JSON.stringify(ick)}`);
      }
    }
  }

  // ── Check 9a: runtime.bundle (optional · multi-story consolidation) ──
  //
  // Settings for bundle mode (Work on epic stories ..., Work on epic <ID> with
  // status="..."). Single-story flow ignores this block entirely. Validation is
  // strict on enum values + numeric ranges so typos halt at install time
  // rather than mid-bundle.
  const bn = runtime.bundle;
  if (bn != null) {
    if (typeof bn !== 'object' || Array.isArray(bn)) {
      r.err('runtime.bundle: must be a mapping');
    } else {
      // enabled — bool
      if (bn.enabled != null && typeof bn.enabled !== 'boolean') {
        r.err(`runtime.bundle.enabled: must be bool, got ${typeof bn.enabled}`);
      }

      // numeric guards
      const intInRange = (key, min, max) => {
        const v = bn[key];
        if (v == null) return;
        if (!Number.isInteger(v) || v < min || v > max) {
          r.err(`runtime.bundle.${key}: must be integer in [${min}, ${max}], got ${JSON.stringify(v)}`);
        }
      };
      intInRange('max_tickets', 2, 50);
      intInRange('warn_tickets', 2, 50);
      if (Number.isInteger(bn.max_tickets) && Number.isInteger(bn.warn_tickets)
          && bn.warn_tickets > bn.max_tickets) {
        r.err(`runtime.bundle.warn_tickets (${bn.warn_tickets}) must be <= max_tickets (${bn.max_tickets})`);
      }

      // enum: cross_epic_policy
      if (bn.cross_epic_policy != null
          && !['warn_continue', 'strict'].includes(bn.cross_epic_policy)) {
        r.err(`runtime.bundle.cross_epic_policy: must be 'warn_continue' or 'strict', got ${JSON.stringify(bn.cross_epic_policy)}`);
      }

      // branch_naming sub-block
      const bnam = bn.branch_naming;
      if (bnam != null) {
        if (typeof bnam !== 'object' || Array.isArray(bnam)) {
          r.err('runtime.bundle.branch_naming: must be a mapping');
        } else {
          if (bnam.list_threshold != null
              && (!Number.isInteger(bnam.list_threshold) || bnam.list_threshold < 1)) {
            r.err(`runtime.bundle.branch_naming.list_threshold: must be positive integer, got ${JSON.stringify(bnam.list_threshold)}`);
          }
          for (const k of ['list_form', 'hash_form']) {
            if (bnam[k] != null && (typeof bnam[k] !== 'string' || !bnam[k])) {
              r.err(`runtime.bundle.branch_naming.${k}: must be a non-empty string, got ${JSON.stringify(bnam[k])}`);
            }
          }
          if (bnam.hash_algo != null && !['sha1', 'sha256'].includes(bnam.hash_algo)) {
            r.err(`runtime.bundle.branch_naming.hash_algo: must be 'sha1' or 'sha256', got ${JSON.stringify(bnam.hash_algo)}`);
          }
          if (bnam.hash_chars != null
              && (!Number.isInteger(bnam.hash_chars) || bnam.hash_chars < 3 || bnam.hash_chars > 12)) {
            r.err(`runtime.bundle.branch_naming.hash_chars: must be integer in [3, 12], got ${JSON.stringify(bnam.hash_chars)}`);
          }
        }
      }

      // status_filter sub-block
      const sf = bn.status_filter;
      if (sf != null) {
        if (typeof sf !== 'object' || Array.isArray(sf)) {
          r.err('runtime.bundle.status_filter: must be a mapping');
        } else {
          for (const k of ['allow_groups', 'allow_raw_jql', 'reject_in_progress_for_merge']) {
            if (sf[k] != null && typeof sf[k] !== 'boolean') {
              r.err(`runtime.bundle.status_filter.${k}: must be bool, got ${typeof sf[k]}`);
            }
          }
        }
      }

      // state_filename
      if (bn.state_filename != null) {
        if (typeof bn.state_filename !== 'string' || !bn.state_filename.endsWith('.yaml')) {
          r.err(`runtime.bundle.state_filename: must end in '.yaml', got ${JSON.stringify(bn.state_filename)}`);
        } else if (/[/\\]/.test(bn.state_filename)) {
          r.err(`runtime.bundle.state_filename: must be a bare filename (got ${JSON.stringify(bn.state_filename)})`);
        }
      }

      // checkpoint_every sub-block
      const ce = bn.checkpoint_every;
      if (ce != null) {
        if (typeof ce !== 'object' || Array.isArray(ce)) {
          r.err('runtime.bundle.checkpoint_every: must be a mapping');
        } else {
          for (const k of ['explorer', 'surgeon', 'review']) {
            if (ce[k] != null && (!Number.isInteger(ce[k]) || ce[k] < 1 || ce[k] > 50)) {
              r.err(`runtime.bundle.checkpoint_every.${k}: must be integer in [1, 50], got ${JSON.stringify(ce[k])}`);
            }
          }
        }
      }

      // task_ordering — enum
      if (bn.task_ordering != null
          && !['layer_dep', 'by_story', 'phase_a'].includes(bn.task_ordering)) {
        r.err(`runtime.bundle.task_ordering: must be 'layer_dep', 'by_story', or 'phase_a', got ${JSON.stringify(bn.task_ordering)}`);
      }

      // partial_ship_policy — enum
      if (bn.partial_ship_policy != null
          && !['ask', 'halt', 'ship_passed'].includes(bn.partial_ship_policy)) {
        r.err(`runtime.bundle.partial_ship_policy: must be 'ask', 'halt', or 'ship_passed', got ${JSON.stringify(bn.partial_ship_policy)}`);
      }

      // epic_framing sub-block
      const ef = bn.epic_framing;
      if (ef != null) {
        if (typeof ef !== 'object' || Array.isArray(ef)) {
          r.err('runtime.bundle.epic_framing: must be a mapping');
        } else {
          for (const k of ['enabled', 'fetch_prd', 'fetch_hld', 'fetch_spikes']) {
            if (ef[k] != null && typeof ef[k] !== 'boolean') {
              r.err(`runtime.bundle.epic_framing.${k}: must be bool, got ${typeof ef[k]}`);
            }
          }
          for (const k of ['prd_search_queries', 'hld_search_queries']) {
            if (ef[k] != null) {
              if (!Array.isArray(ef[k])) {
                r.err(`runtime.bundle.epic_framing.${k}: must be an array, got ${typeof ef[k]}`);
              } else {
                ef[k].forEach((q, i) => {
                  if (typeof q !== 'string' || !q) {
                    r.err(`runtime.bundle.epic_framing.${k}[${i}]: must be a non-empty string, got ${JSON.stringify(q)}`);
                  }
                });
              }
            }
          }
        }
      }

      // deep_overlap_default — bool
      if (bn.deep_overlap_default != null && typeof bn.deep_overlap_default !== 'boolean') {
        r.err(`runtime.bundle.deep_overlap_default: must be bool, got ${typeof bn.deep_overlap_default}`);
      }
    }
  }

  // ── Check 9b: jira.status_groups (optional · drift-check buckets) ──
  //
  // Read-side JIRA status classification used by Orchestrator's drift check
  // (A.4a-bis). Four buckets with distinct semantics:
  //   active_hydrate   — in-flight + stable (warn + pull LLD into epic-context)
  //   active_flag_only — in-flight + volatile (warn only, no LLD fetch)
  //   completed        — shipped / merged (pull LLD + suggest git pull)
  //   (everything else) — implicitly skipped (backlog/grooming/rejected)
  //
  // Back-compat / fallback (most-specific → least-specific):
  //   (1) jira.status_groups.{active_hydrate, active_flag_only, completed}
  //   (2) jira.status_groups.active (legacy flat shape) → treat as active_flag_only
  //   (3) legacy jira.active_states (pre-v24) → treat as active_flag_only
  //   (4) status_map values + "Done" (pre-v23 default)
  //
  // Each declared list must be non-empty and contain non-empty strings matching
  // the exact JIRA status names (e.g. "In Development", "Code Review"). A status
  // may appear in exactly ONE bucket — overlap across any pair is a hard error.
  const ALL_BUCKETS = ['active_hydrate', 'active_flag_only', 'active', 'completed'];
  const jira = p.jira;
  if (jira != null && typeof jira === 'object' && !Array.isArray(jira)) {
    const sg = jira.status_groups;
    if (sg != null) {
      if (typeof sg !== 'object' || Array.isArray(sg)) {
        r.err('jira.status_groups: must be a mapping with bucket keys (active_hydrate, active_flag_only, completed — or legacy "active")');
      } else {
        // Warn on unknown keys so typos don't silently drop statuses
        for (const key of Object.keys(sg)) {
          if (!ALL_BUCKETS.includes(key)) {
            r.warn(`jira.status_groups.${key}: unknown bucket — expected one of ${ALL_BUCKETS.join(', ')}`);
          }
        }
        // Reject mixing legacy flat "active" with new split buckets
        if (sg.active != null && (sg.active_hydrate != null || sg.active_flag_only != null)) {
          r.err('jira.status_groups: cannot declare both legacy "active" AND new "active_hydrate"/"active_flag_only" — pick one shape');
        }
        // Validate each declared bucket
        for (const bucket of ALL_BUCKETS) {
          const list = sg[bucket];
          if (list == null) continue;  // bucket is optional
          if (!Array.isArray(list)) {
            r.err(`jira.status_groups.${bucket}: must be a list of JIRA status names (strings)`);
          } else if (list.length === 0) {
            r.warn(`jira.status_groups.${bucket}: list is empty — declare at least one status or remove the key`);
          } else {
            for (const s of list) {
              if (typeof s !== 'string' || s.trim() === '') {
                r.err(`jira.status_groups.${bucket}: every entry must be a non-empty string, got ${JSON.stringify(s)}`);
              }
            }
          }
        }
        // Must have at least ONE in-flight bucket declared (or legacy active)
        const has_inflight = (Array.isArray(sg.active_hydrate) && sg.active_hydrate.length > 0)
                          || (Array.isArray(sg.active_flag_only) && sg.active_flag_only.length > 0)
                          || (Array.isArray(sg.active) && sg.active.length > 0);
        const has_completed = Array.isArray(sg.completed) && sg.completed.length > 0;
        if (!has_inflight && !has_completed) {
          r.warn('jira.status_groups: no non-empty buckets declared — drift check will fall back to defaults');
        }
        // Overlap detection across ALL declared pairs — a status must belong to exactly one bucket
        const declared = ALL_BUCKETS
          .filter(b => Array.isArray(sg[b]))
          .map(b => [b, new Set(sg[b].filter(s => typeof s === 'string'))]);
        for (let i = 0; i < declared.length; i++) {
          for (let j = i + 1; j < declared.length; j++) {
            const [a, setA] = declared[i];
            const [b, setB] = declared[j];
            const overlap = [...setA].filter(s => setB.has(s));
            if (overlap.length > 0) {
              r.err(`jira.status_groups: statuses ${JSON.stringify(overlap)} appear in both '${a}' and '${b}' — each status must belong to exactly one bucket`);
            }
          }
        }
      }
    }
    // Legacy active_states — warn if declared alongside status_groups; ignored at runtime
    if (jira.active_states != null) {
      if (sg != null) {
        r.warn('jira.active_states: declared alongside jira.status_groups — status_groups wins; remove active_states to avoid confusion');
      } else {
        if (!Array.isArray(jira.active_states)) {
          r.err('jira.active_states: must be a list of JIRA status names (strings) — or migrate to jira.status_groups.{active_hydrate, active_flag_only, completed}');
        } else if (jira.active_states.length === 0) {
          r.err('jira.active_states: list is empty — either remove the key or declare at least one status');
        } else {
          for (const s of jira.active_states) {
            if (typeof s !== 'string' || s.trim() === '') {
              r.err(`jira.active_states: every entry must be a non-empty string, got ${JSON.stringify(s)}`);
            }
          }
        }
      }
    }
  }

  // ── Check 10: mcp_servers (optional) ──
  //
  // Slim shape (PR 1b+): mcp_servers is a developer-onboarding registry
  // consumed only by mcp-sample-generator.mjs. Three fields per server:
  //   auth        — oauth | token | token_or_oauth
  //   config      — url (oauth) OR command+args+env (stdio)
  //   setup_hint  — pack-author docs for developer onboarding
  //
  // Retired fields (used_by, required, skip, fallback_prompt) are ignored
  // with a deprecation warning so legacy packs continue to parse cleanly.
  // Routing now lives exclusively in `mcp_roles:` below. Runtime skip is
  // via CLI flags (--offline / --skip / --only) or `mcp_roles.<role>: null`.
  const mcp = p.mcp_servers;
  const RETIRED_FIELDS = ['used_by', 'required', 'skip', 'fallback_prompt'];
  if (mcp != null) {
    if (typeof mcp !== 'object' || Array.isArray(mcp)) {
      r.err('mcp_servers: must be a mapping of server_name → config');
    } else {
      const validAuths = ['token', 'oauth', 'token_or_oauth'];
      for (const [sname, sconf] of Object.entries(mcp)) {
        const pfx = `mcp_servers.${sname}`;
        if (!sconf || typeof sconf !== 'object') { r.err(`${pfx}: must be a mapping`); continue; }
        const auth = sconf.auth;
        if (auth == null) r.warn(`${pfx}: missing 'auth' (defaulting to 'token')`);
        else if (!validAuths.includes(auth)) r.err(`${pfx}.auth: must be one of [${validAuths.join(', ')}], got ${JSON.stringify(auth)}`);
        const config = sconf.config;
        if (config == null) r.err(`${pfx}: missing 'config' block`);
        else if (typeof config === 'object') {
          if (auth === 'oauth') { if (!config.url) r.err(`${pfx}.config: auth=oauth requires a 'url' field`); }
          else if (!config.command && !config.url) r.err(`${pfx}.config: needs 'command' (stdio) or 'url' (remote)`);
        }
        const setupHint = sconf.setup_hint;
        if (setupHint != null && typeof setupHint !== 'string') {
          r.err(`${pfx}.setup_hint: must be a string, got ${typeof setupHint}`);
        }
        // Deprecation warning: legacy fields (used_by / required / skip / fallback_prompt)
        // were removed in v23 — routing is now driven by mcp_roles + CLI flags. Warnings
        // here are one-shot per server to keep the report tidy.
        const retired = RETIRED_FIELDS.filter(f => sconf[f] != null);
        if (retired.length > 0) {
          r.warn(`${pfx}: field(s) ${retired.map(f => "'" + f + "'").join(', ')} are retired — routing lives in mcp_roles, skip via CLI flags or mcp_roles.<role>:null. Safe to remove.`);
        }
      }
    }
  }

  // ── Check 11: mcp_roles (MANDATORY) + mcp_guidance (optional) ──
  //
  // Structured role-to-MCP mapping consumed by the Orchestrator at
  // pre-flight. Four role keys are required; each value references one
  // or more keys from mcp_servers: (single string or list).
  //
  // Validator enforces:
  //   V1 · all four mandatory roles present                        (error)
  //   V2 · every value references a real mcp_servers key           (error)
  //   V3 · mcp_guidance keys exist in mcp_roles (no orphan prose)  (warn)
  //   V4 · when mcp_roles is declared, mcp_servers.*.used_by is
  //        informational — warn if it's still being relied on      (warn)
  const REQUIRED_ROLES = ['story_source', 'design_source', 'vcs', 'docs_source'];
  // OPTIONAL_ROLES — opt-in keys validated for shape only (NOT enforced as present).
  // docs_publish is the write-side counterpart to docs_source; when set, Orchestrator
  // step B.3.5 publishes the LLD as a draft page. Local file stays canonical.
  const OPTIONAL_ROLES = ['docs_publish'];
  const roles = p.mcp_roles;
  const guidance = p.mcp_guidance;
  const publishTarget = p.docs_publish_target;

  if (roles == null) {
    // Missing entirely — this becomes an error once packs have migrated.
    // For now, warn so existing packs don't hard-fail on validate.
    r.warn(
      `mcp_roles: missing — required top-level block. Declare all four roles ` +
      `(${REQUIRED_ROLES.join(', ')}) mapping each to one or more mcp_servers keys. ` +
      `Without mcp_roles, Orchestrator falls back to legacy hardcoded MCP routing.`
    );
  } else if (typeof roles !== 'object' || Array.isArray(roles)) {
    r.err('mcp_roles: must be a mapping of role_name → mcp_key (string) | [mcp_key, ...] (list)');
  } else {
    const mcpKeys = new Set(mcp && typeof mcp === 'object' && !Array.isArray(mcp) ? Object.keys(mcp) : []);

    // V1 — required role keys must all be present
    for (const role of REQUIRED_ROLES) {
      if (!(role in roles)) {
        r.err(`mcp_roles.${role}: missing — this role is mandatory. Declare it as a single mcp_servers key or a fallback list.`);
      }
    }

    // V2 — every declared role's value must reference mcp_servers keys
    //
    // Three valid shapes for a role value:
    //   atlassian           → single primary MCP
    //   [atlassian, gitlab] → primary + fallbacks (non-empty list)
    //   null OR []          → explicit opt-out (role intentionally not used)
    //
    // A role being OPTED OUT is different from a role being MISSING. Missing
    // keys are V1 errors. null/[] means "the pack author decided this project
    // doesn't use this role" — downstream agents go straight to local fallback
    // without halting or warning.
    for (const [role, val] of Object.entries(roles)) {
      if (val == null) {
        // Explicit opt-out — treat as valid, no warning
        continue;
      }
      const candidates = Array.isArray(val) ? val : [val];
      if (candidates.length === 0) {
        // Explicit opt-out via empty list — treat as valid, no warning
        continue;
      }
      for (const cand of candidates) {
        if (typeof cand !== 'string' || !cand) {
          r.err(`mcp_roles.${role}: expected mcp_servers key (string), got ${JSON.stringify(cand)}`);
        } else if (mcpKeys.size > 0 && !mcpKeys.has(cand)) {
          r.err(`mcp_roles.${role}: references '${cand}' which is not declared in mcp_servers (known: ${[...mcpKeys].sort().join(', ') || '(none)'})`);
        }
      }
    }

    // V4 — retired. Legacy mcp_servers.*.used_by + related routing fields were
    // removed in v23 in favor of mcp_roles + CLI flags. Check 10 already warns
    // per-server when retired fields are found, so no aggregate message needed here.
  }

  // V3 — mcp_guidance keys must correspond to declared mcp_roles keys
  if (guidance != null) {
    if (typeof guidance !== 'object' || Array.isArray(guidance)) {
      r.err('mcp_guidance: must be a mapping of role_name → guidance text (string), or {} if unused');
    } else {
      const roleKeys = new Set(roles && typeof roles === 'object' && !Array.isArray(roles) ? Object.keys(roles) : []);
      for (const [gkey, gval] of Object.entries(guidance)) {
        if (roleKeys.size > 0 && !roleKeys.has(gkey)) {
          r.warn(`mcp_guidance.${gkey}: orphan — no matching role in mcp_roles. Remove, or add ${gkey} to mcp_roles.`);
        }
        if (gval != null && typeof gval !== 'string') {
          r.err(`mcp_guidance.${gkey}: expected a string (multi-line YAML literal OK), got ${typeof gval}`);
        } else if (typeof gval === 'string' && gval.trim() === '') {
          r.warn(`mcp_guidance.${gkey}: empty string — remove the key or add actual guidance text`);
        }
      }
    }
  }

  // V5 — docs_publish_target shape (only validated when mcp_roles.docs_publish is set).
  // The fifth role is opt-in; the target block carries its parent/space/draft-mode config.
  // Master switch is `enabled` — false means "configured but suspended" (no publish call,
  // no tokens consumed). Resolution ladder lives in agent-flow.mdc § MCP role resolution.
  const docsPublishVal = roles && typeof roles === 'object' && !Array.isArray(roles)
    ? roles.docs_publish
    : undefined;
  const docsPublishConfigured = docsPublishVal != null && !(Array.isArray(docsPublishVal) && docsPublishVal.length === 0);

  if (publishTarget != null) {
    if (typeof publishTarget !== 'object' || Array.isArray(publishTarget)) {
      r.err('docs_publish_target: must be a mapping (enabled, space, parent_page_id, state, title_format), or omitted entirely');
    } else {
      // enabled — boolean, defaults to true when omitted
      if ('enabled' in publishTarget && typeof publishTarget.enabled !== 'boolean') {
        r.err(`docs_publish_target.enabled: expected boolean, got ${typeof publishTarget.enabled}`);
      }
      // parent_page_id — string, required when publishing is actually wired up
      if ('parent_page_id' in publishTarget) {
        const ppid = publishTarget.parent_page_id;
        if (ppid != null && typeof ppid !== 'string') {
          r.err(`docs_publish_target.parent_page_id: expected string, got ${typeof ppid}`);
        }
      }
      // space — string (provider-specific: Confluence space, Notion database, etc.)
      if ('space' in publishTarget && publishTarget.space != null && typeof publishTarget.space !== 'string') {
        r.err(`docs_publish_target.space: expected string, got ${typeof publishTarget.space}`);
      }
      // state — must be 'draft' or 'current' if provided
      if ('state' in publishTarget && publishTarget.state != null) {
        if (typeof publishTarget.state !== 'string' || !['draft', 'current'].includes(publishTarget.state)) {
          r.err(`docs_publish_target.state: expected 'draft' or 'current', got ${JSON.stringify(publishTarget.state)}`);
        }
      }
      // title_format — string (template; optional)
      if ('title_format' in publishTarget && publishTarget.title_format != null && typeof publishTarget.title_format !== 'string') {
        r.err(`docs_publish_target.title_format: expected string, got ${typeof publishTarget.title_format}`);
      }
      // publish_gate — controls the user-consent prompt fired by Orchestrator C.5b
      // before any createPage/updatePage call. Default is 'always' (most cautious).
      if ('publish_gate' in publishTarget && publishTarget.publish_gate != null) {
        const validGates = ['always', 'first_only', 'never'];
        if (typeof publishTarget.publish_gate !== 'string' || !validGates.includes(publishTarget.publish_gate)) {
          r.err(`docs_publish_target.publish_gate: expected one of ${validGates.map(v => `'${v}'`).join(', ')}, got ${JSON.stringify(publishTarget.publish_gate)}`);
        }
        if (publishTarget.publish_gate === 'never') {
          r.warn(`docs_publish_target.publish_gate: 'never' disables user consent before publishing — only use for fully trusted automation. Most teams should keep the default ('always').`);
        }
      }
      // Cross-check: docs_publish set but enabled=false + parent_page_id present → informational warn
      if (docsPublishConfigured && publishTarget.enabled === false && publishTarget.parent_page_id) {
        r.warn(`docs_publish_target.enabled: false — publishing is suspended even though mcp_roles.docs_publish (${JSON.stringify(docsPublishVal)}) and parent_page_id are configured. Flip to true to resume.`);
      }
    }
  }

  // Cross-check: docs_publish set but no docs_publish_target block at all.
  // Agent can still run (defaults), but parent_page_id is required at publish time.
  if (docsPublishConfigured && publishTarget == null) {
    r.warn(`mcp_roles.docs_publish: set to ${JSON.stringify(docsPublishVal)} but docs_publish_target is missing. Add docs_publish_target with parent_page_id (and space if applicable) before B.3.5 can publish.`);
  }

  return [r, p];
}

// ── Catalog emission ─────────────────────────────────────────────────────
const CATALOG_HEADER =
  '# Layer Map Catalog\n\n' +
  '_This file is auto-generated by validate.mjs — do not edit by hand._\n' +
  '_Source: pipeline config (core + sibling YAMLs in `contexts/config/`). Regenerate with `node contexts/tools/validate.mjs --update-catalog`._\n\n';

function emitCatalog(p) {
  const skills = p.skills || {};
  const lm = skills.layer_map || {};
  const builds = p.builds || {};
  const buildCmds = builds.commands || {};
  const triggers = skills.extra_triggers || [];
  const orchSkills = skills.orchestrator || {};
  const explSkills = skills.explorer || {};

  function fmtBuild(bid) {
    if (!bid) return '—';
    if (!(bid in buildCmds)) return `\`${bid}\` _(undeclared)_`;
    const cmd = (typeof buildCmds[bid] === 'object' && buildCmds[bid]?.cmd) || '—';
    return `\`${bid}\` → \`${cmd}\``;
  }

  const lines = [CATALOG_HEADER.trimEnd(), ''];
  const w = (l) => lines.push(l);

  w('## What triggers what');
  w('');
  w('Quick reference for tech leads writing LLDs against this pack.');
  w('');
  w('**Five trigger mechanisms:**');
  w('');
  w('1. **Rules (Tier 1)** — always-on, fire on every agent run. Drop file in `packs/<pack>/rules/`. Not config-driven.');
  w('2. **Skills via `layer_map`** — Surgeon Step 0a, per task, by `Files` + `Layer`. Table 1.');
  w('3. **Skills via `extra_triggers`** — Surgeon Step 0a, additive. Table 2.');
  w('4. **Skills outside Surgeon** — per-agent skills (LLD generator, bug localization). Table 3.');
  w('5. **Subagents** — workers fired at kernel extension points. Table 4.');
  w('');
  w('### Table 1 — Skills triggered by `layer_map` (Surgeon Step 0a, per task)');
  w('');
  w('| Canonical `Layer:` | Aliases (also accepted) | `path_glob` | Skills loaded | Build command |');
  w('|---|---|---|---|---|');

  for (const [cid, entry] of Object.entries(lm)) {
    if (!entry || typeof entry !== 'object') continue;
    let aliasesCell, globCell, skillsCell, buildCell;
    if (entry.resolve === 'composite') {
      aliasesCell = '_(composite — resolved via frontend path_globs)_';
      globCell = '—';
      const skList = entry.always_add || [];
      skillsCell = skList.map(s => `\`${s}\``).join(', ') + ' + frontend skills via path_glob';
      buildCell = 'most-expensive matched layer';
    } else {
      const aliases = entry.aliases || [];
      aliasesCell = aliases.length ? aliases.map(a => `\`${a}\``).join(', ') : '_(only canonical key accepted)_';
      globCell = entry.path_glob ? `\`${entry.path_glob}\`` : '_(none — naming-based)_';
      const skList = entry.skills || [];
      skillsCell = skList.length ? skList.map(s => `\`${s}\``).join(', ') : '_(none)_';
      buildCell = fmtBuild(entry.build);
    }
    w(`| \`${cid}\` | ${aliasesCell} | ${globCell} | ${skillsCell} | ${buildCell} |`);
  }

  w('');
  w('### Table 2 — Additive triggers (Surgeon Step 0a, on top of Table 1)');
  w('');
  if (triggers.length > 0) {
    w('| Trigger condition | Additional skill(s) loaded |');
    w('|---|---|');
    for (const t of triggers) {
      const when = (t && typeof t === 'object') ? (t.when || '—') : '—';
      const adds = (t && typeof t === 'object') ? (t.add || []) : [];
      const addsCell = adds.length ? adds.map(s => `\`${s}\``).join(', ') : '_(none)_';
      w(`| ${when} | ${addsCell} |`);
    }
  } else {
    w('_(no `skills.extra_triggers` declared in this pack)_');
  }

  w('');
  w('### Table 3 — Skills triggered outside `layer_map` (per-agent, per-run)');
  w('');
  w('| Agent | Skill | Config key | When it fires |');
  w('|---|---|---|---|');
  if (orchSkills.lld_generator) w(`| Orchestrator | \`${orchSkills.lld_generator}\` | \`skills.orchestrator.lld_generator\` | Every Story Mode run (Phase B) |`);
  if (explSkills.bug_router) w(`| Explorer | \`${explSkills.bug_router}\` | \`skills.explorer.bug_router\` | Every Bug Mode run (Phase 0) |`);
  if (explSkills.bug_frontend) w(`| Explorer | \`${explSkills.bug_frontend}\` | \`skills.explorer.bug_frontend\` | Router detects frontend symptom |`);
  if (explSkills.bug_backend) w(`| Explorer | \`${explSkills.bug_backend}\` | \`skills.explorer.bug_backend\` | Router detects backend symptom |`);
  w('');
  w('Review and Ship load no skills via the YAML config.');

  w('');
  w('### Table 4 — Subagents (extension-point triggered)');
  w('');
  const saBlock = p.subagents || {};
  const hasSubagents = Object.values(saBlock).some(d => Array.isArray(d) && d.length > 0);
  if (hasSubagents) {
    w('| Extension point | Subagent file | Trigger | Return verbs | Description |');
    w('|---|---|---|---|---|');
    for (const [epName, decls] of Object.entries(saBlock)) {
      if (!Array.isArray(decls)) continue;
      for (const decl of decls) {
        if (!decl || typeof decl !== 'object') continue;
        const fileCell = `\`${decl.file || '—'}\``;
        const whenCell = decl.when || '—';
        const ret = Array.isArray(decl.return) ? decl.return.map(v => `\`${v}\``).join(', ') : '—';
        const descCell = decl.desc || '—';
        w(`| \`${epName}\` | ${fileCell} | ${whenCell} | ${ret} | ${descCell} |`);
      }
    }
    for (const [epName, decls] of Object.entries(saBlock)) {
      if (Array.isArray(decls) && decls.length === 0) {
        w(`| \`${epName}\` | _(none declared)_ | — | — | Available for pack subagents |`);
      }
    }
  } else {
    w("_(no subagents declared in this pack's `subagents:` section)_");
  }

  w('');
  w('---');
  w('');
  w('## How to extend');
  w('');
  w('**Add a new layer:** drop skill file → add `skills.layer_map` entry → `node contexts/tools/validate.mjs --update-catalog`');
  w('');
  w('**New alias:** add to existing entry\'s `aliases:` → `node contexts/tools/validate.mjs --update-catalog`');
  w('');
  w('**New subagent:** write prompt file → declare under `subagents.<extension_point>` → `node contexts/tools/validate.mjs --update-catalog`');
  w('');
  w('**New rule:** drop `.mdc` file in `packs/<pack>/rules/` — no config edit needed');
  w('');

  return lines.join('\n') + '\n';
}

function updateCatalogFile(configPath, catalog) {
  const catalogPath = join(dirname(configPath), '_catalog.md');
  if (existsSync(catalogPath)) {
    const existing = readFileSync(catalogPath, 'utf8');
    if (existing === catalog) return [catalogPath, false];
  }
  writeFileSync(catalogPath, catalog);
  return [catalogPath, true];
}

// ── CLI ──────────────────────────────────────────────────────────────────
// Only run the CLI when this file is invoked directly (not when imported
// as a library by, e.g., a fixture test). `import.meta.url` is a file:// URL;
// process.argv[1] is the filesystem path the node binary was given.
const __invokedAsScript = import.meta.url === `file://${process.argv[1]}`;
if (!__invokedAsScript) {
  // Imported as a library — stop here. `validate` + `Report` are the public API.
} else {

const { values: args } = parseArgs({
  options: {
    'config': { type: 'string' },
    'repo-root': { type: 'string', default: process.cwd() },
    'emit-catalog': { type: 'boolean', default: false },
    'update-catalog': { type: 'boolean', default: false },
    'quiet': { type: 'boolean', default: false },
  },
  strict: true,
});

const repoRoot = resolve(args['repo-root']);

// ── Load config: explicit --config path (single file) OR auto-discover (multi-file) ──
let parsed = null;
let sourceLabel;
let primaryWritePath;       // where --update-catalog writes _catalog.md (next to this)
let fileForKey = null;
const preflightReport = new Report();

if (args.config) {
  // Single-file mode
  sourceLabel = args.config;
  primaryWritePath = args.config;
  if (!existsSync(args.config)) {
    preflightReport.err(`config file not found: ${args.config}`);
  } else {
    try {
      parsed = yaml.load(readFileSync(args.config, 'utf8'));
    } catch (e) {
      preflightReport.err(`YAML parse error in ${args.config}: ${e.message}`);
    }
  }
} else {
  // Auto-discover + merge core + sibling YAMLs in contexts/config/
  const { coreFile, siblingFiles, configDir } = discoverConfigFiles(repoRoot);
  if (!coreFile && siblingFiles.length === 0) {
    preflightReport.err(`no pipeline*.yaml files found in ${configDir}`);
    sourceLabel = '<none>';
    primaryWritePath = join(configDir, 'pipeline.yaml');
  } else {
    const loaded = loadAndMerge(coreFile, siblingFiles, configDir);
    parsed = loaded.merged;
    fileForKey = loaded.fileForKey;
    primaryWritePath = coreFile ? join(configDir, coreFile) : join(configDir, siblingFiles[0]);
    sourceLabel = loaded.files.length === 1
      ? join(configDir, loaded.files[0])
      : `merged: ${loaded.files.join(' + ')}`;

    for (const pe of loaded.parseErrors) preflightReport.err(`YAML parse error in ${pe.file}: ${pe.message}`);
    // Cross-file key collisions (each top-level key must live in exactly one file)
    for (const c of loaded.collisions) {
      preflightReport.err(`top-level key '${c.key}' declared in multiple files: ${c.files.join(' AND ')}`);
    }
  }
}

const [validateReport, validatedParsed] = (parsed != null)
  ? validate(parsed, repoRoot, sourceLabel, fileForKey)
  : [new Report(), null];

// Merge preflight + validate results
for (const e of preflightReport.errors) validateReport.err(e);
for (const w of preflightReport.warnings) validateReport.warn(w);

if (!args.quiet || !validateReport.ok || validateReport.warnings.length > 0) {
  console.log(`${BOLD}validate-pipeline-config${RESET} ${DIM}(${sourceLabel})${RESET}`);
  validateReport.print();
}

if (!validateReport.ok || validatedParsed == null) process.exit(1);

if (args['emit-catalog']) {
  process.stdout.write(emitCatalog(validatedParsed));
  process.exit(0);
}

if (args['update-catalog']) {
  const catalog = emitCatalog(validatedParsed);
  const [catalogPath, changed] = updateCatalogFile(primaryWritePath, catalog);
  if (changed) console.log(`${GREEN}✓ catalog written to ${catalogPath}${RESET}`);
  else console.log(`${DIM}catalog already in sync — no changes${RESET}`);
  process.exit(0);
}

process.exit(0);

} // end: if (__invokedAsScript)
