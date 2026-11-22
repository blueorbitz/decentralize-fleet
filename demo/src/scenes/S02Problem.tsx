import { AbsoluteFill } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';

// The two extremes, side by side, each with what it gains and what it costs.
export default function S02Problem() {
  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="40%" />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 40, alignItems: 'stretch' }}>
          <Pane
            delay={4}
            tag="TODAY — OPTION A"
            title="An engineer drives it locally"
            tone={colors.accent}
            rows={[
              ['+', 'Their repo, tools and credentials', 'good'],
              ['+', 'The agent can actually run the code', 'good'],
              ['−', 'One person, one machine, one ticket', 'bad'],
              ['−', 'Output stops when they close the laptop', 'bad'],
            ]}
          />
          <Pane
            delay={14}
            tag="TODAY — OPTION B"
            title="A cloud agent runs it"
            tone={colors.amber}
            rows={[
              ['+', 'Parallel and hands-off', 'good'],
              ['+', 'No laptop needed', 'good'],
              ['−', 'Fresh clone, no internal packages', 'bad'],
              ['−', 'Model leaves your network', 'bad'],
            ]}
          />
        </div>

        <div style={{ marginTop: 46 }}>
          <Caption
            delay={26}
            text="One is context-rich but single-threaded. The other scales but starts from nothing."
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Pane({
  delay,
  tag,
  title,
  tone,
  rows,
}: {
  delay: number;
  tag: string;
  title: string;
  tone: string;
  rows: [string, string, 'good' | 'bad'][];
}) {
  const appear = useAppear(delay, 18, 22);
  return (
    <div
      style={{
        ...appear,
        width: 560,
        padding: '28px 30px',
        borderRadius: 16,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.line}`,
        borderTop: `3px solid ${tone}`,
        boxShadow: '0 30px 70px rgba(0,0,0,0.4)',
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 12,
          letterSpacing: '0.14em',
          color: tone,
          marginBottom: 12,
        }}
      >
        {tag}
      </div>
      <div style={{ fontSize: 27, fontWeight: 600, color: colors.text, marginBottom: 20, lineHeight: 1.25 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {rows.map(([sign, text, kind], i) => (
          <Row
            key={text}
            sign={sign}
            text={text}
            kind={kind}
            delay={delay + 10 + i * 5}
          />
        ))}
      </div>
    </div>
  );
}

// Its own component so the hook is not called inside a map callback — the
// animation is per row, so the row has to own it.
function Row({
  sign,
  text,
  kind,
  delay,
}: {
  sign: string;
  text: string;
  kind: 'good' | 'bad';
  delay: number;
}) {
  const row = useAppear(delay, 12, 10);
  return (
    <div
      style={{
        ...row,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        fontFamily: font.sans,
        fontSize: 17.5,
        lineHeight: 1.4,
        color: kind === 'good' ? colors.text : colors.textMuted,
      }}
    >
      <span
        style={{
          color: kind === 'good' ? colors.green : colors.red,
          fontWeight: 700,
          width: 14,
          flexShrink: 0,
        }}
      >
        {sign}
      </span>
      <span>{text}</span>
    </div>
  );
}
