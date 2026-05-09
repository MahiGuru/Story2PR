#!/usr/bin/env node
/**
 * audit-file-reads.mjs — tally pipeline observability markers across tickets.
 *
 * Scans contexts/**<TICKET>-manifest.md, -review.md, -exploration.md for:
 *   1. `Full-read: <path> (<N>L) — reason: <why>`  (file-read budget audit)
 *   2. `Build SKIPPED: …`                           (build gate audit)
 *
 * Reports how tight the budget is actually holding and where it's being blown.
 *
 * Usage:
 *   node contexts/tools/audit-file-reads.mjs
 *   node contexts/tools/audit-file-reads.mjs --project-root /path/to/project
 *   node contexts/tools/audit-file-reads.mjs --metric reads    # reads only
 *   node contexts/tools/audit-file-reads.mjs --metric skips    # skips only
 *   node contexts/tools/audit-file-reads.mjs --outliers 3      # tickets with >3 reads
 *   node contexts/tools/audit-file-reads.mjs --json            # machine-readable
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';
import { parseArgs } from 'util';

const { values: args } = parseArgs({
  options: {
    'project-root': { type: 'string' },
    'metric':       { type: 'string', default: 'all' },   // all | reads | skips
    'outliers':     { type: 'string', default: '5' },
    'json':         { type: 'boolean', default: false },
    'help':         { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
audit-file-reads.mjs — tally pipeline file-read and build-skip markers.

Usage: node contexts/tools/audit-file-reads.mjs [OPTIONS]

Options:
  --project-root <path>   project root (default: cwd)
  --metric all|reads|skips   which markers to audit (default: all)
  --outliers <N>          threshold for outlier tickets (default: 5)
  --json                  JSON output (default: human-readable)
  -h, --help              this help

What it scans:
  contexts/**/*-manifest.md       — Surgeon's Change Manifest
  contexts/**/*-review.md         — Review's report
  contexts/**/*-exploration.md    — Explorer's exploration file

What it reports:
  - Total full-reads across all tickets (by agent)
  - Top 10 largest full-reads
  - Outlier tickets exceeding the threshold
  - Total build skips (by agent + by id)
