#!/usr/bin/env node
// Stdio entry for the fleet MCP server (newline-delimited JSON-RPC).
import readline from 'node:readline';
import { loadConfig } from '../src/config.js';
import { JiraClient } from '../src/jira.js';
import { createMcpServer } from '../src/mcp.js';

const cfg = loadConfig(['mcp', ...process.argv.slice(2)], process.env);
const jira = new JiraClient({
  baseUrl: cfg.jira.baseUrl,
  email: cfg.jira.email,
  token: cfg.jira.token,
  project: cfg.jira.project,
  fields: cfg.jira.fields,
});
const server = createMcpServer({ jira, cfg, logger: console });

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
    return;
  }
  Promise.resolve(server.handle(msg))
    .then((response) => {
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    })
    .catch((err) => {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: err.message } })}\n`);
    });
});
