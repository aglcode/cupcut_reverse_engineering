// Transitions between two clips on the same video track.
//
// Stored the way CapCut drafts store them: on the *outgoing* clip (there, a
// materials.transitions entry with { name, duration, is_overlap } that the
// first clip references), while the two clips stay butted together on the
// timeline. The overlap is created at render time. Where CapCut places the
// transition window is not observable from a draft; here it is centred on the
// cut, each clip running half the duration past its edge.
//
// CapCut's transition looks are shader bundles and cannot be reused; the ones
// here are original. "Mix" is named after CapCut's cross-dissolve.

import { frameDuration } from './time'
import {
  segmentEnd,
  type Draft,
  type Segment,
  type Track,
  type Transition,
  type TransitionName,
} from './types'

export const TRANSITIONS: { name: TransitionName; label: string }[] = [
  { name: 'Mix', label: 'Mix (cross-dissolve)' },
  { name: 'Fade', label: 'Fade through black' },
  { name: 'Wipe', label: 'Wipe' },
  { name: 'Slide', label: 'Slide' },
]

export const DEFAULT_TRANSITION_DURATION = 500_000

export const nextSegment = (track: Track, index: number): Segment | null => {
  const segment = track.segments[index]
  const next = track.segments[index + 1]
  // A transition needs the next clip to start exactly where this one ends.
  return next && next.target_timerange.start === segmentEnd(segment) ? next : null
}

export type ActiveTransition = {
  name: TransitionName
  from: number // timeline time the transition starts
  to: number
  cut: number
}

// The transition out of track.segments[index] as it will actually render, or
// null. Its duration is cut down so it never covers more than half of either
// clip, which keeps one clip from being in two transitions at once.
export function effectiveTransition(track: Track, index: number): ActiveTransition | null {
  if (track.type !== 'video') return null
  const segment = track.segments[index]
  const next = segment?.transition ? nextSegment(track, index) : null
  if (!segment?.transition || !next) return null
  const duration = Math.min(
    segment.transition.duration,
    segment.target_timerange.duration,
    next.target_timerange.duration,
  )
  if (duration <= 0) return null
  const cut = segmentEnd(segment)
  return { name: segment.transition.name, from: cut - duration / 2, to: cut + duration / 2, cut }
}

// The stretch of timeline over which a clip is on screen: its own range, plus
// half a transition on either side where it has one.
export function visibleSpan(track: Track, index: number): { from: number; to: number } {
  const segment = track.segments[index]
  const incoming = index > 0 ? effectiveTransition(track, index - 1) : null
  const outgoing = effectiveTransition(track, index)
  return {
    from: incoming ? incoming.from : segment.target_timerange.start,
    to: outgoing ? outgoing.to : segmentEnd(segment),
  }
}

// How a clip is drawn while a transition is running.
export type LayerFx = {
  alpha: number
  // Fraction of the canvas width the clip is revealed over, from the left.
  reveal: number | null
  // Horizontal shift, as a fraction of the canvas width.
  offsetX: number
}

const PLAIN: LayerFx = { alpha: 1, reveal: null, offsetX: 0 }

// Look of the outgoing or incoming clip at `progress` (0 at the start of the
// transition, 1 at the end). The outgoing clip is always drawn first.
export function transitionFx(name: TransitionName, role: 'out' | 'in', progress: number): LayerFx {
  const p = Math.min(1, Math.max(0, progress))
  switch (name) {
    case 'Mix':
      return role === 'out' ? PLAIN : { ...PLAIN, alpha: p }
    case 'Fade':
      return { ...PLAIN, alpha: role === 'out' ? Math.max(0, 1 - 2 * p) : Math.max(0, 2 * p - 1) }
    case 'Wipe':
      return role === 'out' ? PLAIN : { ...PLAIN, reveal: p }
    case 'Slide':
      return role === 'out' ? PLAIN : { ...PLAIN, offsetX: 1 - p }
  }
}

// Sets or clears the transition from a clip to the one after it.
export function setTransition(
  draft: Draft,
  segmentId: string,
  transition: Transition | null,
): Draft {
  const next = transition && {
    name: transition.name,
    duration: Math.round(Math.max(frameDuration(draft.fps), transition.duration)),
  }
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) => (s.id === segmentId ? { ...s, transition: next } : s)),
    })),
  }
}
