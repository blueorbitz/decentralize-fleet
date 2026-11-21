// Backend entry for the Forge app: the panel resolver, the scheduled reaper and
// the MCP webtrigger all resolve their dependencies here.
//
// Fleet semantics live in src/ and are transport-injected; this file only knows
// how the Forge runtime supplies those dependencies. Named imports are used
// throughout because @forge/* packages are CJS with __esModule interop, where a
// default import is the whole exports object rather than the class.
import { makeResolver } from '@forge/resolver';
import { asApp, route } from '@forge/api';
import { JiraClient } from '../jira.js';
import { loadConfig } from '../config.js';
import { forgeTransport } from '../transports.js';
import { createFleetResolver } from '../resolver.js';
import { createMcpTrigger } from '../mcp-trigger.js';
import { reap } from '../reaper.js';
import { createMcpServer } from '../mcp.js';

// Built per invocation so the current environment variables are read rather than
// whatever was present when the module was first evaluated.
function jiraClient() {
  const cfg = loadConfig(process.env);
  const jira = new JiraClient({
    transport: forgeTransport({ asApp, route }),
    project: cfg.jira.project,
    fields: cfg.jira.fields,
  });
  return { cfg, jira };
}

export const handler = async (payload, runtimePayload) => {
  const { cfg, jira } = jiraClient();
  const definitions = makeResolver(createFleetResolver({ jira, cfg }));
  return definitions(payload, runtimePayload);
};

// --- scheduled reaper ----------------------------------------------------

export async function reaperHandler() {
  const { cfg, jira } = jiraClient();
  const summary = await reap({
    jira,
    fields: cfg.jira.fields,
    staleMs: cfg.timings.leaseStaleMs,
    logger: console,
  });
  console.log(`reaper: scanned ${summary.scanned} In Build, requeued ${summary.requeued}`);
  return summary;
}

// --- MCP webtrigger ------------------------------------------------------

export const mcpHandler = createMcpTrigger({
  makeServer() {
    const { cfg, jira } = jiraClient();
    return createMcpServer({ jira, cfg, logger: console });
  },
  logger: console,
});
