import { colors, font } from '../theme';

// The window chrome over a captured take. The clip already contains the real
// browser, so this is only the address label: it names the surface the shot is
// of (Jira, Bitbucket) without repeating the whole URL.
export default function Chrome({ url }: { url?: string }) {
  const label = shortUrl(url);
  const host = label.split('/')[0] || 'captured take';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 38,
        padding: '0 14px',
        backgroundColor: colors.n10,
        borderBottom: `1px solid ${colors.n40}`,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: '#FF5F57' }} />
      <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: '#FEBC2E' }} />
      <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: '#28C840' }} />
      <span
        style={{
          marginLeft: 10,
          flex: 1,
          fontFamily: font.sans,
          fontSize: 13,
          color: colors.n600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.n500,
        }}
      >
        {host.includes('bitbucket') ? 'Bitbucket' : 'Jira'}
      </span>
    </div>
  );
}

// host + the most identifying path segment, so the label stays one line.
function shortUrl(url?: string) {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const match = /\/(browse\/[A-Z0-9-]+|pull-requests\/\d+|boards\/\d+)/.exec(u.pathname);
    return `${u.host}${match ? `/${match[1]}` : ''}`;
  } catch {
    return url;
  }
}
