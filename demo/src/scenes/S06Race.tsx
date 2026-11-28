import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import Terminal from '../components/Terminal';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';
import { LOG_A, LOG_B } from '../lib/story';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The same ticket, seen by two machines in the same second. One transition wins;
// the other is rejected and moves on. No lock table, no coordinator.
//
// After the two logs have played, the camera pushes in on the verdict pair: the
// winning `verify ok` line and the losing rejection. Everything before that is
// the real stdout those workers printed.
export default function S06Race() {
  const frame = useCurrentFrame();
  const leftIn = useAppear(4, 16, 24);
  const rightIn = useAppear(12, 16, 24);

  const claimAt = 104;
  const verdict = interpolate(frame, [claimAt, claimAt + 20], [0, 1], clamp);

  // Push in gently and settle between the two windows, so both verdict lines
  // stay on screen. A tighter push crops the losing terminal off the left edge.
  const push = interpolate(frame, [claimAt + 24, claimAt + 66], [0, 1], clamp);
  const zoom = 1.0 + 0.13 * push;
  const shiftY = -18 * push;

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="40%" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div
          style={{
            transform: `scale(${zoom}) translateY(${shiftY}px)`,
            transformOrigin: 'center 54%',
          }}
        >
          <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
            <div style={leftIn}>
              <Terminal title="worker-04 — laptop" lines={LOG_A} startAt={26} perLine={9} width={690} />
              <Verdict show={verdict} tone="win" text="claimed — verify ok" />
            </div>
            <div style={rightIn}>
              <Terminal
                title="worker-11 — build box"
                lines={LOG_B}
                startAt={26}
                perLine={9}
                width={690}
                accent={colors.amber}
              />
              <Verdict show={verdict} tone="lose" text="lost the claim race — moving on" />
            </div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 48,
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            opacity: 1 - 0.55 * push,
          }}
        >
          <Caption delay={claimAt + 30} text="Both saw it. One transition won. The board itself is the lock." />
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
        padding: '10px 14px',
        borderRadius: 7,
        opacity: show,
        transform: `translateY(${(1 - show) * 6}px)`,
        backgroundColor: win ? 'rgba(54,179,126,0.12)' : 'rgba(255,171,0,0.10)',
        border: `1px solid ${win ? 'rgba(54,179,126,0.45)' : 'rgba(255,171,0,0.42)'}`,
      }}
    >
      <span style={{ color: win ? colors.green : colors.amber, fontSize: 16, fontWeight: 700 }}>{win ? '✓' : '↷'}</span>
      <span style={{ fontFamily: font.mono, fontSize: 15, color: win ? '#9FE6C4' : '#F5D17A' }}>{text}</span>
    </div>
  );
}
