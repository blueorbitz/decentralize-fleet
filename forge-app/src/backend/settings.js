// Forge wiring for the Fleet settings page.
//
// The only file that knows the page runs on Forge: it builds the KVS-backed
// store, the installation-scoped Jira client and the project-permission probe,
// then hands them to the runtime-free resolver. Everything it composes is
// tested without it.
import { makeResolver } from '@forge/resolver';
import { asApp, asUser, route, webTrigger } from '@forge/api';
import { kvs } from '@forge/kvs';
import { JiraClient } from '../jira.js';
import { forgeTransport } from '../transports.js';
import { envConfig } from '../config.js';
import { forgeStore } from '../settings/store.js';
import { createSettingsService } from '../settings/service.js';
import { createSettingsResolver } from '../settings/resolver.js';

// The project's key, needed for the permission probe. The page's context has it;
// a resolver call that lacks it can fall back to the stored record.
async function projectKeyFor(project, store) {
  if (project.key) return project.key;
  const record = await store.getConfig(project.id);
  return record?.projectKey || envConfig(process.env).jira.project;
}

// ADMINISTER_PROJECTS on this project, checked as the invoking user. Forge does
// not gate jira:projectSettingsPage itself, so this is the rule that makes the
// page trustworthy: without it, anyone who can open the page could read tokens.
async function isProjectAdmin(project, { store }) {
  const projectKey = await projectKeyFor(project, store);
  try {
    const res = await asUser().requestJira(
      route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=ADMINISTER_PROJECTS`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body?.permissions?.ADMINISTER_PROJECTS?.havePermission);
  } catch {
    // Fail closed: an unreadable permission is not permission.
    return false;
  }
}

export async function settingsHandler(payload, runtimePayload) {
  const store = forgeStore(kvs);
  const cfg = envConfig(process.env);
  const jira = new JiraClient({
    transport: forgeTransport({ asApp, route }),
    project: cfg.jira.project,
    fields: cfg.jira.fields,
  });
  const service = createSettingsService({ store, env: process.env, jira });
  const definitions = makeResolver(
    createSettingsResolver({
      service,
      isProjectAdmin: (project) => isProjectAdmin(project, { store }),
      heartbeatUrl: () => webTrigger.getUrl('fleet-heartbeat'),
    }),
  );
  return definitions(payload, runtimePayload);
}
