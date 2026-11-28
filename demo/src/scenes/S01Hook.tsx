import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import { BigCaption } from '../components/Caption';
import { colors, font } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// The hook, cut to the narration:
//
//   "Every team now has two kinds of AI coding."      both, side by side
//   "One runs on your laptop."                        left brightens
//   "The other runs in someone else's cloud."         right brightens
//   "What if it ran on your machines — all of them?"  both, then the question
//
// Phase boundaries are in beats.json (12.46s = 374 frames). The first line is
// a third of the beat, so it needs its own visual: the two options are on
// screen together before either is introduced, which is what makes "two kinds"
// read without a caption having to say it twice.
const FPS = 30;
const at = (seconds: number) => Math.round(seconds * FPS);

const INTRO_END = at(3.6);
const LAPTOP_END = at(5.6);
const CLOUD_END = at(8.4);

export default function S01Hook() {
  const frame = useCurrentFrame();

  // Both marks are always present; the active one is bright and full size and
  // the other recedes, so the eye follows the voice without anything moving in
  // or out of frame.
  const laptopOpacity = interpolate(
    frame,
    [0, 14, INTRO_END, INTRO_END + 14, LAPTOP_END - 4, LAPTOP_END + 12, CLOUD_END - 4, CLOUD_END + 14],
    [0, 0.5, 0.5, 1, 1, 0.2, 0.2, 0.85],
    clamp,
  );
  const cloudOpacity = interpolate(
    frame,
    [0, 14, INTRO_END, INTRO_END + 14, LAPTOP_END - 4, LAPTOP_END + 12, CLOUD_END - 4, CLOUD_END + 14],
    [0, 0.5, 0.5, 0.2, 0.2, 1, 1, 0.85],
    clamp,
  );
  const laptopScale = interpolate(frame, [INTRO_END, INTRO_END + 14, LAPTOP_END + 12, CLOUD_END + 14], [0.94, 1, 0.94, 0.98], clamp);
  const cloudScale = interpolate(frame, [INTRO_END + 4, LAPTOP_END + 12, CLOUD_END + 14], [0.94, 1, 0.98], clamp);

  // The divider says "two" while the voice says "two kinds", then gets out of
  // the way once each side is being introduced.
  const divider = interpolate(frame, [10, 30, INTRO_END, INTRO_END + 16], [0, 0.5, 0.5, 0], clamp);

  const question = interpolate(frame, [CLOUD_END + 6, CLOUD_END + 28], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="44%" />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 120 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 90 }}>
          <div style={{ opacity: laptopOpacity, transform: `scale(${laptopScale})` }}>
            <DeviceMark kind="laptop" />
          </div>
          <div style={{ width: 1, height: 170, backgroundColor: colors.lineHi, opacity: divider }} />
          <div style={{ opacity: cloudOpacity, transform: `scale(${cloudScale})` }}>
            <DeviceMark kind="cloud" />
          </div>
        </div>
      </AbsoluteFill>

      <div style={{ position: 'absolute', top: '66%', width: '100%' }}>
        {frame < INTRO_END ? (
          <BigCaption text="Two kinds of AI coding" sub="The same team, two very different setups" delay={6} size={62} />
        ) : frame < LAPTOP_END ? (
          <BigCaption text="One runs on your laptop" sub="One engineer, one machine" delay={0} size={58} />
        ) : frame < CLOUD_END ? (
          <BigCaption text="The other runs in someone's cloud" sub="Fresh container, every time" delay={0} size={58} />
        ) : (
          <div style={{ opacity: question }}>
            <BigCaption
              text="What if it ran on all of them?"
              sub="Your machines. Your setup. Coordinated."
              delay={4}
              size={68}
            />
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

function DeviceMark({ kind }: { kind: 'laptop' | 'cloud' }) {
  const stroke = colors.accent;
  return (
    <svg width={300} height={210} viewBox="0 0 300 210">
      {kind === 'laptop' ? (
        <>
          <rect
            x={40}
            y={30}
            width={220}
            height={130}
            rx={10}
            fill={colors.surface}
            stroke={stroke}
            strokeWidth={2.5}
          />
          <rect x={56} y={46} width={100} height={7} rx={3.5} fill={stroke} opacity={0.85} />
          <rect x={56} y={62} width={150} height={7} rx={3.5} fill={colors.textMuted} opacity={0.5} />
          <rect x={56} y={78} width={120} height={7} rx={3.5} fill={colors.textMuted} opacity={0.5} />
          <rect x={20} y={160} width={260} height={10} rx={5} fill={stroke} opacity={0.35} />
        </>
      ) : (
        <>
          <path
            d="M92 132a40 40 0 0 1 6-79 56 56 0 0 1 106 12 36 36 0 0 1 4 67z"
            fill={colors.surface}
            stroke={stroke}
            strokeWidth={2.5}
          />
          <path d="M150 92v34M136 112l14 16 14-16" stroke={stroke} strokeWidth={2.5} fill="none" />
        </>
      )}
      <text
        x={150}
        y={196}
        textAnchor="middle"
        fontFamily={font.mono}
        fontSize={13}
        fill={colors.textFaint}
        letterSpacing="0.16em"
      >
        {kind === 'laptop' ? 'LOCAL' : 'CLOUD'}
      </text>
    </svg>
  );
}
