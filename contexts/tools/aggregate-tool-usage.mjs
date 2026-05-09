#!/usr/bin/env node
/**
 * aggregate-tool-usage.mjs
 *
 * Reads all *-tool-usage.md ledgers under contexts/, aggregates per-agent and
 * per-pipeline counts, and prints a cross-story summary.
 *
 * Usage:
 *   node contexts/tools/aggregate-tool-usage.mjs                  # all stories
 *   node contexts/tools/aggregate-tool-usage.mjs --epic <epic>    # single epic
 *   node contexts/tools/aggregate-tool-usage.mjs --last 5         # most recent N
 *   node contexts/tools/aggregate-tool-usage.mjs --json           # JSON output
 *   node contexts/tools/aggregate-tool-usage.mjs --story PROJ-1234   # one story
 *
 * Source-of-truth schema: agent-pipeline/rules/agent-flow.mdc § Tool Usage Tracking.
 *
 * IMPORTANT — non-billing-grade. Numbers reported here are agent-side estimates
 * (counts perfect, token estimates approximate within ~30%). For exact billing
 * figures, cross-reference with Anthropic Console / Cursor billing dashboard.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';

// ── argv parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
  epic: null,
  last: null,
  json: false,
  story: null,
  help: false,
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h') flags.help = true;
  else if (a === '--json') flags.json = true;
  else if (a === '--epic') flags.epic = args[++i];
  else if (a === '--last') flags.last = parseInt(args[++i], 10);
  else if (a === '--story') flags.story = args[++i];
  else { console.error(`unknown flag: ${a}`); flags.help = true; }
}

if (flags.help) {
  console.log(`Usage: aggregate-tool-usage.mjs [options]
  --epic <id>    only stories under contexts/<epic>/
  --story <id>   only that ticket / bundle id
  --last <N>     only most recent N stories (by file mtime)
  --json         emit JSON instead of text tables
  --help         this help`);
  process.exit(0);
}

// ── discover ledger files ────────────────────────────────────────────────
const CONTEXTS_DIR = 'contexts';
if (!existsSync(CONTEXTS_DIR)) {
  console.error(`No ${CONTEXTS_DIR}/ directory found at ${process.cwd()} — run from repo root.`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'archive' || entry.name === 'tools') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && entry.name.endsWith('-tool-usage.md')) out.push(p);
  }
  return out;
}

let files = walk(CONTEXTS_DIR);

// Filter by epic
if (flags.epic) {
  const e = flags.epic.toLowerCase();
  files = files.filter(f => f.toLowerCase().includes(`/${e}/`));
}

// Filter by story / bundle id
if (flags.story) {
  const id = flags.story;
  files = files.filter(f => basename(f).startsWith(`${id}-tool-usage`));
}

// Sort by mtime; --last picks N most recent
files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
if (flags.last && flags.last > 0) files = files.slice(0, flags.last);

if (files.length === 0) {
  console.log('No tool-usage ledgers found.');
  process.exit(0);
}

// ── parse one ledger ─────────────────────────────────────────────────────
function parseLedger(path) {
  const text = readFileSync(path, 'utf8');

  // Frontmatter
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const m = line.match(/^([a-z_]+):\s*(.+)$/);
      if (m) fm[m[1]] = m[2].trim();
    }
  }

  // Per-agent blocks: split on `^## ` (level-2) but not `^### `
  const blocks = [];
  const lines = text.split('\n');
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^## ([^#].*)$/);
    if (m && !line.startsWith('# Tool Usage Ledger')) {
      // Skip the top-level title
      if (cur) blocks.push(cur);
      cur = { heading: m[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) blocks.push(cur);

  // Skip header block "# Tool Usage Ledger"
  return {
    path,
    ticket: fm.ticket || fm.bundle_id || basename(path).replace('-tool-usage.md', ''),
    mode: fm.mode || 'unknown',
    created_at: fm.created_at || '',
    agents: blocks
      .filter(b => !/^Tool Usage Ledger/i.test(b.heading))
      .map(b => parseAgentBlock(b)),
  };
}

function parseAgentBlock(block) {
  const out = {
    name: block.heading.replace(/\s*\([^)]*\)\s*$/, '').trim(),
    marker: (block.heading.match(/\(([^)]+)\)/) || [])[1] || '',
    duration_s: 0,
    verdict: '',
    mcp_calls: 0,
    mcp_tokens: 0,
    git_ops: 0,
    bash_ops: 0,
    file_reads: 0,
    file_read_bytes: 0,
    file_writes: 0,
    file_write_bytes: 0,
    builds: 0,
    build_wallclock_s: 0,
    cost_usd: 0,
    raw: block.body.join('\n'),
  };

  for (const line of block.body) {
    const dur = line.match(/Duration:\s*(\d+)\s*s/i);          if (dur) out.duration_s = parseInt(dur[1], 10);
    const ver = line.match(/Verdict:\s*([A-Z]+)/);             if (ver) out.verdict = ver[1];
    const sub = line.match(/Subtotal:\s*\*\*\s*~?\$\s*([\d.]+)/); if (sub) out.cost_usd = parseFloat(sub[1]);
  }

  // Tables — count rows under each section heading
  const sections = {};
  let cursor = null;
  for (const line of block.body) {
    const h3 = line.match(/^### (.+)$/);
    if (h3) { cursor = h3[1].trim().toLowerCase(); sections[cursor] = []; continue; }
    if (cursor && line.startsWith('|') && !line.match(/^\|[\s\-:]*\|/) && !line.match(/^\|.*Count.*\|/i) && !line.match(/^\|.*---.*\|/)) {
      sections[cursor].push(line);
    }
  }

  // Sum counts from each table — column 'Count' is column index 2 (after first pipe + label).
  // Heuristic: extract first numeric column after the label.
  function sumCountColumn(rows) {
    let total = 0, tokens = 0;
    for (const r of rows) {
      const cells = r.split('|').map(s => s.trim());
      // cells[0] = '' (before first pipe). cells[1] = label. cells[2]/[3] = numerics.
      for (let i = 2; i < cells.length; i++) {
        const num = cells[i].match(/^([\d.]+)\s*[KMGB]?\s*$/);
        if (num) { total += parseFloat(num[1]); break; }
      }
      // Look for a token-shaped column (with K / M suffix)
      for (let i = 2; i < cells.length; i++) {
        const t = cells[i].match(/^([\d.]+)\s*K\s*$/);
        if (t) tokens += parseFloat(t[1]) * 1000;
        const tm = cells[i].match(/^([\d.]+)\s*M\s*$/);
        if (tm) tokens += parseFloat(tm[1]) * 1_000_000;
      }
    }
    return { count: total, tokens };
  }

  function sumByteColumn(rows) {
    let bytes = 0;
    for (const r of rows) {
      const cells = r.split('|').map(s => s.trim());
      for (let i = 2; i < cells.length; i++) {
        const k = cells[i].match(/^([\d.]+)\s*K\s*$/);
        if (k) { bytes += parseFloat(k[1]) * 1000; break; }
        const m = cells[i].match(/^([\d.]+)\s*M\s*$/);
        if (m) { bytes += parseFloat(m[1]) * 1_000_000; break; }
        const b = cells[i].match(/^(\d+)\s*$/);
        if (b) { bytes += parseInt(b[1], 10); break; }
      }
    }
    return bytes;
  }

  function findSection(name) {
    for (const k of Object.keys(sections)) {
      if (k.toLowerCase().startsWith(name.toLowerCase())) return sections[k];
    }
    return [];
  }

  const mcp = sumCountColumn(findSection('mcp calls'));    out.mcp_calls = mcp.count;  out.mcp_tokens = mcp.tokens;
  const git = sumCountColumn(findSection('git operations'));  out.git_ops = git.count;
  const bash = sumCountColumn(findSection('bash invocations'));  out.bash_ops = bash.count;
  out.file_reads = findSection('file reads').length;     out.file_read_bytes = sumByteColumn(findSection('file reads'));
  out.file_writes = findSection('file writes').length;   out.file_write_bytes = sumByteColumn(findSection('file writes'));
  const bu = sumCountColumn(findSection('build invocations'));  out.builds = bu.count;
  // Wall-clock from build invocations table — last numeric column ~ duration in seconds.
  for (const r of findSection('build invocations')) {
    const dur = r.match(/(\d+)s/);
    if (dur) out.build_wallclock_s += parseInt(dur[1], 10);
  }

  return out;
}

const ledgers = files.map(parseLedger);

// ── render ───────────────────────────────────────────────────────────────
if (flags.json) {
  console.log(JSON.stringify(ledgers, null, 2));
  process.exit(0);
}

// Per-story summary
console.log('═══════════════════════════════════════════════════════════════════════');
console.log(`Tool-usage ledger summary — ${ledgers.length} story/bundle file(s)`);
console.log('═══════════════════════════════════════════════════════════════════════\n');

for (const L of ledgers) {
  console.log(`■ ${L.ticket}   (mode: ${L.mode}, agents: ${L.agents.length})`);
  console.log(`  ${L.path}`);

  let total_cost = 0, total_dur = 0, total_builds = 0, total_build_wall = 0;
  console.log('   ┌─────────────────────┬───────┬─────┬─────┬─────┬─────────┬─────────┬─────────┐');
  console.log('   │ agent               │ dur s │ MCP │ git │ bash│ reads K │ builds  │ cost  $ │');
  console.log('   ├─────────────────────┼───────┼─────┼─────┼─────┼─────────┼─────────┼─────────┤');
  for (const a of L.agents) {
    total_cost += a.cost_usd;
    total_dur += a.duration_s;
    total_builds += a.builds;
    total_build_wall += a.build_wallclock_s;
    const name = (a.name + (a.marker ? ` (${a.marker})` : '')).slice(0, 19).padEnd(19);
    const reads_k = a.file_read_bytes ? (a.file_read_bytes / 1000).toFixed(1) : '0';
    console.log(`   │ ${name} │ ${String(a.duration_s).padStart(5)} │ ${String(a.mcp_calls).padStart(3)} │ ${String(a.git_ops).padStart(3)} │ ${String(a.bash_ops).padStart(3)} │ ${reads_k.padStart(7)} │ ${String(a.builds).padStart(3)}/${String(a.build_wallclock_s).padStart(3)}s │ ${('$'+a.cost_usd.toFixed(2)).padStart(7)} │`);
  }
  console.log('   ├─────────────────────┼───────┼─────┼─────┼─────┼─────────┼─────────┼─────────┤');
  console.log(`   │ TOTAL               │ ${String(total_dur).padStart(5)} │     │     │     │         │ ${String(total_builds).padStart(3)}/${String(total_build_wall).padStart(3)}s │ ${('$'+total_cost.toFixed(2)).padStart(7)} │`);
  console.log('   └─────────────────────┴───────┴─────┴─────┴─────┴─────────┴─────────┴─────────┘');
  console.log('');
}

// Cross-story aggregate
if (ledgers.length >= 2) {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`Cross-story aggregate (${ledgers.length} stories)`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const byAgent = {};
  for (const L of ledgers) {
    for (const a of L.agents) {
      const k = a.name;
      if (!byAgent[k]) byAgent[k] = { runs: 0, dur: 0, mcp: 0, git: 0, bash: 0, reads: 0, read_bytes: 0, builds: 0, build_wall: 0, cost: 0 };
      byAgent[k].runs++;
      byAgent[k].dur += a.duration_s;
      byAgent[k].mcp += a.mcp_calls;
      byAgent[k].git += a.git_ops;
      byAgent[k].bash += a.bash_ops;
      byAgent[k].reads += a.file_reads;
      byAgent[k].read_bytes += a.file_read_bytes;
      byAgent[k].builds += a.builds;
      byAgent[k].build_wall += a.build_wallclock_s;
      byAgent[k].cost += a.cost_usd;
    }
  }

  console.log('Per-agent averages across all parsed runs:');
  console.log(' ┌─────────────────────┬──────┬──────┬──────┬──────┬──────┬──────────┬────────┐');
  console.log(' │ agent               │ runs │ dur s│ MCP  │ git  │ bash │ reads K  │ cost $ │');
  console.log(' ├─────────────────────┼──────┼──────┼──────┼──────┼──────┼──────────┼────────┤');
  for (const [name, s] of Object.entries(byAgent)) {
    const avg = (n) => (s.runs ? (n / s.runs).toFixed(1) : '0');
    const reads_avg_k = s.runs ? (s.read_bytes / s.runs / 1000).toFixed(1) : '0';
    console.log(` │ ${name.padEnd(19)} │ ${String(s.runs).padStart(4)} │ ${avg(s.dur).padStart(4)} │ ${avg(s.mcp).padStart(4)} │ ${avg(s.git).padStart(4)} │ ${avg(s.bash).padStart(4)} │ ${reads_avg_k.padStart(8)} │ ${('$'+(s.cost/s.runs).toFixed(2)).padStart(6)} │`);
  }
  console.log(' └─────────────────────┴──────┴──────┴──────┴──────┴──────┴──────────┴────────┘');

  // Suggested optimization targets
  console.log('\nOptimization hints:');
  for (const [name, s] of Object.entries(byAgent)) {
    if (!s.runs) continue;
    const avg_reads = s.read_bytes / s.runs;
    if (name.toLowerCase().includes('surgeon') && avg_reads > 50000) {
      console.log(`  • ${name} avg ${(avg_reads/1000).toFixed(0)}K of file reads/run — consider Pattern D (parallel per-task reads). See agent-pipeline/docs/cost-optimization.md.`);
    }
    const avg_bash = s.bash / s.runs;
    if (avg_bash > 30) {
      console.log(`  • ${name} avg ${avg_bash.toFixed(0)} bash invocations/run — likely candidate for parallel-grep batching (Pattern B).`);
    }
    const avg_git = s.git / s.runs;
    if (avg_git > 8) {
      console.log(`  • ${name} avg ${avg_git.toFixed(0)} git ops/run — check for sequential git status/diff/log clusters that should be parallel (Pattern C).`);
    }
    if (s.cost / s.runs > 4) {
      console.log(`  • ${name} avg cost $${(s.cost/s.runs).toFixed(2)}/run — strong Sonnet→Haiku candidate? Review § 3 in cost-optimization.md.`);
    }
  }
}

console.log('\n(Numbers are agent-side estimates, not billing-grade. Cross-reference with Anthropic Console / Cursor billing for exact figures.)');
