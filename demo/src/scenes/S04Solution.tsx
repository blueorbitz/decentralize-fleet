import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import Board from '../components/Board';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';
import { BOARD_TICKETS } from '../lib/story';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The whole idea in one frame: a board in the middle, four machines around it,
// two install steps, and the loop that turns a ticket into a PR.
export default function S04Solution() {
  const frame = useCurrentFrame();
  const boardIn = useAppear(6, 18, 24);
  const ring = interpolate(frame, [24, 54], [0, 1], clamp);
  const arrowIn = interpolate(frame, [58, 80], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="46%" />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: 1060, height: 560 }}>
          <Ring progress={ring} />

          <div
            style={{
              ...boardIn,
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              style={{
                padding: '18px 20px 22px',
                borderRadius: 12,
                backgroundColor: colors.n0,
                boxShadow: '0 30px 70px rgba(0,0,0,0.5)',
              }}
            >
              <Board tickets={BOARD_TICKETS} highlight="FLT-101" width={620} />
            </div>
          </div>

          <Node label="worker-04" sub="laptop" x={-8} y={56} delay={30} />
          <Node label="worker-11" sub="build box" x={88} y={56} delay={36} />
          <Node label="worker-02" sub="GPU desktop" x={-8} y={318} delay={42} />
          <Node label="worker-07" sub="spare laptop" x={88} y={318} delay={48} />
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 6, opacity: arrowIn }}>
          <InstallPill text="Install the Forge app in Jira" />
          <InstallPill text="Start a fleet worker on any machine" />
        </div>

        <div style={{ marginTop: 20 }}>
          <Caption delay={86} text="Jira is the queue. No scheduler in the middle." />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Ring({ progress }: { progress: number }) {
  return (
    <svg
      width={1060}
      height={560}
      style={{ position: 'absolute', inset: 0, opacity: progress }}
    >
      <ellipse
        cx={530}
        cy={280}
        rx={430}
        ry={228}
        fill="none"
        stroke={colors.line}
        strokeWidth={1.5}
        strokeDasharray="6 7"
        opacity={progress}
      />
      {[
        [180, 116],
        [880, 116],
        [180, 448],
        [880, 448],
      ].map(([x, y], i) => (
        <line
          key={i}
          x1={530}
          y1={280}
          x2={x}
          y2={y}
          stroke={colors.accentSoft}
          strokeWidth={1.5}
          opacity={progress * 0.85}
        />
      ))}
    </svg>
  );
}

function Node({
  label,
  sub,
  x,
  y,
  delay,
}: {
  label: string;
  sub: string;
  x: number;
  y: number;
  delay: number;
}) {
  const appear = useAppear(delay, 16, 14);
  return (
    <div
      style={{
        ...appear,
        position: 'absolute',
        left: `${x}%`,
        top: y,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 14px',
        borderRadius: 9,
        backgroundColor: colors.surfaceHi,
        border: `1px solid ${colors.lineHi}`,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: colors.green }} />
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontFamily: font.mono, fontSize: 14, color: colors.text }}>{label}</div>
        <div style={{ fontSize: 12, color: colors.textFaint }}>{sub}</div>
      </div>
    </div>
  );
}

function InstallPill({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 18px',
        borderRadius: 999,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.lineHi}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          backgroundColor: colors.accent,
        }}
      />
      <span style={{ fontSize: 16.5, color: colors.text }}>{text}</span>
    </div>
  );
}
