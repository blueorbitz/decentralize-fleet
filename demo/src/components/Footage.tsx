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
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - Math.round(trimBeforeSeconds * fps);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
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
            width: 1600,
            height: 900,
            lineHeight: 0,
            overflow: 'hidden',
          }}
        >
          {localFrame >= 0 ? (
            <OffthreadVideo
              src={staticFile(src)}
              trimBefore={Math.round(trimBeforeSeconds * fps)}
              style={{ width: 1600, height: 900, display: 'block', objectFit: 'cover' }}
            />
          ) : null}
          {showCursor && localFrame >= 0 ? <Cursor events={events} offsetMs={offsetMs} /> : null}
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
}
