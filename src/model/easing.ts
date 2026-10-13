// Easing between two keyframes.
//
// CapCut drafts store an eased interval as bezier handles: right_control on
// the keyframe it leaves and left_control on the one it arrives at, each an
// offset {x: time, y: value} from its keyframe, in the keyframe's own units.
// Its "Ease In" preset is, in every local example, a right handle of exactly
// 0.42 of the interval with y 0, which is the standard cubic-bezier(0.42, 0, 1, 1).
//
// "Ease out" and "Ease in-out" have no local example; they are built here by
// mirroring that handle, with left_control pointing back in time (negative x).

import type { Keyframe, Point } from './types'

export const NO_HANDLE: Point = { x: 0, y: 0 }

// CapCut's handle length for "Ease In", as a fraction of the interval.
export const EASE_HANDLE = 0.42

export type EasingName = 'Linear' | 'Ease in' | 'Ease out' | 'Ease in-out'
export const EASINGS: EasingName[] = ['Linear', 'Ease in', 'Ease out', 'Ease in-out']

const hasHandle = (p: Point): boolean => p.x !== 0 || p.y !== 0

// Value between keyframes `a` and `b` at `key`, a time between theirs.
export function interpolate(a: Keyframe, b: Keyframe, key: number): number {
  const span = b.time_offset - a.time_offset
  const from = a.values[0]
  const to = b.values[0]
  if (span <= 0) return to
  const f = Math.min(1, Math.max(0, (key - a.time_offset) / span))
  if (!hasHandle(a.right_control) && !hasHandle(b.left_control)) return from + (to - from) * f

  // Cubic bezier through (0, from) and (1, to) with the two handles as its
  // inner control points. Handles that reach outside the interval are pulled
  // back in, which keeps time moving forwards along the curve.
  const x1 = Math.min(1, Math.max(0, a.right_control.x / span))
  const x2 = Math.min(1, Math.max(0, 1 + b.left_control.x / span))
  const y1 = from + a.right_control.y
  const y2 = to + b.left_control.y
  const bezier = (s: number, p0: number, p1: number, p2: number, p3: number) => {
    const r = 1 - s
    return r * r * r * p0 + 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s * p3
  }
  // Find the curve parameter whose time is f. x(s) never decreases, so
  // halving the range converges.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (bezier(mid, 0, x1, x2, 1) < f) lo = mid
    else hi = mid
  }
  return bezier((lo + hi) / 2, from, y1, y2, to)
}

// The preset an interval is using, or null for handles that match none.
export function easingOf(a: Keyframe, b: Keyframe): EasingName | null {
  const span = b.time_offset - a.time_offset
  const near = (value: number, target: number) => Math.abs(value - target) <= Math.abs(span) * 0.01 + 1
  const out = a.right_control
  const into = b.left_control
  if (out.y !== 0 || into.y !== 0) return null
  const easeIn = near(out.x, EASE_HANDLE * span)
  const easeOut = near(into.x, -EASE_HANDLE * span)
  if (near(out.x, 0) && near(into.x, 0)) return 'Linear'
  if (easeIn && near(into.x, 0)) return 'Ease in'
  if (near(out.x, 0) && easeOut) return 'Ease out'
  if (easeIn && easeOut) return 'Ease in-out'
  return null
}

// Handles for an interval of `span` using a preset: [right of the first
// keyframe, left of the second].
export function handlesFor(name: EasingName, span: number): [Point, Point] {
  const reach = Math.round(EASE_HANDLE * span)
  const slowStart = name === 'Ease in' || name === 'Ease in-out'
  const slowEnd = name === 'Ease out' || name === 'Ease in-out'
  return [slowStart ? { x: reach, y: 0 } : NO_HANDLE, slowEnd ? { x: -reach, y: 0 } : NO_HANDLE]
}

// Handles stretched to a new interval length, so the curve keeps its shape
// when a keyframe is moved.
export const scaleHandle = (p: Point, oldSpan: number, newSpan: number): Point =>
  oldSpan > 0 && p.x !== 0 ? { x: Math.round((p.x * newSpan) / oldSpan), y: p.y } : p
