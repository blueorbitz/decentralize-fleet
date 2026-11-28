import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import Backdrop from '../components/Backdrop';
import { BigCaption } from '../components/Caption';
import { useAppear } from '../lib/anim';
import { colors, font } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Closing: the machines come alive one by one, then the two-step call to action.
//
// The narration closes with "Install the app. Start a worker. Put your fleet to
// work", so the end card is what the voice lands on. Its timings are a fraction
// of the beat rather than fixed frames, because the beat's length comes from the
// voiceover and changes whenever the audio is re-recorded.
const MACHINES = ['laptop', 'build box', 'GPU desktop', 'spare laptop', 'old workstation'];

export default function S13Closing() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const lineAt = Math.round(durationInFrames * 0.45);
  const cardAt = Math.round(durationInFrames * 0.66);
  const urlAt = Math.round(durationInFrames * 0.78);

  const endCard = useAppear(cardAt, 22, 22);
  const url = interpolate(frame, [urlAt, urlAt + 26], [0, 1], clamp);
  const line = interpolate(frame, [lineAt, lineAt + 24], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="46%" />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 44 }}>
          {MACHINES.map((m, i) => {
            const on = interpolate(frame, [6 + i * 9, 20 + i * 9], [0, 1], clamp);
            return <Machine key={m} label={m} on={on} />;
          })}
        </div>

        <div style={{ opacity: line }}>
          <BigCaption
            text="Your machines. Your tools. One board."
            sub="Cloud parallelism, without cloud lock-in."
            delay={lineAt}
            size={62}
          />
        </div>

        <div style={{ ...endCard, marginTop: 76, textAlign: 'center' }}>
          <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em', color: colors.text }}>
            Install the app. Start a worker.
          </div>
          <div style={{ marginTop: 14, fontFamily: font.mono, fontSize: 20, color: colors.accent, opacity: url }}>
            Put your fleet to work.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Machine({ label, on }: { label: string; on: number }) {
  return (
    <div style={{ width: 180, textAlign: 'center' }}>
      <div
        style={{
          height: 104,
          borderRadius: 12,
          backgroundColor: colors.surface,
          border: `1px solid ${on > 0.5 ? colors.lineHi : colors.line}`,
          boxShadow: on > 0.5 ? `0 0 34px rgba(54,179,126,${0.18 * on})` : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 99,
            backgroundColor: on > 0.5 ? colors.green : colors.lineHi,
            boxShadow: on > 0.5 ? `0 0 14px ${colors.green}` : 'none',
          }}
        />
      </div>
      <div style={{ marginTop: 10, fontSize: 13.5, color: on > 0.5 ? colors.textMuted : colors.textFaint }}>
        {label}
      </div>
    </div>
  );
}
