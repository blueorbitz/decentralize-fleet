import { Audio } from '@remotion/media';
import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import beats from '../../beats.json';
import { SCENES, Scene, type Beat } from './Scene';
import { withFont } from './withFont';

// The whole video, laid end to end. Beat lengths come from beats.json, which is
// regenerated from the voiceover durations by scripts/timings.mjs — so the cut
// follows the narration rather than the narration being squeezed into a
// pre-determined edit.
const FPS = beats.fps;

type BeatSpec = {
  id: string;
  seconds: number;
  voiceover?: string;
};

export const BEATS: Beat[] = beats.beats.map((b) => ({
  id: b.id,
  component: withFont(SCENES[b.id as keyof typeof SCENES]),
  frames: Math.round(b.seconds * FPS),
}));

export const TOTAL_FRAMES = BEATS.reduce((sum, b) => sum + b.frames, 0);

export default function FleetDemo() {
  let from = 0;
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: '#080D17' }}>
        {BEATS.map((beat, i) => {
          const start = from;
          from += beat.frames;
          const spec = beats.beats[i] as BeatSpec;
          return (
            <Sequence key={beat.id} from={start} durationInFrames={beat.frames} name={beat.id}>
              <Scene beat={beat} />
              {spec.voiceover ? <Audio src={staticFile(spec.voiceover)} /> : null}
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </>
  );
}
