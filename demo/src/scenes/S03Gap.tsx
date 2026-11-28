import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import Backdrop from '../components/Backdrop';
import { BigCaption } from '../components/Caption';
import { colors, font } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The gap: two poles pull apart, and the space between them fills with the
// hardware people already own.
//
// Beat length comes from the voiceover, so the beats are fractions of it. The
// narration names the two extremes first, then the hardware, then lands on the
// question — and the picture follows that order.
export default function S03Gap() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = (fraction: number) => Math.round(durationInFrames * fraction);

  const spread = interpolate(frame, [0, p(0.14)], [230, 470], clamp);
  const fill = interpolate(frame, [p(0.34), p(0.52)], [0, 1], clamp);

  const machines = ['Laptop', 'Build box', 'GPU desktop'];

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="44%" />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spread }}>
          <Pole label="LOCAL" note="Great context" />
          <Pole label="CLOUD" note="Great scale" />
        </div>

        <div
          style={{
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            opacity: fill,
            width: 360,
            padding: '22px 24px',
            borderRadius: 14,
            backgroundColor: 'rgba(76, 154, 255, 0.10)',
            border: `1px dashed ${colors.accent}`,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 11.5,
              letterSpacing: '0.14em',
              color: colors.accent,
              marginBottom: 12,
            }}
          >
            THE MISSING MIDDLE
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {machines.map((m) => (
              <div
                key={m}
                style={{
                  fontFamily: font.sans,
                  fontSize: 17,
                  color: colors.text,
                  padding: '7px 0',
                  borderBottom: `1px solid rgba(147,163,188,0.14)`,
                }}
              >
                {m}
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 90, width: '100%' }}>
          <BigCaption
            text="Agentic work on hardware you already own."
            sub="Configured, credentialled, and idle most of the day."
            delay={p(0.56)}
            size={54}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Pole({ label, note }: { label: string; note: string }) {
  return (
    <div style={{ textAlign: 'center', width: 190 }}>
      <div
        style={{
          height: 180,
          borderRadius: 14,
          backgroundColor: colors.surface,
          border: `1px solid ${colors.line}`,
        }}
      />
      <div
        style={{
          marginTop: 14,
          fontFamily: font.mono,
          fontSize: 13,
          letterSpacing: '0.14em',
          color: colors.textMuted,
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 4, fontSize: 15, color: colors.textFaint }}>{note}</div>
    </div>
  );
}
