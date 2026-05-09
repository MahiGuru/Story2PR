#!/usr/bin/env node
/**
 * mcp-sample-generator.mjs — generate a reference mcp.sample.json from pipeline.yaml.
 *
 * This writes a committed reference file showing what MCP servers the project
 * expects. Developers copy entries from this sample into their personal Cursor
 * or Claude Code MCP config, replacing placeholder tokens with their own
 * credentials.
 *
 * Target paths for each host:
 *   Cursor:      ~/.cursor/mcp.json       OR <repo>/.cursor/mcp.json (per-project)
 *   Claude Code: ~/.claude.json (user)    OR <repo>/.mcp.json (project, team-committed)
 *
 * The pipeline does NOT write to any of those directly — they're owned by each
 * developer. This file is the bridge between "what the project declares" and
 * "what each developer configures personally."
 *
 * Usage:
 *   node tools/mcp-sample-generator.mjs --project-root PATH
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import yaml from './vendor/js-yaml.mjs';

const { values: args } = parseArgs({
  options: {
    'project-root': { type: 'string' },
    'pipeline-yaml': { type: 'string' },
  },
  strict: true,
});

const projectRoot = args['project-root'] || process.cwd();
const pipelineYaml = args['pipeline-yaml'] || join(projectRoot, 'contexts', 'config', 'pipeline.yaml');

if (!existsSync(pipelineYaml)) {
  console.log(`  i pipeline.yaml not found at ${pipelineYaml} — skipping MCP sample generation`);
  process.exit(0);
}

const parsed = yaml.load(readFileSync(pipelineYaml, 'utf8'));
const mcpServers = parsed?.mcp_servers || {};

if (Object.keys(mcpServers).length === 0) {
  console.log('  i No mcp_servers declared in pipeline.yaml — skipping MCP sample generation');
  process.exit(0);
}

// Build the mcpServers object for the sample file.
// Skipped servers (mcp_servers.<name>.skip == true) are omitted from sample.json
// so developers don't accidentally re-enable them by copy-pasting the sample —
// they're documented under "Skipped servers" in mcp.sample.README.md instead.
const sample = {};
const skippedServers = [];

for (const [name, server] of Object.entries(mcpServers)) {
  if (server.skip === true) {
    skippedServers.push(name);
    continue;
  }
  const auth = server.auth || 'token';
  const config = server.config || {};
  const entry = {};

  if (auth === 'oauth') {
    if (!config.url) {
      console.error(`  ⚠ ${name}: auth=oauth but no config.url — skipping`);
      continue;
    }
    entry.url = config.url;
  } else {
    // token or token_or_oauth: stdio or remote-with-env
    if (config.command) {
      entry.command = config.command;
      entry.args = config.args || [];
      if (config.env && Object.keys(config.env).length > 0) {
        // Replace ${VAR} refs with REPLACE_WITH_YOUR_<VAR> placeholders
        entry.env = {};
        for (const [varName, varValue] of Object.entries(config.env)) {
          entry.env[varName] = `REPLACE_WITH_YOUR_${varName}`;
        }
      }
    } else if (config.url) {
      entry.url = config.url;
      if (config.env && Object.keys(config.env).length > 0) {
        entry.headers = {};
        for (const varName of Object.keys(config.env)) {
          entry.headers[varName] = `REPLACE_WITH_YOUR_${varName}`;
        }
      }
    } else {
      console.error(`  ⚠ ${name}: no command and no url in config — skipping`);
      continue;
    }
  }

  sample[name] = entry;
}

// Wrap in the standard mcpServers envelope
const output = { mcpServers: sample };
const samplePath = join(projectRoot, 'contexts', 'config', 'mcp.sample.json');

// Build a header comment (JSON doesn't support comments, so we embed a README-like note
// as a sibling markdown file)
const readmePath = join(projectRoot, 'contexts', 'config', 'mcp.sample.README.md');

writeFileSync(samplePath, JSON.stringify(output, null, 2) + '\n');

// Generate setup instructions with auth-type awareness
const readmeLines = [
  '# MCP setup — copy this into your Cursor / Claude Code config',
  '',
  'This project uses MCP servers declared in `pipeline.yaml`. The adjacent file',
  '`mcp.sample.json` shows what to configure. Your personal MCP config is NOT',
  'managed by this repo — add these entries to your own Cursor or Claude Code',
  'setup.',
  '',
  '## Where to put the entries',
  '',
  '**Cursor**',
  '',
  '| Scope | File | Notes |',
  '|---|---|---|',
  '| Global (all projects) | `~/.cursor/mcp.json` | Your personal default |',
  '| Per-project | `<repo>/.cursor/mcp.json` | Typically gitignored; private tokens |',
  '',
  '**Claude Code**',
  '',
  '| Scope | File | Notes |',
  '|---|---|---|',
  '| User (all projects) | `~/.claude.json` | Under your project path → `mcpServers` |',
  '| Project (team-shared) | `<repo>/.mcp.json` | Committed to git, shared by team. **Must be at repo root, NOT inside `.claude/`.** |',
  '| Local override | `~/.claude.json` | Your personal creds for shared servers |',
  '',
  'The paths above are the exact locations each tool reads. Open `mcp.sample.json`',
  'and copy the entries under `mcpServers` into your actual MCP config file,',
  'merging with any servers you already have.',
  '',
  '## Servers this project expects',
  '',
];

for (const [name, server] of Object.entries(mcpServers)) {
  if (server.skip === true) continue;   // active servers only here; skipped listed below
  const auth = server.auth || 'token';
  const required = server.required ? '**required**' : 'optional';
  const usedBy = server.used_by ? ` Used by: ${server.used_by.join(', ')}.` : '';
  const hint = server.setup_hint ? server.setup_hint.trim() : '';

  readmeLines.push(`### \`${name}\` — ${required}, auth: ${auth}`);
  readmeLines.push('');
  if (usedBy) readmeLines.push(usedBy);

  if (auth === 'oauth') {
    readmeLines.push(`No token needed. On first use, your browser opens for login.`);
  } else {
    const envVars = Object.keys(server.config?.env || {});
    if (envVars.length > 0) {
      readmeLines.push(`Replace the placeholder token(s) with your own:`);
      readmeLines.push('');
      for (const v of envVars) {
        readmeLines.push(`- \`${v}\`: replace \`REPLACE_WITH_YOUR_${v}\` with your actual token`);
      }
    }
  }

  if (hint) {
    readmeLines.push('');
    readmeLines.push('**Setup:**');
    readmeLines.push('');
    for (const hintLine of hint.split('\n')) {
      readmeLines.push(hintLine);
    }
  }

  readmeLines.push('');
}

if (skippedServers.length > 0) {
  readmeLines.push('## Skipped servers (declarative opt-out)');
  readmeLines.push('');
  readmeLines.push('These servers are present in `pipeline.yaml` but have `skip: true` set, so they are');
  readmeLines.push('omitted from `mcp.sample.json` and Orchestrator treats them as `--skip <name>` on every');
  readmeLines.push('run. Orchestrator will prompt for the alternate input (image upload, ticket-input.md,');
  readmeLines.push('inline `Context:`, etc.) before downstream phases run — the per-server prompt text comes');
  readmeLines.push('from `mcp_servers.<name>.fallback_prompt` in `pipeline.yaml`.');
  readmeLines.push('');
  readmeLines.push('To re-enable any of these, flip `skip: true` → `skip: false` in `pipeline.yaml`,');
  readmeLines.push('then re-run `node contexts/tools/mcp-sample-generator.mjs --project-root .`.');
  readmeLines.push('');
  for (const name of skippedServers) {
    const server = mcpServers[name];
    const auth = server.auth || 'token';
    const required = server.required ? '**required**' : 'optional';
    const usedBy = server.used_by ? ` Used by: ${server.used_by.join(', ')}.` : '';
    readmeLines.push(`- \`${name}\` — ${required}, auth: ${auth}.${usedBy}`);
  }
  readmeLines.push('');
}

readmeLines.push('## After editing your personal MCP config');
readmeLines.push('');
readmeLines.push('Restart Cursor (or reload Claude Code) so it picks up the new MCP servers.');
readmeLines.push('');
readmeLines.push('## Security note');
readmeLines.push('');
readmeLines.push('Your personal MCP config contains real tokens — do NOT commit it to any repo.');
readmeLines.push('');
readmeLines.push('- Cursor\'s per-project `<repo>/.cursor/mcp.json` is typically gitignored automatically.');
readmeLines.push('- Global configs (`~/.cursor/mcp.json`, `~/.claude.json`) live outside any repo.');
readmeLines.push('- Claude Code\'s committed `<repo>/.mcp.json` should contain ONLY public server configs');
readmeLines.push('  (no tokens); each developer adds their tokens locally via `~/.claude.json`.');
readmeLines.push('');

writeFileSync(readmePath, readmeLines.join('\n'));

const activeNames = Object.keys(sample).join(', ') || '(none)';
console.log(`  ✓ Wrote contexts/config/mcp.sample.json (${Object.keys(sample).length} active server(s): ${activeNames})`);
if (skippedServers.length > 0) {
  console.log(`  i ${skippedServers.length} server(s) omitted via skip:true — ${skippedServers.join(', ')}`);
}
console.log(`  ✓ Wrote contexts/config/mcp.sample.README.md (setup instructions)`);
