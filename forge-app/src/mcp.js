// Fleet MCP server — the read-mostly surface local coding agents and humans use
// to ask "what is the fleet doing?" and to repair a wrong or stale claim.
//
// Mirrors fleet-worker/src/mcp.js tool-for-tool so a client cannot tell which
// one it is talking to. Workers never call this; they speak Jira REST directly,
// which is why deleting this module would not change fleet behaviour.
//
// Transport-agnostic: `handle()` takes one JSON-RPC message and returns one
// response (or null for notifications). src/backend/mcp-handler.js wires it to
// the Forge webtrigger over streamable HTTP.
import { isLeaseStale } from './jira.js';
import { STATUS } from './config.js';

export const PROTOCOL_VERSION = '2024-11-05';

export const TOOLS = [
  {
    name: 'fleet_status',
    description: 'Summarise the fleet: active claims, queued (ready) tickets, stale leases and failures.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_claimable_tickets',
    description: 'List tickets in Ready for Build that a worker could claim, ordered by priority.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Project key (defaults to the configured project).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'claim_ticket',
    description: 'Claim a ticket with the same status-transition CAS a worker uses. Fails if another worker won.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Ticket key, e.g. FLT-101.' },
        worker: { type: 'string', description: 'Worker id to record on the claim.' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'report_run_result',
    description: 'Record a branch and pull request on a ticket and move it In Build -> In Review.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        branch: { type: 'string' },
        pr_url: { type: 'string' },
        tests: { type: 'object', properties: { ran: { type: 'number' }, passed: { type: 'number' } } },
      },
      required: ['key', 'branch'],
      additionalProperties: false,
    },
  },
  {
    name: 'reset_claim',
    description:
      'Requeue a claim (In Build -> Ready for Build, clearing worker and lease). Refuses while the run is live unless force is set.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        reason: { type: 'string' },
        force: { type: 'boolean', description: 'Requeue even if the lease is still fresh.' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
];

export function createMcpServer({ jira, cfg, logger = console } = {}) {
  const staleMs = cfg.timings?.leaseStaleMs ?? 15 * 60_000;

  async function callTool(name, args = {}) {
    switch (name) {
      case 'fleet_status':
        return fleetStatus();
      case 'list_claimable_tickets':
        return listClaimable(args.project);
      case 'claim_ticket':
        return claimTicket(args.key, args.worker);
      case 'report_run_result':
        return reportRunResult(args);
      case 'reset_claim':
        return resetClaim(args);
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  async function fleetStatus() {
    const inBuild = await jira.findInBuild();
    const queued = await jira.search(jql(STATUS.READY), { fields: [] });
    const failed = await jira.search(jql(STATUS.FAILED), { fields: [] });
    const now = Date.now();
    const stale = inBuild.filter((t) => isLeaseStale(t.lease, { now, staleMs }));
    return {
      claims: inBuild.map((t) => ({
        key: t.key,
        worker: t.worker,
        status: t.status,
        branch: t.branch,
        pr: t.pr,
        lease: t.lease,
        stale: isLeaseStale(t.lease, { now, staleMs }),
      })),
      // Distinct workers across live claims — the roster the board implies.
      workers: Array.from(new Set(inBuild.map((t) => t.worker).filter(Boolean))),
      active: inBuild.length,
      queued: queued.length,
      stale: stale.length,
      failed: failed.length,
    };
  }

  async function listClaimable(project) {
    const tickets = await jira.search(jql(STATUS.READY, project), { fields: [] });
    return tickets.map((t) => ({
      key: t.key,
      summary: t.summary,
      priority: t.priority,
      status: t.status,
      labels: t.labels,
    }));
  }

  async function claimTicket(key, worker) {
    if (!key) throw new Error('key is required');
    const workerId = worker || cfg.mcp?.defaultWorker || 'mcp-client';
    await jira.claim(key, { workerId });
    return { key, status: STATUS.IN_BUILD, worker: workerId };
  }

  async function reportRunResult({ key, branch, pr_url: prUrl }) {
    if (!key || !branch) throw new Error('key and branch are required');
    await jira.report(key, { branch, prUrl });
    return { key, status: STATUS.IN_REVIEW, branch, pr: prUrl ?? null };
  }

  async function resetClaim({ key, reason, force } = {}) {
    if (!key) throw new Error('key is required');
    const issue = await jira.getIssue(key, { fields: Object.values(cfg.jira.fields) });
    if (!force && !isLeaseStale(issue.lease, { staleMs })) {
      return { key, status: issue.status, refused: 'run still live — pass force to requeue anyway' };
    }
    await jira.requeue(key, { reason: reason || 'reset via MCP' });
    return { key, status: STATUS.READY, cleared: [cfg.jira.fields.worker, cfg.jira.fields.lease] };
  }

  function jql(status, project) {
    return `project = ${project || cfg.jira.project} AND status = "${status}" ORDER BY priority DESC, created ASC`;
  }

  async function handle(msg) {
    if (!msg || typeof msg !== 'object') return null;
    const isNotification = msg.id === undefined || msg.id === null;

    try {
      switch (msg.method) {
        case 'initialize':
          return reply(msg, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, resources: { subscribe: false, listChanged: false } },
            serverInfo: { name: 'fleet-mcp', version: '0.1.0' },
          });
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        case 'ping':
          return reply(msg, {});
        case 'tools/list':
          return reply(msg, { tools: TOOLS });
        case 'resources/list':
          return reply(msg, {
            resources: [{ uri: 'fleet://status', name: 'Fleet status', mimeType: 'application/json' }],
          });
        case 'resources/read': {
          if (msg.params?.uri !== 'fleet://status') throw new Error(`unknown resource: ${msg.params?.uri}`);
          const status = await fleetStatus();
          return reply(msg, {
            contents: [{ uri: 'fleet://status', mimeType: 'application/json', text: JSON.stringify(status, null, 2) }],
          });
        }
        case 'tools/call': {
          const { name, arguments: args } = msg.params || {};
          const payload = await callTool(name, args);
          return reply(msg, { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
        }
        default:
          if (!isNotification) return error(msg, -32601, `method not found: ${msg.method}`);
          return null;
      }
    } catch (err) {
      logger.error?.(`mcp error: ${err.message}`);
      if (isNotification) return null;
      if (msg.method === 'tools/call') {
        return reply(msg, { content: [{ type: 'text', text: `error: ${err.message}` }], isError: true });
      }
      return error(msg, -32603, err.message);
    }
  }

  return { handle, callTool, fleetStatus, TOOLS };
}

function reply(msg, result) {
  return { jsonrpc: '2.0', id: msg.id, result };
}

function error(msg, code, message) {
  return { jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } };
}
