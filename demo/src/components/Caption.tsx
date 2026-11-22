import type { CSSProperties, ReactNode } from 'react';
import { useAppear } from '../lib/anim';

// One caption line per beat. Kept short: the picture carries the detail.
export default function Caption({
  text,
  delay = 6,
  style,
}: {
  text: string;
  delay?: number;
  style?: CSSProperties;
}) {
  const appear = useAppear(delay, 16, 12);
  return (
    <div
      style={{
        ...appear,
        ...style,
        display: 'inline-flex',
        alignItems: 'center',
        padding: '18px 34px',
        borderRadius: 14,
        backgroundColor: 'rgba(9, 15, 27, 0.82)',
        border: '1px solid rgba(147, 163, 188, 0.22)',
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.45)',
      }}
    >
      <span
        style={{
          fontSize: 34,
          lineHeight: 1.25,
          letterSpacing: '-0.01em',
          color: '#F2F6FC',
          fontWeight: 500,
        }}
      >
        {text}
      </span>
    </div>
  );
}

// A heavier title for the opening frames, where the caption is the message.
export function BigCaption({
  text,
  sub,
  delay = 6,
  size = 76,
}: {
  text: ReactNode;
  sub?: string;
  delay?: number;
  size?: number;
}) {
  const appear = useAppear(delay, 20, 26);
  return (
    <div style={{ ...appear, textAlign: 'center' }}>
      <div
        style={{
          fontSize: size,
          lineHeight: 1.08,
          fontWeight: 600,
          letterSpacing: '-0.03em',
          color: '#F2F6FC',
          textShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
      >
        {text}
      </div>
      {sub ? (
        <div
          style={{
            marginTop: 22,
            fontSize: 30,
            lineHeight: 1.4,
            color: '#93A3BC',
            fontWeight: 400,
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}
