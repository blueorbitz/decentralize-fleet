// Backend entry for the Forge app: the panel resolver, the scheduled reaper and
// the MCP webtrigger all resolve their dependencies here.
//
// The panel, reaper and MCP server are transport- and store-injected; this file
// only knows how the Forge runtime supplies them. Named imports are used
// throughout because @forge/* packages are CJS with __esModule interop, where a
// default import is the whole exports object rather than the class.
import { makeResolver } from '@forge/resolver';
import { asApp, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { forgeTransport } from '../transports.js';
import { createFleetResolver } from '../resolver.js';
import { createMcpTrigger } from '../mcp-trigger.js';
import { reap } from '../reaper.js';
import { createMcpServer } from '../mcp.js';
import { createSettingsService } from '../settings/service.js';
import { forgeStore } from '../settings/store.js';
import { forgePresenceStore } from '../presence/store.js';
import { createPresenceService } from '../presence/service.js';
import { createHeartbeatTrigger } from '../presence/trigger.js';
import { createPageResolver } from '../presence/resolver.js';
import { makeJiraClient } from '../client.js';

const transport = () => forgeTransport({ asApp, route });
const store = () => forgeStore(kvs);
const presence = () => createPresenceService({ store: forgePresenceStore(kvs) });

// The issue panel is per-project, and the page's context names the project it
// was opened in. Falls back to the sole configured project when a context is
// missing (an automation call), and to the env config when nothing is set.
async function jiraFor(context) {
  const projectId = context?.extension?.project?.id || null;
  const { cfg, jira } = await makeJiraClient({ store: store(), transport: transport(), projectId });
  return { cfg, jira, projectId };
}

export const handler = async (payload, runtimePayload) => {
  const { cfg, jira } = await jiraFor(payload?.context);
  const definitions = makeResolver(createFleetResolver({ jira, cfg }));
  return definitions(payload, runtimePayload);
};

// --- Fleet project page ---------------------------------------------------

export const pageHandler = async (payload, runtimePayload) => {
  const definitions = makeResolver(createPageResolver({ presence: presence() }));
  return definitions(payload, runtimePayload);
};

// --- worker presence heartbeat -------------------------------------------

export const heartbeatHandler = createHeartbeatTrigger({
  settingsStore: store(),
  presence: presence(),
  env: process.env,
  logger: console,
});

// --- scheduled reaper ----------------------------------------------------

// One pass per configured project, summed. Zero configured is a no-op rather
// than an error: an installation may not have opened the settings page yet.
export async function reaperHandler() {
  const service = createSettingsService({ store: store(), env: process.env, now: () => new Date() });
  const projects = await service.listProjects();

  if (projects.length === 0) {
    console.log('reaper: no projects are configured — open Project settings → Fleet settings');
    return { projects: 0, scanned: 0, requeued: 0, keys: [], at: new Date().toISOString() };
  }

  const totals = { projects: projects.length, scanned: 0, requeued: 0, keys: [], prunedPresence: 0, at: null };
  const presenceService = presence();
  for (const record of projects) {
    const { cfg, jira } = await jiraFor({ extension: { project: { id: record.projectId } } });
    const summary = await reap({
      jira,
      fields: cfg.jira.fields,
      staleMs: cfg.timings.leaseStaleMs,
      logger: console,
    });
    console.log(
      `reaper: ${record.projectKey} scanned ${summary.scanned} In Build, requeued ${summary.requeued}`,
    );
    totals.scanned += summary.scanned;
    totals.requeued += summary.requeued;
    totals.keys.push(...summary.keys);
    totals.at = summary.at;

    // Presence records are disposable; keep a day of recently-seen history.
    // Pruning is auxiliary: it must never break lease repair.
    try {
      const pruned = await presenceService.prune(record.projectId, 24 * 60 * 60_000);
      totals.prunedPresence += pruned.removed;
    } catch (err) {
      console.log(`reaper: presence prune failed for ${record.projectKey}: ${err.message}`);
    }
  }
  return totals;
}

// --- MCP webtrigger ------------------------------------------------------

// The bearer token is resolved to a project by the trigger itself (one
// webtrigger per installation, many project tokens), so `makeServer` is given
// the matching project and builds a client bound to it.
export const mcpHandler = createMcpTrigger({
  store: store(),
  // An installation-wide FLEET_MCP_TOKEN is still honoured until the settings
  // page is used; the trigger reads it per request and binds it to no project.
  env: process.env,
  async makeServer({ projectId }) {
    const { cfg, jira } = await jiraFor({ extension: { project: { id: projectId } } });
    return createMcpServer({ jira, cfg, logger: console });
  },
  logger: console,
});
