// Keyframes, in the shape CapCut stores them: one list per animated property
// on segment.common_keyframes, each keyframe a (time_offset, values) pair.
//
// As in CapCut drafts, time_offset for media is a position in the *source*
// (e.g. a clip whose source starts at 153379996 has keyframes from 153379996),
// so keyframes stay attached to the footage through trims, splits and speed
// changes. Text has no source; its offsets count from the segment start.
// Interpolation is linear (CapCut's "Line" curve type).

import { frameDuration, snapToFrame } from './time'
import {
  DEFAULT_CLIP,
  newId,
  segmentEnd,
  type Clip,
  type Draft,
  type KeyframeList,
  type KeyframeProperty,
  type Segment,
} from './types'

// Timeline time -> the time base keyframes are stored in.
export function keyTime(segment: Segment, t: number): number {
  const offset = t - segment.target_timerange.start
  const src = segment.source_timerange
  return src ? src.start + offset * segment.speed : offset
}

// Inverse of keyTime: where a keyframe sits on the timeline.
export function timelineTime(segment: Segment, key: number): number {
  const src = segment.source_timerange
  const offset = src ? (key - src.start) / segment.speed : key
  return segment.target_timerange.start + offset
}

const listFor = (segment: Segment, property: KeyframeProperty): KeyframeList | undefined =>
  segment.common_keyframes.find((k) => k.property_type === property)

export const isAnimated = (segment: Segment, property: KeyframeProperty): boolean =>
  (listFor(segment, property)?.keyframe_list.length ?? 0) > 0

// The value a property has when it is not animated.
export function baseValue(segment: Segment, property: KeyframeProperty): number {
  const clip = segment.clip ?? DEFAULT_CLIP
  switch (property) {
    case 'KFTypePositionX':
      return clip.transform.x
    case 'KFTypePositionY':
      return clip.transform.y
    case 'KFTypeScaleX':
      return clip.scale.x
    case 'KFTypeScaleY':
      return clip.scale.y
    case 'KFTypeRotation':
      return clip.rotation
    case 'KFTypeAlpha':
      return clip.alpha
    case 'KFTypeVolume':
      return segment.volume
  }
}

// Value of a property at timeline time `t`. Holds the first keyframe's value
// before it and the last one's after it.
export function evalProperty(segment: Segment, property: KeyframeProperty, t: number): number {
  const frames = listFor(segment, property)?.keyframe_list
  if (!frames || frames.length === 0) return baseValue(segment, property)
  const key = keyTime(segment, t)
  if (key <= frames[0].time_offset) return frames[0].values[0]
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]
    const b = frames[i]
    if (key <= b.time_offset) {
      const span = b.time_offset - a.time_offset
      const f = span > 0 ? (key - a.time_offset) / span : 1
      return a.values[0] + (b.values[0] - a.values[0]) * f
    }
  }
  return frames[frames.length - 1].values[0]
}

export function evalClip(segment: Segment, t: number): Clip {
  if (segment.common_keyframes.length === 0) return segment.clip ?? DEFAULT_CLIP
  return {
    scale: {
      x: evalProperty(segment, 'KFTypeScaleX', t),
      y: evalProperty(segment, 'KFTypeScaleY', t),
    },
    rotation: evalProperty(segment, 'KFTypeRotation', t),
    transform: {
      x: evalProperty(segment, 'KFTypePositionX', t),
      y: evalProperty(segment, 'KFTypePositionY', t),
    },
    flip: (segment.clip ?? DEFAULT_CLIP).flip,
    alpha: evalProperty(segment, 'KFTypeAlpha', t),
  }
}

export const evalVolume = (segment: Segment, t: number): number =>
  Math.max(0, evalProperty(segment, 'KFTypeVolume', t))

// Timeline times of every keyframe on the segment, without duplicates.
export function keyframeTimes(segment: Segment): number[] {
  const times = segment.common_keyframes.flatMap((k) =>
    k.keyframe_list.map((f) => Math.round(timelineTime(segment, f.time_offset))),
  )
  return [...new Set(times)].sort((a, b) => a - b)
}

// Keyframes within half a frame of each other count as the same keyframe.
const tolerance = (segment: Segment, fps: number): number =>
  (frameDuration(fps) / 2) * (segment.source_timerange ? segment.speed : 1)

// A keyframe can only sit on a frame the segment actually shows.
function clampToSegment(segment: Segment, t: number, fps: number): number {
  const last = segmentEnd(segment) - frameDuration(fps)
  return Math.min(Math.max(snapToFrame(t, fps), segment.target_timerange.start), last)
}

export function hasKeyframeAt(
  segment: Segment,
  property: KeyframeProperty,
  t: number,
  fps: number,
): boolean {
  const key = keyTime(segment, clampToSegment(segment, t, fps))
  const tol = tolerance(segment, fps)
  return (
    listFor(segment, property)?.keyframe_list.some((f) => Math.abs(f.time_offset - key) <= tol) ??
    false
  )
}

