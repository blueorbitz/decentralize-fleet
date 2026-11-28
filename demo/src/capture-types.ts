// Shape of the generated capture manifest (src/capture.json).
//
// capture.json is written by scripts/capture-lib.mjs and git-ignored content
// mixed with committed shape, so it is typed here rather than inferred from the
// JSON literal — an empty `{}` would otherwise narrow to `never`.

export type CapturedTake = {
  /** Path under public/, e.g. "footage/dispatch.webm". */
  src: string;
  events: { at: number; kind: string; x?: number; y?: number }[];
  durationMs: number;
  url?: string;
  /** Milliseconds to shift the cursor path against the clip. */
  offsetMs?: number;
  /** Seconds of spinner/loading to skip at the head of the clip. */
  trimBeforeSeconds?: number;
};

export type CaptureManifest = {
  /** Every recorded take, keyed by a camelCase name. */
  takes: Record<string, CapturedTake>;
  /** URL of the pull request the last run opened, for the PR take. */
  prUrl?: string;
  offsetMs: Record<string, number>;
  trim: Record<string, number>;
};
