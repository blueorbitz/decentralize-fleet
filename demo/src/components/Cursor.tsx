import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export type CursorEvent = {
  /** Milliseconds from the start of the recording. */
  at: number;
  kind: 'hover' | 'click' | 'scroll' | 'navigate' | 'state' | 'warn';
  x?: number;
  y?: number;
  label?: string;
  dy?: number;
};

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/**
 * A pointer drawn over real footage.
 *
 * Playwright's recorder does not draw a cursor, so the capture scripts log the
 * coordinates of every hover and click. This walks those points on the same
 * timeline as the video, which puts the pointer exactly where the click landed.
 *
 * `offsetMs` shifts the whole path if a take's video starts before the events do.
 */
export default function Cursor({
  events,
  offsetMs = 0,
  scale = 1,
  tint = '#111827',
  clampMs,
}: {
  events: CursorEvent[];
  offsetMs?: number;
  scale?: number;
  tint?: string;
  /** Hold the pointer at this timestamp, so it freezes with a held frame. */
  clampMs?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rawMs = (frame / fps) * 1000 - offsetMs;
  const nowMs = clampMs === undefined ? rawMs : Math.min(rawMs, clampMs - offsetMs);

  const points = events.filter((e) => (e.kind === 'hover' || e.kind === 'click') && e.x != null);
  if (points.length === 0) return null;

  // Find the segment we are inside; before the first point the cursor is parked there.
  const times = points.map((p) => p.at);
  const prevIndex = Math.max(0, times.filter((t) => t <= nowMs).length - 1);
  const from = points[prevIndex];
  const to = points[Math.min(prevIndex + 1, points.length - 1)];

  // Move with an ease over the gap between the two points, so the pointer glides
  // to where the next click happens instead of teleporting. One point (or two
  // that share a timestamp) has no gap to interpolate across: hold still.
  const t =
    to.at > from.at
      ? interpolate(nowMs, [from.at, to.at], [0, 1], clamp)
      : nowMs >= from.at
        ? 1
        : 0;
  const eased = t * t * (3 - 2 * t);
  const x = from.x! + (to.x! - from.x!) * eased;
  const y = from.y! + (to.y! - from.y!) * eased;

  // A click ripple lasts 380ms from the click event.
  const click = events
    .filter((e) => e.kind === 'click' && e.x != null)
    .find((e) => nowMs >= e.at && nowMs <= e.at + 380);
  const rippleT = click ? (nowMs - click.at) / 380 : 0;
  const ripple = click ? interpolate(rippleT, [0, 1], [1, 2.6], clamp) : 0;
  const rippleOpacity = click ? interpolate(rippleT, [0, 0.2, 1], [0, 0.55, 0], clamp) : 0;

  return (
    <svg
      width={24 * scale}
      height={32 * scale}
      viewBox="0 0 24 32"
      style={{
        position: 'absolute',
        left: x - 2 * scale,
        top: y - 2 * scale,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <g
        transform={`translate(${click ? (ripple - 1) * 6 : 0} ${click ? (ripple - 1) * 5 : 0})`}
        style={{ transformOrigin: '2px 2px' }}
      >
        <path
          d="M2 2 L2 24 L8.2 18.4 L12.2 27.5 L16 25.8 L12 16.9 L20 16.6 Z"
          fill={tint}
          stroke="#FFFFFF"
          strokeWidth={1.4}
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.45))' }}
        />
      </g>
      {click ? (
        <circle
          cx={2}
          cy={2}
          r={8 * ripple}
          fill="none"
          stroke="#4C9AFF"
          strokeWidth={2.5}
          opacity={rippleOpacity}
        />
      ) : null}
    </svg>
  );
}
