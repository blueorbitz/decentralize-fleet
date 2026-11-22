import type { ComponentType } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { font } from '../theme';
import S01Hook from '../scenes/S01Hook';
import S02Problem from '../scenes/S02Problem';
import S03Gap from '../scenes/S03Gap';
import S04Solution from '../scenes/S04Solution';
import S05Dispatch from '../scenes/S05Dispatch';
import S06Race from '../scenes/S06Race';
import S07LivePanel from '../scenes/S07LivePanel';
import S08Review from '../scenes/S08Review';
import S09Settings from '../scenes/S09Settings';
import S10Topology from '../scenes/S10Topology';
import S11ClaimCas from '../scenes/S11ClaimCas';
import S12Agents from '../scenes/S12Agents';
import S13Closing from '../scenes/S13Closing';

export type Beat = {
  id: string;
  component: ComponentType;
  /** Frames this beat occupies, from beats.json x fps. */
  frames: number;
  /** Frames of fade-in/out at the cut. */
  fade?: number;
};

// A scene, plus the fade that hides the cut. Every scene fades itself in and out
// on the same curve, so a cut always reads as a transition and never as a jump.
export function Scene({ beat }: { beat: Beat }) {
  const frame = useCurrentFrame();
  const fade = beat.fade ?? 10;
  const opacity = interpolate(
    frame,
    [0, fade, beat.frames - fade, beat.frames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const Component = beat.component;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity, fontFamily: font.sans }}>
      <Component />
    </div>
  );
}

export const SCENES = {
  S01: S01Hook,
  S02: S02Problem,
  S03: S03Gap,
  S04: S04Solution,
  S05: S05Dispatch,
  S06: S06Race,
  S07: S07LivePanel,
  S08: S08Review,
  S09: S09Settings,
  S10: S10Topology,
  S11: S11ClaimCas,
  S12: S12Agents,
  S13: S13Closing,
} as const;
