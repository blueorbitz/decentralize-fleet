import { Composition } from 'remotion';
import beats from '../beats.json';
import FleetDemo, { BEATS, TOTAL_FRAMES } from './compositions/FleetDemo';

const { fps, width, height } = beats;

// FleetDemo is the shipped video. Every beat is also registered on its own so a
// scene can be reviewed and re-rendered without scrubbing the full timeline.
export const RemotionRoot: React.FC = () => {
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