const find = (draft: Draft, segmentId: string): Segment | undefined =>
  draft.tracks.flatMap((t) => t.segments).find((s) => s.id === segmentId)

function replace(draft: Draft, next: Segment): Draft {
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) => (s.id === next.id ? next : s)),
    })),
  }
}

// Writes the static value of a property.
export function withBaseValue(segment: Segment, property: KeyframeProperty, value: number): Segment {
  if (property === 'KFTypeVolume') return { ...segment, volume: value }
  const clip = segment.clip
  if (!clip) return segment
  switch (property) {
    case 'KFTypePositionX':
      return { ...segment, clip: { ...clip, transform: { ...clip.transform, x: value } } }
    case 'KFTypePositionY':
      return { ...segment, clip: { ...clip, transform: { ...clip.transform, y: value } } }
    case 'KFTypeScaleX':
      return { ...segment, clip: { ...clip, scale: { ...clip.scale, x: value } } }
    case 'KFTypeScaleY':
      return { ...segment, clip: { ...clip, scale: { ...clip.scale, y: value } } }
    case 'KFTypeRotation':
      return { ...segment, clip: { ...clip, rotation: value } }
    case 'KFTypeAlpha':
      return { ...segment, clip: { ...clip, alpha: value } }
  }
}

// Adds keyframes at timeline time `t`, or updates the ones already there.
export function setKeyframes(
  draft: Draft,
  segmentId: string,
  values: Partial<Record<KeyframeProperty, number>>,
  t: number,
): Draft {
  const segment = find(draft, segmentId)
  if (!segment) return draft
  const key = Math.round(keyTime(segment, clampToSegment(segment, t, draft.fps)))
  const tol = tolerance(segment, draft.fps)
  let lists = segment.common_keyframes

  for (const [property, value] of Object.entries(values) as [KeyframeProperty, number][]) {
    const existing = lists.find((k) => k.property_type === property)
    const kept = (existing?.keyframe_list ?? []).filter((f) => Math.abs(f.time_offset - key) > tol)
    const keyframe_list = [...kept, { id: newId(), time_offset: key, values: [value] }].sort(
      (a, b) => a.time_offset - b.time_offset,
    )
    const list: KeyframeList = { id: existing?.id ?? newId(), property_type: property, keyframe_list }
    lists = existing ? lists.map((k) => (k === existing ? list : k)) : [...lists, list]
  }
  return replace(draft, { ...segment, common_keyframes: lists })
}

// Sets property values the way an editor control should: an animated property
// gets a keyframe at `t`, a static one just changes its value.
export function setValues(
  draft: Draft,
  segmentId: string,
  values: Partial<Record<KeyframeProperty, number>>,
  t: number,
): Draft {
  const segment = find(draft, segmentId)
  if (!segment) return draft
  const keyed: Partial<Record<KeyframeProperty, number>> = {}
  let next = segment
  for (const [property, value] of Object.entries(values) as [KeyframeProperty, number][]) {
    if (isAnimated(segment, property)) keyed[property] = value
    else next = withBaseValue(next, property, value)
  }
  return setKeyframes(replace(draft, next), segmentId, keyed, t)
}

// Removes the keyframes at timeline time `t`. A property left with none goes
// back to being static, keeping the value it had at `t`.
export function removeKeyframes(
  draft: Draft,
  segmentId: string,
  properties: KeyframeProperty[],
  t: number,
): Draft {
  const segment = find(draft, segmentId)
  if (!segment) return draft
  const at = clampToSegment(segment, t, draft.fps)
  const key = keyTime(segment, at)
  const tol = tolerance(segment, draft.fps)
  const lists = segment.common_keyframes
    .map((k) =>
      properties.includes(k.property_type)
        ? { ...k, keyframe_list: k.keyframe_list.filter((f) => Math.abs(f.time_offset - key) > tol) }
        : k,
    )
    .filter((k) => k.keyframe_list.length > 0)
  let next: Segment = { ...segment, common_keyframes: lists }
  for (const property of properties) {
    if (isAnimated(segment, property) && !isAnimated(next, property)) {
      next = withBaseValue(next, property, evalProperty(segment, property, at))
    }
  }
  return replace(draft, next)
}

// Moves every keyframe by `delta`. Needed only where offsets count from the
// segment start (text) and that start moves.
export function shiftKeyframes(lists: KeyframeList[], delta: number): KeyframeList[] {
  if (delta === 0) return lists
  return lists.map((k) => ({
    ...k,
    keyframe_list: k.keyframe_list.map((f) => ({ ...f, time_offset: f.time_offset + delta })),
  }))
}
