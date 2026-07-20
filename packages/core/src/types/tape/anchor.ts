/**
 * Narrow reference returned by `Tape.loadAnchor` — enough for callers
 * (compaction, state restoration) to recover the anchor without paying
 * for the full `TapeEntry` projection.
 */
export interface TapeAnchorRef {
  name: string;
  state: Record<string, unknown>;
  ts: number;
}