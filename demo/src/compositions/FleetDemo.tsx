import { AbsoluteFill, Sequence } from 'remotion';
import beats from '../../beats.json';
import { SCENES, Scene, type Beat } from './Scene';
import { withFont } from './withFont';

// The whole video, laid end to end. Beat lengths come from beats.json so the
// edit and the narration sheet cannot drift apart.
const FPS = beats.fps;

export const BEATS: Beat[] = beats.beats.map((b) => ({
  id: b.id,
  component: withFont(SCENES[b.id as keyof typeof SCENES]),
  frames: Math.round(b.seconds * FPS),
}));

export const TOTAL_FRAMES = BEATS.reduce((sum, b) => sum + b.frames, 0);

export default function FleetDemo() {
  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: '#080D17' }}>
      {BEATS.map((beat) => {
        const start = from;
        from += beat.frames;
        return (
          <Sequence key={beat.id} from={start} durationInFrames={beat.frames} name={beat.id}>
            <Scene beat={beat} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
