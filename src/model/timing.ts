// How timeline time maps onto a segment's source media.
//
// CapCut drafts carry a `reverse` flag on the segment for this. No local draft
// has a reversed or frozen clip, so beyond that flag's name the behaviour here
// is this editor's own: a reversed clip plays its source range backwards, and
// a freeze frame holds the single source frame at source_timerange.start.

import type { Segment } from './types'

// Source position (unrounded, in microseconds) at timeline time `t`. Outside
// the segment's own range this keeps extrapolating, which transitions rely on.
export function sourceTimeAt(segment: Segment, t: number): number {
  const src = segment.source_timerange
  if (!src) return 0
  if (segment.freeze) return src.start
  const played = (t - segment.target_timerange.start) * segment.speed
  return segment.reverse ? src.start + src.duration - played : src.start + played
}

// Inverse of sourceTimeAt. Not meaningful for a freeze frame, where every
// timeline time maps to the same source frame.
export function timelineTimeAt(segment: Segment, source: number): number {
  const src = segment.source_timerange
  if (!src) return segment.target_timerange.start
  const played = segment.reverse ? src.start + src.duration - source : source - src.start
  return segment.target_timerange.start + played / segment.speed
}

// Whether things attached to the segment (keyframes) are positioned in source
// time. Text and freeze frames have no moving source, so they count from the
// start of the segment instead.
export const usesSourceTime = (segment: Segment): boolean =>
  segment.source_timerange !== null && !segment.freeze
