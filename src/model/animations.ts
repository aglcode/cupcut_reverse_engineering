// In and out animations: how a clip or a title arrives and leaves.
//
// CapCut keeps them in a materials.material_animations entry the clip
// references, as a list:
//   {"type":"in","name":"Fade In","duration":500000,"start":0,…}
// with type "in", "out", "loop" or "group" (a combo). `start` is 0 even for an
// out animation, so an out animation is placed by the end of the clip, not by
// that field. The same type, name and duration are kept here, on the segment.
//
// The looks themselves are CapCut's own effect bundles. Only "Fade In" and
// "Fade Out" have an equivalent here; the slides and zooms are this editor's
// own, as is the easing of all of them.

import { segmentEnd, type Clip, type ClipAnimation, type Draft, type Segment } from './types'

const SHARED = ['Slide Left', 'Slide Right', 'Slide Up', 'Slide Down', 'Zoom In', 'Zoom Out']
export const ANIMATIONS: Record<ClipAnimation['type'], string[]> = {
  in: ['Fade In', ...SHARED],
  out: ['Fade Out', ...SHARED],
}

export const DEFAULT_ANIMATION_DURATION = 500_000

// How far a slide travels, in the half-canvas units positions use: one whole
// canvas width or height.
const SLIDE_DISTANCE = 2
// How much smaller or larger a zoom starts or ends.
const ZOOM_AMOUNT = 0.5

const find = (segment: Segment, type: ClipAnimation['type']): ClipAnimation | null =>
  segment.animations.find((a) => a.type === type) ?? null

// The animations actually played: stored lengths cut down to fit the segment,
// the in animation first.
export function effectiveAnimations(segment: Segment): {
  in: ClipAnimation | null
  out: ClipAnimation | null
} {
  const { duration } = segment.target_timerange
  const a = find(segment, 'in')
  const b = find(segment, 'out')
  const inLength = a ? Math.min(Math.max(0, a.duration), duration) : 0
  const outLength = b ? Math.min(Math.max(0, b.duration), duration - inLength) : 0
  return {
    in: a && inLength > 0 ? { ...a, duration: inLength } : null,
    out: b && outLength > 0 ? { ...b, duration: outLength } : null,
  }
}

// The in animation first.
export const inOrder = (list: ClipAnimation[]): ClipAnimation[] =>
  [...list].sort((a, b) => Number(a.type === 'out') - Number(b.type === 'out'))

// Sets or, with null, removes one of a clip's animations. The one being set
// may use the whole clip; the other gives way if they no longer both fit.
export function setAnimation(
  draft: Draft,
  segmentId: string,
  type: ClipAnimation['type'],
  animation: { name: string; duration: number } | null,
): Draft {
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) => {
        if (s.id !== segmentId || !s.clip) return s
        const other = s.animations.filter((a) => a.type !== type)
        if (!animation || !ANIMATIONS[type].includes(animation.name)) {
          return { ...s, animations: other }
        }
        const length = s.target_timerange.duration
        const duration = Math.round(Math.min(Math.max(0, animation.duration), length))
        if (duration === 0) return { ...s, animations: other }
        const fitted = other.map((a) => ({ ...a, duration: Math.min(a.duration, length - duration) }))
        const next: ClipAnimation = { type, name: animation.name, duration }
        return {
          ...s,
          animations: inOrder([...fitted.filter((a) => a.duration > 0), next]),
        }
      }),
    })),
  }
}

// After a split the in animation stays with the left half and the out
// animation with the right, so nothing is animated at the cut.
export function splitAnimations(segment: Segment): [ClipAnimation[], ClipAnimation[]] {
  return [
    segment.animations.filter((a) => a.type === 'in'),
    segment.animations.filter((a) => a.type === 'out'),
  ]
}

// The clip part-way through an animation. `arrived` runs from 0, fully away,
// to 1, in place.
function apply(clip: Clip, animation: ClipAnimation, arrived: number): Clip {
  const away = 1 - arrived
  // An in animation comes from the opposite side to the one it moves towards;
  // an out animation carries on in its direction.
  const side = animation.type === 'in' ? -1 : 1
  const faded = { ...clip, alpha: clip.alpha * arrived }
  const moved = (dx: number, dy: number): Clip => ({
    ...faded,
    transform: {
      x: clip.transform.x + dx * side * away * SLIDE_DISTANCE,
      y: clip.transform.y + dy * side * away * SLIDE_DISTANCE,
    },
  })
  const zoomed = (grow: number): Clip => {
    const factor = 1 + grow * side * away * ZOOM_AMOUNT
    return { ...faded, scale: { x: clip.scale.x * factor, y: clip.scale.y * factor } }
  }
  switch (animation.name) {
    case 'Slide Left':
      return moved(-1, 0)
    case 'Slide Right':
      return moved(1, 0)
    case 'Slide Up':
      return moved(0, 1)
    case 'Slide Down':
      return moved(0, -1)
    case 'Zoom In':
      return zoomed(1)
    case 'Zoom Out':
      return zoomed(-1)
    default:
      return faded
  }
}

// Quick at first and settling at the end, so a clip eases into place and
// eases away from it.
const settle = (p: number): number => 1 - (1 - Math.min(1, Math.max(0, p))) ** 3

// The clip as its animations leave it at timeline time `t`.
export function animateClip(segment: Segment, clip: Clip, t: number): Clip {
  if (segment.animations.length === 0) return clip
  const { in: arriving, out: leaving } = effectiveAnimations(segment)
  const sinceStart = t - segment.target_timerange.start
  const untilEnd = segmentEnd(segment) - t
  let result = clip
  if (arriving && sinceStart < arriving.duration) {
    result = apply(result, arriving, settle(sinceStart / arriving.duration))
  }
  if (leaving && untilEnd < leaving.duration) {
    result = apply(result, leaving, settle(untilEnd / leaving.duration))
  }
  return result
}
