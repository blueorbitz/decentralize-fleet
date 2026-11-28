// Build the Jira client for a specific project, from the effective config.
//
// This used to be a synchronous read of `process.env` folded into each entry
// point. It is async now because a project's configuration comes from the KVS
// record first (src/settings/service.js), so the panel resolver, the reaper and
// the MCP webtrigger all await it.
//
// The transport is injected for the same reason the Jira client takes one:
// src/backend/index.js supplies the Forge transport, and a test supplies the
// Basic-auth transport, with no @forge/api import in this file.
import { JiraClient } from './jira.js';
import { envConfig } from './config.js';
import { createSettingsService } from './settings/service.js';
import { toEffectiveConfig } from './settings/schema.js';

/**
 * Resolve a project's effective configuration and a client bound to it.
 *
 * @param {object} options
 * @param {object} options.store      settings store (src/settings/store.js)
 * @param {object} options.transport  Jira transport (src/transports.js)
 * @param {object} [options.env]      environment; defaults to process.env
 * @param {string} [options.projectId] record to read; omit for the sole project
 * @returns {Promise<{ cfg: object, jira: JiraClient, record: object|null, service: object }>}
 */
export async function makeJiraClient({ store, transport, env = process.env, projectId } = {}) {
  if (!store) throw new Error('makeJiraClient needs a settings store');
  if (!transport) throw new Error('makeJiraClient needs a Jira transport');

  const service = createSettingsService({ store, env });

  const record = projectId
    ? (await service.getProject(projectId)).record
    : await service.resolveSoleProject();

  // No record at all: keep today's behaviour (the reaper is a no-op, the MCP
  // trigger answers "configure the fleet") rather than inventing a project.
  const cfg = record
    ? toEffectiveConfig(record, { defaultWorker: env.FLEET_MCP_WORKER || 'mcp-client' })
    : envConfig(env);

  const jira = new JiraClient({ transport, project: cfg.jira.project, fields: cfg.jira.fields });
  return { cfg, jira, record, service };
}