`);
  process.exit(0);
}

const ROOT = resolve(args['project-root'] || process.cwd());
const CONTEXTS = join(ROOT, 'contexts');
const OUTLIER_THRESHOLD = parseInt(args.outliers, 10);

if (!existsSync(CONTEXTS)) {
  console.error(`ERROR: ${CONTEXTS} does not exist. Run from a project root with contexts/, or pass --project-root.`);
  process.exit(2);
}

// ── Walk contexts/ for per-ticket files ──────────────────────────────────
// Ticket artifact naming: <TICKET>-manifest.md / -review.md / -exploration.md
// Layout can be flat (contexts/<TICKET>-*.md) or nested (contexts/<epic>/<TICKET>-*.md).
// We accept either; the ticket ID is the filename stem up to the last `-<suffix>`.

const TICKET_ARTIFACT_RE = /^([A-Z][A-Z0-9]*-\d+)-(manifest|review|exploration)\.md$/;

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      // Skip archive/ and design/ subfolders — not ticket artifacts.
      if (name === 'archive' || name === 'tools' || name === 'config' || name.endsWith('-design')) continue;
      walk(p, acc);
    } else if (st.isFile() && name.endsWith('.md')) {
      const m = name.match(TICKET_ARTIFACT_RE);
      if (m) acc.push({ path: p, ticket: m[1], kind: m[2] });
    }
  }
  return acc;
}

const artifacts = walk(CONTEXTS);

if (artifacts.length === 0) {
  console.error(`No ticket artifacts found under ${CONTEXTS} (looking for <TICKET>-{manifest,review,exploration}.md).`);
  console.error(`If the pipeline hasn't run any tickets yet, that's expected.`);
  process.exit(0);
}

// ── Parse markers ────────────────────────────────────────────────────────

const FULL_READ_RE = /^Full-read:\s*(.+?)\s*\((\d+)L\)\s*—\s*reason:\s*(.+)$/;
const SKIP_TASK_RE = /^Build SKIPPED:\s*task=(T[\w-]+)\s*cmd="([^"]*)"\s*reason="([^"]*)"/;
const SKIP_ID_RE   = /^Build SKIPPED:\s*id=(\S+)\s*reason="([^"]*)"/;

// kind → which agent wrote the file
const KIND_TO_AGENT = { manifest: 'surgeon', review: 'review', exploration: 'explorer' };

const fullReads = [];   // { ticket, agent, path, lines, reason, sourceFile }
const buildSkips = [];  // { ticket, agent, target, reason, sourceFile }

for (const { path, ticket, kind } of artifacts) {
  const agent = KIND_TO_AGENT[kind];
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { continue; }

  for (const line of text.split('\n')) {
    const fr = line.match(FULL_READ_RE);
    if (fr && (args.metric === 'all' || args.metric === 'reads')) {
      fullReads.push({
        ticket,
        agent,
        path: fr[1],
        lines: parseInt(fr[2], 10),
        reason: fr[3],
        sourceFile: path,
      });
      continue;
    }

    if (args.metric === 'all' || args.metric === 'skips') {
      const st = line.match(SKIP_TASK_RE);
      if (st) {
        buildSkips.push({ ticket, agent, target: st[1], cmd: st[2], reason: st[3], sourceFile: path });
        continue;
      }
      const si = line.match(SKIP_ID_RE);
      if (si) {
        buildSkips.push({ ticket, agent, target: si[1], reason: si[2], sourceFile: path });
      }
    }
  }
}

// ── Aggregate ────────────────────────────────────────────────────────────

function groupBy(arr, key) {
  const out = {};
  for (const x of arr) {
    const k = x[key];
    (out[k] = out[k] || []).push(x);
  }
  return out;
}

const readsByAgent = groupBy(fullReads, 'agent');
const readsByTicket = groupBy(fullReads, 'ticket');
const skipsByAgent = groupBy(buildSkips, 'agent');

const uniqueTickets = new Set(artifacts.map(a => a.ticket));
const summary = {
  scanned: {
    tickets: uniqueTickets.size,
    files: artifacts.length,
    project_root: ROOT,
  },
  full_reads: {
    total: fullReads.length,
    by_agent: {},
    avg_lines: fullReads.length ? Math.round(fullReads.reduce((s, r) => s + r.lines, 0) / fullReads.length) : 0,
    top_10: fullReads.slice().sort((a, b) => b.lines - a.lines).slice(0, 10),
    outlier_tickets: Object.entries(readsByTicket)
      .filter(([, rs]) => rs.length > OUTLIER_THRESHOLD)
      .map(([ticket, rs]) => ({
        ticket,
        count: rs.length,
        total_lines: rs.reduce((s, r) => s + r.lines, 0),
        reads: rs.map(r => ({ agent: r.agent, path: r.path, lines: r.lines, reason: r.reason })),
      }))
      .sort((a, b) => b.count - a.count),
  },
  build_skips: {
    total: buildSkips.length,
    by_agent: {},
    entries: buildSkips,
  },
};

for (const agent of Object.keys(readsByAgent)) {
  const rs = readsByAgent[agent];
  summary.full_reads.by_agent[agent] = {
    count: rs.length,
    avg_lines: Math.round(rs.reduce((s, r) => s + r.lines, 0) / rs.length),
    max_lines: Math.max(...rs.map(r => r.lines)),
  };
}
for (const agent of Object.keys(skipsByAgent)) {
  summary.build_skips.by_agent[agent] = skipsByAgent[agent].length;
}

// ── Render ───────────────────────────────────────────────────────────────

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

// Human-readable
const isTTY = process.stdout.isTTY;
const c = (code) => isTTY ? code : '';
const BOLD = c('\x1b[1m'), DIM = c('\x1b[2m'), RED = c('\x1b[31m'),
      GREEN = c('\x1b[32m'), YELLOW = c('\x1b[33m'), RESET = c('\x1b[0m');

console.log(`${BOLD}Pipeline observability audit${RESET}  (${ROOT})`);
console.log(`${DIM}Scanned: ${summary.scanned.tickets} ticket(s), ${summary.scanned.files} artifact file(s)${RESET}`);
console.log();

if (args.metric === 'all' || args.metric === 'reads') {
  console.log(`${BOLD}📖 Full-read audit (file-read budget breaches)${RESET}`);
  if (summary.full_reads.total === 0) {
    console.log(`   ${GREEN}✓ No full-read entries found.${RESET} Either agents are staying within the 200-line budget, or no tickets have run yet.`);
  } else {
    console.log(`   Total full-reads: ${BOLD}${summary.full_reads.total}${RESET} (avg ${summary.full_reads.avg_lines} lines per read)`);
    console.log(`   By agent:`);
    for (const [agent, info] of Object.entries(summary.full_reads.by_agent)) {
      console.log(`     - ${agent.padEnd(10)} ${String(info.count).padStart(4)} read(s)  avg ${info.avg_lines}L  max ${info.max_lines}L`);
    }

    console.log();
    console.log(`   ${BOLD}Top 10 largest full-reads:${RESET}`);
    for (const r of summary.full_reads.top_10) {
      console.log(`     ${YELLOW}${String(r.lines).padStart(5)}L${RESET}  [${r.ticket}] ${r.agent.padEnd(8)} ${r.path}`);
      console.log(`            reason: ${DIM}${r.reason}${RESET}`);
    }

    console.log();
    if (summary.full_reads.outlier_tickets.length > 0) {
      console.log(`   ${BOLD}${RED}⚠ Outlier tickets${RESET} (>${OUTLIER_THRESHOLD} full-reads — budget is loose here):`);
      for (const t of summary.full_reads.outlier_tickets) {
        console.log(`     [${t.ticket}]  ${t.count} full-read(s), ${t.total_lines} lines total`);
      }
    } else {
      console.log(`   ${GREEN}✓ No tickets exceed the outlier threshold (>${OUTLIER_THRESHOLD} full-reads).${RESET}`);
    }
  }
  console.log();
}

if (args.metric === 'all' || args.metric === 'skips') {
  console.log(`${BOLD}⏭  Build-skip audit (per-task + review_gate skips)${RESET}`);
  if (summary.build_skips.total === 0) {
    console.log(`   ${GREEN}✓ No build skips found.${RESET} Every build in every task ran through the normal path.`);
  } else {
    console.log(`   Total skips: ${BOLD}${summary.build_skips.total}${RESET}`);
    console.log(`   By agent:`);
    for (const [agent, count] of Object.entries(summary.build_skips.by_agent)) {
      console.log(`     - ${agent.padEnd(10)} ${String(count).padStart(4)} skip(s)`);
    }

    console.log();
    console.log(`   ${BOLD}All skip entries:${RESET}`);
    for (const s of summary.build_skips.entries) {
      console.log(`     ${YELLOW}[${s.ticket}]${RESET}  ${s.agent} · ${s.target}`);
      if (s.cmd) console.log(`            cmd:    ${DIM}${s.cmd}${RESET}`);
      console.log(`            reason: ${DIM}${s.reason || '(none given)'}${RESET}`);
    }
  }
  console.log();
}

// Guidance footer
console.log(`${DIM}To tighten the budget:${RESET}`);
console.log(`${DIM}  - If full-reads are common, check the "reason:" strings — are they legitimate (e.g., small file) or is grep-first discipline slipping?${RESET}`);
console.log(`${DIM}  - If build-skips are common for the same id, consider editing that id's cmd in contexts/config/pipeline.*.builds.yaml.${RESET}`);
console.log(`${DIM}  - --json for machine-readable output (useful in CI).${RESET}`);
