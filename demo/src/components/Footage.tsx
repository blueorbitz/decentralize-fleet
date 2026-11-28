import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import Cursor, { type CursorEvent } from './Cursor';

/**
 * A real take, framed on the stage.
 *
 * The recording is 1600x900 against a 1920x1080 canvas, so it is placed at its
 * natural size inside a window frame and floated on the backdrop — the same
 * treatment the faux scenes use, so real and animated beats cut together.
 */
export default function Footage({
  src,
  events = [],
  offsetMs = 0,
  trimBeforeSeconds = 0,
  showCursor = true,
  scale = 1,
  chrome,
  style,
  children,
  crop = 0,
  lift = 0,
}: {
  src: string;
  events?: CursorEvent[];
  offsetMs?: number;
  trimBeforeSeconds?: number;
  showCursor?: boolean;
  scale?: number;
  chrome?: ReactNode;
  style?: CSSProperties;
  children?: ReactNode;
  /**
   * Pixels of Jira's left sidebar to crop away.
   *
   * The captures include Jira's whole chrome, and its account menu shows the
   * signed-in email address. Cropping is done by shifting the video *and* the
   * cursor layer together, so click coordinates stay correct.
   */
  crop?: number;
  /**
   * Pixels to raise the window, so a caption underneath does not cover the part
   * of the page the beat is about.
   */
  lift?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  void frame;
  void fps;
  const width = 1600 - crop;

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: lift * 2 }}>
      <div
        style={{
          position: 'relative',
          transform: `scale(${scale})`,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 40px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(147,163,188,0.22)',
          ...style,
        }}
      >
        {chrome}
        <div
          style={{
            position: 'relative',
            width,
            height: 900,
            lineHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Video and cursor share one shifted layer so a click still lands on
              the control it hit. OffthreadVideo seeks via trimBefore itself;
              gating it on a frame offset would blank the video in the middle of
              a scene. */}
          <div style={{ position: 'absolute', left: -crop, top: 0, width: 1600, height: 900 }}>
            <OffthreadVideo
              src={staticFile(src)}
              trimBefore={Math.round(trimBeforeSeconds * fps)}
              style={{ width: 1600, height: 900, display: 'block', objectFit: 'cover' }}
            />
            {showCursor ? <Cursor events={events} offsetMs={offsetMs} /> : null}
            {children}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
