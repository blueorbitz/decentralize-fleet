import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Topology: the Forge app in Atlassian's cloud, Jira, and one local machine.
// The dashed lines are the rule of the design — nothing crosses directly.
export default function S10Topology() {
  const frame = useCurrentFrame();
  const cloud = useAppear(6, 18, 20);
  const jira = useAppear(16, 18, 20);
  const machine = useAppear(26, 18, 20);
  const forgeLine = interpolate(frame, [44, 62], [0, 1], clamp);
  const workerLine = interpolate(frame, [56, 74], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="44%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ position: 'relative', width: 1500, height: 520 }}>
          {/* connector: Forge app -> Jira (local API call) */}
          <Line x1={470} y1={150} x2={750} y2={150} progress={forgeLine} label="api.asApp().requestJira()" />
          {/* connector: worker -> Jira (REST v3) */}
          <Line x1={750} y1={330} x2={470} y2={330} progress={workerLine} label="REST v3 · bot token" />

          <div style={{ ...cloud, position: 'absolute', left: 0, top: 62 }}>
            <Box
              title="Atlassian Cloud"
              subtitle="The Forge app"
              lines={['jira:issuePanel — the Fleet panel', 'scheduledTrigger — repair loop', 'webtrigger — MCP endpoint']}
              tone={colors.accent}
            />
          </div>

          <div style={{ ...jira, position: 'absolute', left: 800, top: 176 }}>
            <Box
              title="Jira"
              subtitle="The queue and the lock"
              lines={['status transitions', 'five Fleet fields', 'comments as the run log']}
              tone={colors.green}
              accent
            />
          </div>

          <div style={{ ...machine, position: 'absolute', left: 0, top: 244 }}>
            <Box
              title="Your machine"
              subtitle="fleet-worker (Node)"
              lines={['polls the board', 'runs your agent in your repo', 'pushes a branch, opens a PR']}
              tone={colors.amber}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 26, marginTop: 10 }}>
          <Rule text="The app and the worker never call each other." />
        </div>

        <div style={{ marginTop: 20 }}>
          <Caption delay={80} text="Both sides write to Jira. Jira serialises it." />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Line({
  x1,
  y1,
  x2,
  y2,
  progress,
  label,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  progress: number;
  label: string;
}) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <svg width={1500} height={520} style={{ position: 'absolute', inset: 0 }}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={colors.lineHi}
        strokeWidth={2}
        strokeDasharray="7 6"
        opacity={progress}
      />
      <text
        x={midX}
        y={midY - 12}
        textAnchor="middle"
        fontFamily={font.mono}
        fontSize={12}
        fill={colors.textFaint}
        opacity={progress}
      >
        {label}
      </text>
    </svg>
  );
}

function Box({
  title,
  subtitle,
  lines,
  tone,
  accent,
}: {
  title: string;
  subtitle: string;
  lines: string[];
  tone: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        width: 470,
        padding: '20px 24px',
        borderRadius: 14,
        backgroundColor: accent ? colors.surfaceHi : colors.surface,
        border: `1px solid ${accent ? tone : colors.line}`,
        borderTop: `3px solid ${tone}`,
        boxShadow: '0 26px 60px rgba(0,0,0,0.42)',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 600, color: colors.text }}>{title}</div>
      <div style={{ fontFamily: font.mono, fontSize: 12.5, color: tone, marginTop: 3, marginBottom: 14 }}>
        {subtitle}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {lines.map((l) => (
          <div key={l} style={{ display: 'flex', gap: 9, fontSize: 15, lineHeight: 1.4, color: colors.textMuted }}>
            <span style={{ color: tone, opacity: 0.7 }}>·</span>
            <span>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Rule({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '10px 18px',
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.04)',
        border: `1px solid ${colors.line}`,
        fontSize: 15,
        color: colors.textMuted,
      }}
    >
      {text}
    </div>
  );
}
