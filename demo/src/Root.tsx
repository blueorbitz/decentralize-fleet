import { Composition } from 'remotion';
import beats from '../beats.json';
import rawCapture from './capture.json';
import type { CaptureManifest } from './capture-types';
import FleetDemo, { BEATS, TOTAL_FRAMES } from './compositions/FleetDemo';
import FootageProof from './scenes/XFootageProof';

const { fps, width, height } = beats;
const capture = rawCapture as CaptureManifest;

// FleetDemo is the shipped video. Every beat is also registered on its own so a
// scene can be reviewed and re-rendered without scrubbing the full timeline.
export const RemotionRoot: React.FC = () => {
  const dry = capture.takes?.dryBoard;
  const proofFrames = Math.max(30, Math.round(((dry?.durationMs ?? 3000) / 1000) * fps));

  return (
    <>
      <Composition
        id="FleetDemo"
        component={FleetDemo}
        durationInFrames={TOTAL_FRAMES}
        fps={fps}
        width={width}
        height={height}
      />

      {/* Proof that a captured take plays and the synthetic cursor lines up. */}
      <Composition
        id="XFootageProof"
        component={FootageProof}
        durationInFrames={proofFrames}
        fps={fps}
        width={width}
        height={height}
      />

      {BEATS.map((beat) => (
        <Composition
          key={beat.id}
          id={`Scene-${beat.id}`}
          component={beat.component}
          durationInFrames={beat.frames}
          fps={fps}
          width={width}
          height={height}
        />
      ))}
    </>
  );
};
