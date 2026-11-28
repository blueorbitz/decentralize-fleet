// The settings page's resolver functions, independent of the Forge runtime.
//
// Same shape as src/resolver.js: a factory takes its dependencies and returns a
// map of named functions. src/backend/settings.js supplies the real store, the
// real permission probe and the real Jira client; the tests supply don't-cares.
//
// The permission gate is injected (`isProjectAdmin`), not reached for here, so
// the rule is testable. It only guards writes: a non-admin sees the whole page,
// token values and generated config included, but `save`, `tokens.generate`,
// `tokens.add` and `tokens.revoke` are refused with 403.
import { SettingsError } from './service.js';
import { STATUS, TRANSITION, READY_LABEL } from '../config.js';

export function createSettingsResolver({
  service,
  isProjectAdmin,
  protocol = DEFAULT_PROTOCOL,
  // Resolving the webtrigger URL is a platform call, injected so tests do not
  // need Forge. The URL is stable for the life of the install, so cache it.
  heartbeatUrl = async () => null,
}) {
  let heartbeatUrlCache;

  async function resolveHeartbeatUrl() {
    if (heartbeatUrlCache !== undefined) return heartbeatUrlCache;
    try {
      heartbeatUrlCache = (await heartbeatUrl()) || null;
    } catch {
      heartbeatUrlCache = null;
    }
    return heartbeatUrlCache;
  }

  return {
    // Everything the page needs on first paint.
    'fleet.settings.get': async ({ context }) => {
      const project = projectFromContext(context);
      const { record, configured, provenance } = await service.getProject(project.id, { projectKey: project.key });
      const canEdit = await isProjectAdmin(project);
      const url = await resolveHeartbeatUrl();
      return {
        project,
        record,
        configured,
        provenance,
        canEdit,
        heartbeatUrl: url,
        // Read-only content is still content: a non-admin gets the same page,
        // including the copyable worker .env, but every write below is refused.
        workerEnv: service.workerEnv(record, { heartbeatUrl: url }),
      };
    },

    'fleet.settings.save': async ({ context, payload }) => {
      const project = await requireProjectAdmin(context);
      try {
        const record = await service.save(project.id, payload?.record ?? payload, { projectKey: project.key });
        return { ok: true, record, workerEnv: service.workerEnv(record, { heartbeatUrl: await resolveHeartbeatUrl() }) };
      } catch (err) {
        if (err instanceof SettingsError && err.status === 422) {
          return { ok: false, error: err.message, checks: err.details };
        }
        throw err;
      }
    },

    // Test connection: the same checks a save runs, without writing. Read-only,
    // so a non-admin may run it.
    'fleet.settings.validate': async ({ context, payload }) => {
      const project = projectFromContext(context);
      return service.validate(project.id, payload?.record ?? payload);
    },

    'fleet.settings.protocol': async () => protocol,

    // The env block for a specific token. Same trust level as the .mcp.json
    // action: the token is already re-revealable on this page.
    'fleet.settings.env': async ({ context, payload }) => {
      const project = projectFromContext(context);
      const record = payload?.record || (await service.getProject(project.id)).record;
      let heartbeatToken = null;
      if (payload?.tokenId) {
        heartbeatToken = (await service.revealToken(project.id, payload.tokenId)).value;
      }
      return {
        env: service.workerEnv(record, {
          heartbeatUrl: await resolveHeartbeatUrl(),
          heartbeatToken,
        }),
      };
    },

    'fleet.settings.mcpClient': async ({ context, payload }) => {
      const project = projectFromContext(context);
      const { record } = await service.getProject(project.id);
      let tokenValue;
      if (payload?.tokenId) {
        tokenValue = (await service.revealToken(project.id, payload.tokenId)).value;
      }
      return { json: service.mcpClientConfig(record, tokenValue) };
    },

    'fleet.settings.tokens.list': async ({ context }) => {
      const project = projectFromContext(context);
      return { tokens: await service.listTokens(project.id) };
    },

    // Re-revealing a token is a read, so read-only access gets it too. The
    // spec's "read-only everything" is explicit about this.
    'fleet.settings.tokens.reveal': async ({ context, payload }) => {
      const project = projectFromContext(context);
      return service.revealToken(project.id, payload?.tokenId);
    },

    'fleet.settings.tokens.generate': async ({ context, payload }) => {
      const project = await requireProjectAdmin(context);
      return service.generateToken(project.id, payload?.name);
    },

    'fleet.settings.tokens.add': async ({ context, payload }) => {
      const project = await requireProjectAdmin(context);
      return service.addToken(project.id, { id: payload?.id, name: payload?.name, value: payload?.value });
    },

    'fleet.settings.tokens.revoke': async ({ context, payload }) => {
      const project = await requireProjectAdmin(context);
      return service.revokeToken(project.id, payload?.tokenId);
    },
  };

  async function requireProjectAdmin(context) {
    const project = projectFromContext(context);
    if (!(await isProjectAdmin(project))) {
      throw new SettingsError(`only a project administrator can change the fleet configuration`, { status: 403 });
    }
    return project;
  }
}

// The extension exposes `project.id` / `project.key`; the platform context uses
// `projectId` / `projectKey`. Accept either so the resolver is not coupled to
// which of the two Forge hands us.
export function projectFromContext(context) {
  const extension = context?.extension || context || {};
  const id = extension.project?.id || extension.projectId || null;
  const key = extension.project?.key || extension.projectKey || null;
  if (!id) throw new SettingsError('the Fleet settings page must be opened in a project', { status: 400 });
  return { id: String(id), key: key ? String(key) : null };
}

// The read-only block: the names the worker and the app resolve by. Never
// editable, because editing one here would break the contract silently.
export const DEFAULT_PROTOCOL = {
  statuses: Object.values(STATUS),
  transitions: Object.values(TRANSITION),
  readyLabel: READY_LABEL,
};
