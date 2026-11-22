import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The agent is a plug-in. Four harnesses, one contract on either side of it.
// Wordmarks only — no vendor logos, and nothing about how each one is wired.
const AGENTS = ['Copilot', 'OpenCode', 'Claude Code', 'Codex'];

export default function S12Agents() {
  const frame = useCurrentFrame();
  const contractIn = useAppear(30, 18, 18);
  const ioIn = interpolate(frame, [64, 84], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="44%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 46 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {AGENTS.map((name, i) => (
              <AgentMark key={name} name={name} delay={8 + i * 8} />
            ))}
          </div>

          <Connectors progress={interpolate(frame, [44, 62], [0, 1], clamp)} />

          <div style={contractIn}>
            <div
              style={{
                width: 430,
                padding: '26px 28px',
                borderRadius: 16,
                backgroundColor: colors.surfaceHi,
                border: `1px solid ${colors.accent}`,
                boxShadow: '0 30px 70px rgba(0,0,0,0.45)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontFamily: font.mono, fontSize: 12, letterSpacing: '0.14em', color: colors.accent }}>
                THE CONTRACT
              </div>
              <div style={{ fontSize: 27, fontWeight: 600, color: colors.text, marginTop: 10, lineHeight: 1.25 }}>
                A ticket in.<br />A result out.
              </div>
              <div style={{ marginTop: 16, fontSize: 14.5, lineHeight: 1.5, color: colors.textMuted }}>
                The worker never knows which agent it is talking to.
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 34,
            opacity: ioIn,
            transform: `translateY(${(1 - ioIn) * 8}px)`,
          }}
        >
          <Io label="IN" value="ticket · repo · branch · timeout" />
          <Io label="OUT" value="status · branch · PR · tests" />
        </div>

        <div style={{ marginTop: 20 }}>
          <Caption delay={92} text="Whatever is installed on that machine is what runs." />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function AgentMark({ name, delay }: { name: string; delay: number }) {
  const appear = useAppear(delay, 14, 10);
  return (
    <div
      style={{
        ...appear,
        width: 300,
        padding: '14px 20px',
        borderRadius: 10,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.line}`,
        fontSize: 20,
        fontWeight: 500,
        letterSpacing: '-0.01em',
        color: colors.text,
      }}
    >
      {name}
    </div>
  );
}

function Connectors({ progress }: { progress: number }) {
  return (
    <svg width={132} height={248} style={{ opacity: progress }}>
      {[0, 1, 2, 3].map((i) => {
        const y = 31 + i * 62;
        return (
          <path
            key={i}
            d={`M0 ${y} C 66 ${y}, 66 124, 132 124`}
            fill="none"
            stroke={colors.lineHi}
            strokeWidth={2}
          />
        );
      })}
      <line x1={132} y1={124} x2={132} y2={124} stroke={colors.accent} strokeWidth={3} />
    </svg>
  );
}

function Io({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 16px',
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.04)',
        border: `1px solid ${colors.line}`,
      }}
    >
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 11,
          letterSpacing: '0.12em',
          color: colors.accent,
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: font.mono, fontSize: 13, color: colors.textMuted }}>{value}</span>
    </div>
  );
}
