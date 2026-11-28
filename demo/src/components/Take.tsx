import { AbsoluteFill } from 'remotion';
import Backdrop from '../components/Backdrop';
import Caption from '../components/Caption';
import Footage from '../components/Footage';
import Chrome from '../components/Chrome';
import type { CaptureManifest } from '../capture-types';
import type { CursorEvent } from '../components/Cursor';
import rawCapture from '../capture.json';

const capture = rawCapture as CaptureManifest;

// A real take, framed on the stage. Every footage beat shares this so the cuts
// between them are invisible; only the caption and the trim differ.
export default function Take({
  take,
  lead,
  caption,
  captionDelay = 20,
  crop = 0,
  lift = 40,
  scale = 1,
}: {
  /** Take name from src/capture.json, e.g. "dispatch". */
  take: string;
  /** Seconds to skip: the page load before the interesting part starts. */
  lead: number;
  caption: string;
  captionDelay?: number;
  scale?: number;
  /** Sidebar pixels to crop, leaving the panel clear of the frame edge. */
  crop?: number;
  /** Pixels to raise the window so the caption does not cover the panel. */
  lift?: number;
}) {
  const entry = capture.takes[take];
  if (!entry) {
    return (
      <AbsoluteFill>
        <Backdrop />
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Caption text={`missing take: ${String(take)}`} />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  const events = (entry.events || []) as CursorEvent[];

  return (
    <AbsoluteFill>
      <Backdrop glowX="50%" glowY="42%" />
      <Footage
        src={entry.src}
        events={events}
        offsetMs={(entry.offsetMs ?? 0) + lead * 1000}
        trimBeforeSeconds={lead}
        scale={scale}
        crop={crop}
        lift={lift}
        clipSeconds={(entry.durationMs ?? 0) / 1000}
        chrome={<Chrome url={entry.url} />}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 54,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Caption text={caption} delay={captionDelay} />
      </div>
    </AbsoluteFill>
  );
}
