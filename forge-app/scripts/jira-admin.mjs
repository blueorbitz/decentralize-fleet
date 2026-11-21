// Can this account administer Jira?
//
// Creating custom fields and projects needs the *Administer Jira* global
// permission. When an account lacks it, Jira answers a 400 with a message that
// is translated into the user's locale, so the raw error is unhelpful. This
// probe turns it into one sentence that says who you are and what is missing.
import { JiraError } from '../src/jira.js';

/**
 * @returns {{ ok: boolean, accountId?: string, displayName?: string,
 *             email?: string, message?: string }}
 */
export async function checkAdmin({ client }) {
  // /myself also tells us which account the token actually belongs to, which is
  // the usual surprise: the token is fine, it is just someone else's token.
  let me;
  try {
    me = await client.request('GET', (tag) => tag`/rest/api/3/myself`);
  } catch (err) {
    if (err instanceof JiraError && err.status === 401) {
      return {
        ok: false,
        message: [
          'Authentication failed (HTTP 401).',
          '',
          'The email and token do not match, or the token has been revoked.',
          '  - The token must come from the same account as --email.',
          '  - Create one at https://id.atlassian.com/manage/api-tokens',
        ].join('\n'),
      };
    }
    throw err;
  }

  const who = `${me?.displayName || 'unknown'} (${me?.emailAddress || 'no email'})`;

  // The permissions endpoint reports the *caller's* global permissions.
  const perms = await client.request(
    'GET',
    (tag) => tag`/rest/api/3/mypermissions?permissions=ADMINISTER`,
  );
  const administer = perms?.permissions?.ADMINISTER;

  if (administer?.havePermission) {
    return { ok: true, accountId: me?.accountId, displayName: me?.displayName, email: me?.emailAddress };
  }

  return {
    ok: false,
    accountId: me?.accountId,
    displayName: me?.displayName,
    email: me?.emailAddress,
    message: [
      `${who} cannot administer Jira, so it cannot create custom fields.`,
      '',
      'A Jira API token inherits its permissions from the account that made it.',
      'Making a new token will not help — the account itself needs the right.',
      '',
      'Fix it in one of two ways:',
      '',
      '  1. Use an account that is already a Jira administrator, and create the',
      '     token from that account:',
      '       https://id.atlassian.com/manage/api-tokens',
      '',
      '  2. Ask a site admin to grant your account "Administer Jira":',
      '       Settings > System > Global permissions > Administer Jira > Add',
      '',
      `This token belongs to ${who}.`,
      `Check who you are with: curl -u "${me?.emailAddress || 'you@example.com'}:$TOKEN" \\`,
      '  ' + 'https://YOUR-SITE.atlassian.net/rest/api/3/myself',
    ].join('\n'),
  };
}
