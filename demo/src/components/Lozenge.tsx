import { lozengePalette, lozengeToneFor } from '../theme';

// The status pill. Mirrors the real panel, which builds its own from tokens
// rather than pulling @atlaskit/lozenge, so the two read identically.
export default function Lozenge({
  status,
  size = 'md',
}: {
  status: string;
  size?: 'sm' | 'md';
}) {
  const tone = lozengePalette[lozengeToneFor(status)];
  const small = size === 'sm';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: small ? '2px 7px' : '3px 9px',
        borderRadius: 3,
        backgroundColor: tone.bg,
        color: tone.fg,
        fontSize: small ? 12 : 13,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}
