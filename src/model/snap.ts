// Snapping: while a clip is dragged or trimmed, an edge that comes close to
// something worth lining up with jumps onto it.
//
// CapCut calls this auto adsorb (auto_adsorb, adsorb_model in its engine) and
// its drafts show the result, with video cuts sitting exactly on beat markers.
// What it snaps to and how close "close" is are not recorded anywhere; the
// targets here are the playhead, every marker, and the edges of other clips.

import { placedMarkers } from './markers'
import { segmentEnd, type Draft } from './types'

// Timeline times worth snapping to, leaving out everything belonging to the
// clips being moved (they would only snap to themselves).
export function snapTargets(draft: Draft, playhead: number, movingIds: string[]): number[] {
  const moving = new Set(movingIds)
  const times = new Set<number>([0, playhead])
  for (const track of draft.tracks) {
    for (const s of track.segments) {
      if (moving.has(s.id)) continue
      times.add(s.target_timerange.start)
      times.add(segmentEnd(s))
    }
  }
  for (const m of placedMarkers(draft)) {
    if (m.segmentId === null || !moving.has(m.segmentId)) times.add(m.time)
  }
  return [...times]
}

export type Snap = { time: number; target: number }

// `t` moved onto the nearest target within `reach`, or null if none is.
export function snapTime(t: number, targets: number[], reach: number): Snap | null {
  let best: number | null = null
  for (const target of targets) {
    if (Math.abs(target - t) <= reach && (best === null || Math.abs(target - t) < Math.abs(best - t))) {
      best = target
    }
  }
  return best === null ? null : { time: best, target: best }
}

// A clip of `duration` wanting to start at `start`: either end may snap, and
// whichever is nearer its target wins. Returns the new start.
export function snapMove(
  start: number,
  duration: number,
  targets: number[],
  reach: number,
): Snap | null {
  const head = snapTime(start, targets, reach)
  const tail = snapTime(start + duration, targets, reach)
  const headGap = head ? Math.abs(head.time - start) : Infinity
  const tailGap = tail ? Math.abs(tail.time - (start + duration)) : Infinity
  if (!head && !tail) return null
  return headGap <= tailGap
    ? { time: head!.time, target: head!.target }
    : { time: tail!.time - duration, target: tail!.target }
}
