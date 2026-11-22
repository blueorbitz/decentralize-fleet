import { AbsoluteFill } from 'remotion';
import { colors, font } from '../theme';

// The stage ground. A dark field with one soft light behind the subject keeps a
// light product window reading as a product shot rather than a flat screenshot.
//
// It also sets the font for the whole scene: without an explicit family the
// renderer falls back to a serif, which is not what a product surface looks like.
export default function Backdrop({
  glowX = '50%',
  glowY = '42%',
}: {
  glowX?: string;
  glowY?: string;
}) {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: font.sans }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(ellipse 62% 58% at ${glowX} ${glowY}, ${colors.bgGlow} 0%, transparent 72%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.028) 1px, transparent 1px), ' +
            'linear-gradient(to bottom, rgba(255,255,255,0.028) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 70% 65% at 50% 45%, black 20%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 65% at 50% 45%, black 20%, transparent 78%)',
        }}
      />
    </AbsoluteFill>
  );
}
