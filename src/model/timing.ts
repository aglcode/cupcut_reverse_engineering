// How timeline time maps onto a segment's source media.
//
// CapCut drafts carry a `reverse` flag on the segment for this. No local draft
// has a reversed or frozen clip, so beyond that flag's name the behaviour here
// is this editor's own: a reversed clip plays its source range backwards, and
// a freeze frame holds the single source frame at source_timerange.start.
//
// A clip with a speed ramp covers its source at a changing rate; see
// speedCurve.ts for the curve itself.

import { averageSpeed, progressAt, scaleCurve, speedAt, timeAt } from './speedCurve'
import type { Segment } from './types'

// How much source (in microseconds) the segment has played `elapsed` after its
// start on the timeline.
export function playedAt(segment: Segment, elapsed: number): number {
  const src = segment.source_timerange
  const curve = segment.curve_speed
  if (!curve || !src) return elapsed * segment.speed
  return progressAt(curve.speed_points, elapsed / segment.target_timerange.duration) * src.duration
}

// Source position (unrounded, in microseconds) at timeline time `t`. Outside
// the segment's own range this keeps extrapolating, which transitions rely on.
export function sourceTimeAt(segment: Segment, t: number): number {
  const src = segment.source_timerange
  if (!src) return 0
  if (segment.freeze) return src.start
  const played = playedAt(segment, t - segment.target_timerange.start)
  return segment.reverse ? src.start + src.duration - played : src.start + played
}

// Inverse of sourceTimeAt. Not meaningful for a freeze frame, where every
// timeline time maps to the same source frame.
export function timelineTimeAt(segment: Segment, source: number): number {
  const src = segment.source_timerange
  if (!src) return segment.target_timerange.start
  const played = segment.reverse ? src.start + src.duration - source : source - src.start
  const { start, duration } = segment.target_timerange
  const curve = segment.curve_speed
  if (!curve) return start + played / segment.speed
  return start + timeAt(curve.speed_points, played / src.duration) * duration
}

// How fast the source is playing at timeline time `t`: the segment's speed, or
// the point it has reached on its ramp.
export function speedAtTime(segment: Segment, t: number): number {
  const curve = segment.curve_speed
  if (!curve) return segment.speed
  const { start, duration } = segment.target_timerange
  const points = curve.speed_points
  // The curve's own average can be a hair off the clip's, whose timeline
  // length is a whole number of frames.
  return (speedAt(points, (t - start) / duration) * segment.speed) / averageSpeed(points)
}

// Makes `speed` the true ratio of source to timeline length, and brings a
// ramp's speeds in line with it. Called after anything resizes a ramped clip.
export function fitSpeed(segment: Segment): Segment {
  const src = segment.source_timerange
  const curve = segment.curve_speed
  if (!curve || !src) return segment
  const speed = src.duration / segment.target_timerange.duration
  const factor = speed / averageSpeed(curve.speed_points)
  return {
    ...segment,
    speed,
    curve_speed:
      Math.abs(factor - 1) < 1e-12
        ? curve
        : { ...curve, speed_points: scaleCurve(curve.speed_points, factor) },
  }
}

// Whether things attached to the segment (keyframes) are positioned in source
// time. Text and freeze frames have no moving source, so they count from the
// start of the segment instead.
export const usesSourceTime = (segment: Segment): boolean =>
  segment.source_timerange !== null && !segment.freeze
