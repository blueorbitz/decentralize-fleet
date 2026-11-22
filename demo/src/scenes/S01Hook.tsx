import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Backdrop from '../components/Backdrop';
import { BigCaption } from '../components/Caption';
import { colors, font } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Two ways to run an agent, cut against each other, then the question.
export default function S01Hook() {
  const frame = useCurrentFrame();

  // 0-90 laptop, 90-180 cloud, 180+ the question
  const laptop = interpolate(frame, [0, 12, 84, 96], [0, 1, 1, 0], clamp);
  const cloud = interpolate(frame, [96, 108, 174, 186], [0, 1, 1, 0], clamp);
  const question = interpolate(frame, [186, 210], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="46%" />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', opacity: laptop }}>
          <DeviceMark kind="laptop" />
        </div>
        <div style={{ position: 'absolute', opacity: cloud }}>
          <DeviceMark kind="cloud" />
        </div>

        <div style={{ position: 'absolute', top: '62%', width: '100%' }}>
          {frame < 96 ? (
            <BigCaption text="On your laptop" sub="One engineer, one machine" delay={14} size={64} />
          ) : frame < 186 ? (
            <BigCaption text="In someone's cloud" sub="Fresh container, every time" delay={100} size={64} />
          ) : (
            <div style={{ opacity: question }}>
              <BigCaption
                text="What if it ran on all of them?"
                sub="Your machines. Your setup. Coordinated."
                delay={190}
                size={70}
              />
            </div>
          )}
        </div>
      </AbsoluteFill>
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
