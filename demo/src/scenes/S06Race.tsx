import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import Stage from '../components/Stage';
import Terminal from '../components/Terminal';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';
import { LOG_A, LOG_B } from '../lib/story';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The same ticket, seen by two machines in the same second. One transition wins;
// the other is rejected and moves on. No lock table, no coordinator.
export default function S06Race() {
  const frame = useCurrentFrame();
  const leftIn = useAppear(4, 16, 24);
  const rightIn = useAppear(12, 16, 24);

  // Both logs advance together until the claim, then B's rejection lands.
  const claimAt = 96;
  const verdict = interpolate(frame, [claimAt, claimAt + 20], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="40%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <Stage scale={1.2}>
          <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
            <div style={{ ...leftIn }}>
              <Terminal title="worker-04 — laptop" lines={LOG_A} startAt={30} perLine={9} width={700} />
              <Verdict show={verdict} tone="win" text="claimed — verify ok" />
            </div>
            <div style={{ ...rightIn }}>
              <Terminal
                title="worker-11 — build box"
                lines={LOG_B}
                startAt={30}
                perLine={9}
                width={700}
                accent={colors.amber}
              />
              <Verdict show={verdict} tone="lose" text="lost the claim race — moving on" />
            </div>
          </div>
        </Stage>

        <div style={{ marginTop: 30 }}>
          <Caption delay={150} text="Both saw it. One transition won. The board itself is the lock." />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Verdict({ show, tone, text }: { show: number; tone: 'win' | 'lose'; text: string }) {
  const win = tone === 'win';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        marginTop: 12,
        padding: '9px 13px',
        borderRadius: 7,
        opacity: show,
        transform: `translateY(${(1 - show) * 6}px)`,
        backgroundColor: win ? 'rgba(54,179,126,0.12)' : 'rgba(255,171,0,0.10)',
        border: `1px solid ${win ? 'rgba(54,179,126,0.45)' : 'rgba(255,171,0,0.42)'}`,
      }}
    >
      <span style={{ color: win ? colors.green : colors.amber, fontSize: 15, fontWeight: 700 }}>
        {win ? '✓' : '↷'}
      </span>
      <span style={{ fontFamily: font.mono, fontSize: 14, color: win ? '#9FE6C4' : '#F5D17A' }}>
        {text}
      </span>
    </div>
  );
}
