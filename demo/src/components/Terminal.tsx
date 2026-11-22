import { interpolate, useCurrentFrame } from 'remotion';
import { colors, font } from '../theme';
import { useLineCount } from '../lib/anim';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export type LogLine = { text: string; tone?: 'info' | 'ok' | 'warn' | 'dim' };

const toneColor: Record<string, string> = {
  info: '#C9D6EA',
  ok: colors.green,
  warn: colors.amber,
  dim: '#6B7A93',
};

// One worker terminal. The content is the real captured log text; only the
// reveal is animated, so what the viewer reads is exactly what the worker wrote.
export default function Terminal({
  title,
  lines,
  startAt = 0,
  perLine = 7,
  width,
  accent = colors.accent,
  style,
}: {
  title: string;
  lines: LogLine[];
  startAt?: number;
  perLine?: number;
  width?: number | string;
  accent?: string;
  style?: React.CSSProperties;
}) {
  const frame = useCurrentFrame();
  const visible = useLineCount(lines.length, startAt, perLine);
  const caret = Math.floor(frame / 8) % 2 === 0;

  return (
    <div
      style={{
        width,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#0A1120',
        border: `1px solid ${colors.lineHi}`,
        boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 36,
          padding: '0 14px',
          backgroundColor: '#0D1626',
          borderBottom: `1px solid ${colors.line}`,
          flexShrink: 0,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: accent }} />
        <span style={{ fontFamily: font.mono, fontSize: 12.5, color: '#8FA1BC' }}>{title}</span>
      </div>
      <div
        style={{
          padding: '16px 18px',
          fontFamily: font.mono,
          fontSize: 15.5,
          lineHeight: 1.62,
          minHeight: 0,
          flex: 1,
          overflow: 'hidden',
        }}
      >
        {lines.slice(0, visible).map((line, i) => {
          const isLatest = i === visible - 1;
          const lineOpacity = isLatest
            ? interpolate(frame - (startAt + i * perLine), [0, 6], [0, 1], clamp)
            : 1;
          return (
            <div
              key={`${i}-${line.text}`}
              style={{
                color: toneColor[line.tone ?? 'info'],
                opacity: lineOpacity,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {line.text}
            </div>
          );
        })}
        <span
          style={{
            display: 'inline-block',
            width: 9,
            height: 18,
            marginTop: 2,
            backgroundColor: caret ? accent : 'transparent',
          }}
        />
      </div>
    </div>
  );
}
