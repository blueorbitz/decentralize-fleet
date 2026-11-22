import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import Footage from '../components/Footage';
import type { CursorEvent } from '../components/Cursor';
import type { CaptureManifest } from '../capture-types';
import rawCapture from '../capture.json';
import { colors, font } from '../theme';

const capture = rawCapture as CaptureManifest;

// Proof that a real take plays inside the composition: it loads the clip the
// capture harness wrote, lays the recorded events over it, and frames it like
// every other beat. Replaced by the real scenes once the takes exist.
export default function FootageProof() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const take = capture.takes.dryBoard;

  if (!take) {
    return (
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: font.mono, fontSize: 30, color: colors.textMuted }}>
          no footage yet — run npm run capture:dry
        </div>
      </AbsoluteFill>
    );
  }

  const events = (take.events || []) as CursorEvent[];
  const total = Math.round((take.durationMs ?? 0) / 1000);

  return (
    <AbsoluteFill style={{ fontFamily: font.sans }}>
      <Backdrop />
      <Footage
        src={take.src}
        events={events}
        offsetMs={take.offsetMs ?? 0}
        trimBeforeSeconds={take.trimBeforeSeconds ?? 0}
        chrome={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 40,
              padding: '0 16px',
              backgroundColor: colors.n10,
              borderBottom: `1px solid ${colors.n40}`,
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: '#FF5F57' }} />
            <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: '#FEBC2E' }} />
            <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: '#28C840' }} />
            <span style={{ marginLeft: 10, fontSize: 13, color: colors.n600, fontFamily: font.sans }}>
              {take.url || 'captured take'}
            </span>
          </div>
        }
      />
      <div style={{ position: 'absolute', bottom: 60, width: '100%', textAlign: 'center' }}>
        <Caption
          text={`REAL FOOTAGE · ${Math.round(frame / fps)}s / ${total}s`}
          delay={0}
        />
      </div>
    </AbsoluteFill>
  );
}
