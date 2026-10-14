// Speed ramps: playback speed that changes along a clip.
//
// CapCut keeps a ramp as `curve_speed.speed_points` on the clip's speed
// material: points with x from 0 to 1 and y a speed. Checked against the 62
// ramped clips in the local drafts, x is a fraction of the clip's SOURCE range,
// and between two points the speed changes steadily over time, so a stretch of
// source takes its length divided by the mean of its two end speeds. That
// reading gives every one of those clips' timeline lengths to within a frame.
// The clip's stored `speed` is then the average: source length over timeline
// length.
//
// Fractions here are in playing order, so for a reversed clip 0 is the end of
// its source range. No local draft has a reversed ramp, so that is assumed.

import type { SpeedCurve, SpeedPoint } from './types'

// The range CapCut's own curves stay inside.
export const MIN_CURVE_SPEED = 0.1
export const MAX_CURVE_SPEED = 10

// Hero and Bullet are CapCut's presets as found, untouched, in local drafts.
// CapCut also has Montage, Jump Cut, Flash In and Flash Out (its interface
// text and engine name them), but no local draft uses them and their curves
// are downloaded only when used, so they are not offered here.
export const SPEED_PRESETS: SpeedCurve[] = [
  {
    name: 'Hero',
    speed_points: [
      { x: 0, y: 1 },
      { x: 0.35, y: 5.5 },
      { x: 0.45, y: 0.5 },
      { x: 0.55, y: 0.5 },
      { x: 0.65, y: 5.5 },
      { x: 1, y: 1 },
    ],
  },
  {
    name: 'Bullet',
    speed_points: [
      { x: 0, y: 5.2 },
      { x: 0.4, y: 5.2 },
      { x: 0.46, y: 0.5 },
      { x: 0.54, y: 0.5 },
      { x: 0.6, y: 5.2 },
      { x: 1, y: 5.2 },
    ],
  },
]

type Stretch = { x0: number; x1: number; y0: number; y1: number; time: number }

// The curve as stretches between neighbouring points, each with the time it
// takes when the whole source is one unit long. Points that share an x make a
// jump in speed and take no time.
function stretches(points: SpeedPoint[]): Stretch[] {
  const out: Stretch[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (b.x <= a.x) continue
    out.push({ x0: a.x, x1: b.x, y0: a.y, y1: b.y, time: (b.x - a.x) / ((a.y + b.y) / 2) })
  }
  return out
}

const totalTime = (parts: Stretch[]): number => parts.reduce((sum, s) => sum + s.time, 0)

// Source length over timeline length for a clip that follows the curve.
export function averageSpeed(points: SpeedPoint[]): number {
  const total = totalTime(stretches(points))
  return total > 0 ? 1 / total : 1
}

// How much of the source has played (0 to 1) once `u` of the clip's timeline
// length has gone by. Outside 0 to 1 it carries on at the speed of that end.
export function progressAt(points: SpeedPoint[], u: number): number {
  const parts = stretches(points)
  if (parts.length === 0) return u
  let time = u * totalTime(parts)
  if (time <= 0) return parts[0].y0 * time
  for (const s of parts) {
    if (time <= s.time) return s.x0 + s.y0 * time + ((s.y1 - s.y0) / s.time) * time * time * 0.5
    time -= s.time
  }
  return 1 + parts[parts.length - 1].y1 * time
}

// Inverse of progressAt: the fraction of the clip's timeline length at which
// `p` of the source has played.
export function timeAt(points: SpeedPoint[], p: number): number {
  const parts = stretches(points)
  if (parts.length === 0) return p
  const total = totalTime(parts)
  if (p <= 0) return p / parts[0].y0 / total
  let elapsed = 0
  for (const s of parts) {
    if (p <= s.x1) {
      const distance = p - s.x0
      const gain = (s.y1 - s.y0) / s.time
      const speedThere = Math.sqrt(Math.max(0, s.y0 * s.y0 + 2 * gain * distance))
      return (elapsed + (2 * distance) / (s.y0 + speedThere)) / total
    }
    elapsed += s.time
  }
  return (total + (p - 1) / parts[parts.length - 1].y1) / total
}

// The curve's speed at `u` of the clip's timeline length.
export function speedAt(points: SpeedPoint[], u: number): number {
  const parts = stretches(points)
  if (parts.length === 0) return 1
  let time = Math.min(1, Math.max(0, u)) * totalTime(parts)
  for (const s of parts) {
    if (time <= s.time) return s.y0 + ((s.y1 - s.y0) * time) / s.time
    time -= s.time
  }
  return parts[parts.length - 1].y1
}

// The curve's speed where `p` of the source has played. Speed changes
// steadily over time, so its square changes steadily over distance: between
// two points the true curve bows a little above the straight line.
export function speedAtProgress(points: SpeedPoint[], p: number): number {
  const parts = stretches(points)
  if (parts.length === 0) return 1
  if (p <= parts[0].x0) return parts[0].y0
  for (const s of parts) {
    if (p <= s.x1) {
      const along = (p - s.x0) / (s.x1 - s.x0)
      return Math.sqrt(s.y0 * s.y0 + (s.y1 * s.y1 - s.y0 * s.y0) * along)
    }
  }
  return parts[parts.length - 1].y1
}

// The curve for the part of the source between two fractions, as left by a
// trim or a split: the kept part plays exactly as it did. Fractions outside
// 0 to 1 lengthen the clip, and the added part plays at the speed of that end.
export function sliceCurve(points: SpeedPoint[], from: number, to: number): SpeedPoint[] {
  const parts = stretches(points)
  if (parts.length === 0 || to <= from) return points
  const kept = [
    { x: from, y: speedAtProgress(points, from) },
    ...points.filter((p) => p.x > from && p.x < to),
    { x: to, y: speedAtProgress(points, to) },
  ].map((p) => ({ x: (p.x - from) / (to - from), y: p.y }))
  // A point in the middle of a flat run adds nothing.
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9
  return kept.filter(
    (p, i) => i === 0 || i === kept.length - 1 || !(same(kept[i - 1].y, p.y) && same(p.y, kept[i + 1].y)),
  )
}

// The same shape, faster or slower throughout.
export const scaleCurve = (points: SpeedPoint[], factor: number): SpeedPoint[] =>
  points.map((p) => ({ x: p.x, y: p.y * factor }))

// Points as a curve can use them: in order, from 0 to 1, speeds in range.
// Null if there are not two usable points.
export function cleanPoints(points: SpeedPoint[]): SpeedPoint[] | null {
  const usable = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > 0)
    .map((p) => ({
      x: Math.min(1, Math.max(0, p.x)),
      y: Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, p.y)),
    }))
    .sort((a, b) => a.x - b.x)
  if (usable.length < 2) return null
  usable[0].x = 0
  usable[usable.length - 1].x = 1
  return usable
}

// Whether every point has the same speed, which is no ramp at all.
export const isFlat = (points: SpeedPoint[]): boolean =>
  points.every((p) => Math.abs(p.y - points[0].y) < 1e-9)
