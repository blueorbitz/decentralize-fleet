import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Fade + rise. The default is short on purpose: beats should already be moving on
// their first visible frame, not waiting to arrive.
export function useAppear(delay = 0, duration = 16, distance = 18) {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, duration], [0, 1], clamp);
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * distance}px)`,
  };
}

export function useSpringIn(delay = 0, damping = 200, mass = 1) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping, mass } });
  return {
    opacity: interpolate(s, [0, 0.4], [0, 1], clamp),
    transform: `scale(${0.94 + 0.06 * s})`,
  };
}

// A number that rolls up to `to`, for counters and lease timers.
export function useRoll(to: number, delay = 0, duration = 30, from = 0) {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, duration], [0, 1], clamp);
  return from + (to - from) * (1 - Math.pow(1 - t, 2));
}

// Line-by-line reveal for logs and code. Returns how many lines are visible.
export function useLineCount(total: number, startAt = 0, perLine = 8) {
  const frame = useCurrentFrame();
  if (frame < startAt) return 0;
  return Math.min(total, Math.floor((frame - startAt) / perLine) + 1);
}
