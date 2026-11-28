// The Fleet project page's resolver. Read-only: it renders presence, and no
// function here can claim, dispatch or change a worker.
import { projectFromContext } from '../settings/resolver.js';

export function createPageResolver({ presence }) {
  if (!presence) throw new Error('createPageResolver needs a presence service');

  return {
    'fleet.page.get': async ({ context }) => {
      const project = projectFromContext(context);
      const state = await presence.list(project.id);
      return { project, ...state };
    },
  };
}
