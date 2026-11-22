import type { CSSProperties, ReactNode } from 'react';
import { colors, font } from '../theme';

// Browser/app chrome. Every real surface in the video sits in one of these so the
// footage, the faux settings page and the panel all read as the same product.
export default function Frame({
  url,
  host,
  children,
  style,
  bodyStyle,
  chromeStyle,
}: {
  url?: string;
  host?: string;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  chromeStyle?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: colors.n0,
        border: `1px solid ${colors.lineHi}`,
        boxShadow: '0 40px 90px rgba(0, 0, 0, 0.55), 0 2px 0 rgba(255,255,255,0.04) inset',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          height: 44,
          padding: '0 16px',
          backgroundColor: colors.n10,
          borderBottom: `1px solid ${colors.n40}`,
          flexShrink: 0,
          ...chromeStyle,
        }}
      >
        <span style={{ width: 11, height: 11, borderRadius: 99, backgroundColor: '#FF5F57' }} />
        <span style={{ width: 11, height: 11, borderRadius: 99, backgroundColor: '#FEBC2E' }} />
        <span style={{ width: 11, height: 11, borderRadius: 99, backgroundColor: '#28C840' }} />
        {url ? (
          <div
            style={{
              marginLeft: 12,
              flex: 1,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
              borderRadius: 6,
              backgroundColor: colors.n0,
              border: `1px solid ${colors.n40}`,
              fontFamily: font.sans,
              fontSize: 13,
              color: colors.n600,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {url}
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}
        {host ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: colors.n500,
              whiteSpace: 'nowrap',
            }}
          >
            {host}
          </span>
        ) : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', ...bodyStyle }}>{children}</div>
    </div>
  );
}
