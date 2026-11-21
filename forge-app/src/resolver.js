// The Fleet issue panel's three resolver functions, independent of the Forge
// runtime.
//
// The panel is read-mostly on purpose: it renders state Jira already holds and
// exposes exactly two writes — dispatch (label + move to Ready for Build) and
// abort & requeue (the same Requeue transition the reaper uses). It never
// claims, runs, or merges: those belong to a worker and a human respectively.
//
// Taking the client and config as arguments keeps this testable without the
// Forge runtime; src/backend/index.js supplies the real ones.
import { buildPanelModel } from './panel-model.js';

export function createFleetResolver({ jira, cfg }) {
  function issueKey(context, action) {
    const key = context?.extension?.issue?.key;
    if (!key) throw new Error(`the Fleet panel must be ${action} on an issue`);
    return key;
  }

  return {
    'fleet.panel': async ({ context }) => {
      const key = issueKey(context, 'opened');
      const [ticket, comments] = await Promise.all([
        jira.getIssue(key, { fields: Object.values(cfg.jira.fields) }),
        jira.getComments(key),
      ]);
      return buildPanelModel({ ticket, comments, staleMs: cfg.timings.leaseStaleMs });
    },

    'fleet.dispatch': async ({ context }) => {
      const key = issueKey(context, 'opened');
      const result = await jira.markReady(key);
      await jira.comment(
        key,
        'Dispatched from the Fleet panel. A worker will claim this on its next poll ' +
          '(JQL `status = "Ready for Build"`). The panel does not claim on your behalf.',
      );
      return result;
    },

    'fleet.requeue': async ({ context, payload }) => {
      const key = issueKey(context, 'opened');
      const reason = payload?.reason || 'Aborted and requeued from the Fleet panel.';
      return jira.requeue(key, { reason });
    },
  };
}
