// Keyframes, in the shape CapCut stores them: one list per animated property
// on segment.common_keyframes, each keyframe a (time_offset, values) pair.
//
// As in CapCut drafts, time_offset for media is a position in the *source*
// (e.g. a clip whose source starts at 153379996 has keyframes from 153379996),
// so keyframes stay attached to the footage through trims, splits and speed
// changes. Text has no source; its offsets count from the segment start.
// Interpolation is linear (CapCut's "Line" curve type).

import {
  EASINGS,
  easingOf,
  handlesFor,
  interpolate,
  NO_HANDLE,
  scaleHandle,
  type EasingName,
} from './easing'
import { frameDuration, snapToFrame } from './time'
import { sourceTimeAt, timelineTimeAt, usesSourceTime } from './timing'
import {
  DEFAULT_CLIP,
  DEFAULT_MASK_CONFIG,
  newId,
  segmentEnd,
  type Clip,
  type Draft,
  type Keyframe,
  type KeyframeList,
  type KeyframeProperty,
  type Segment,
} from './types'

// Timeline time -> the time base keyframes are stored in.
export function keyTime(segment: Segment, t: number): number {
  return usesSourceTime(segment) ? sourceTimeAt(segment, t) : t - segment.target_timerange.start
}

// Inverse of keyTime: where a keyframe sits on the timeline.
export function timelineTime(segment: Segment, key: number): number {
  return usesSourceTime(segment)
    ? timelineTimeAt(segment, key)
    : segment.target_timerange.start + key
}

const listFor = (segment: Segment, property: KeyframeProperty): KeyframeList | undefined =>
  segment.common_keyframes.find((k) => k.property_type === property)

export const isAnimated = (segment: Segment, property: KeyframeProperty): boolean =>
  (listFor(segment, property)?.keyframe_list.length ?? 0) > 0

// The mask setting each mask property animates.
export const MASK_FIELDS = {
  KFTypeCommonMaskSizeWidth: 'width',
  KFTypeCommonMaskSizeHeight: 'height',
  KFTypeCommonMaskPositionX: 'centerX',
  KFTypeCommonMaskPositionY: 'centerY',
  KFTypeCommonMaskRotation: 'rotation',
  KFTypeCommonMaskFeather: 'feather',
  KFTypeCommonMaskRoundCorner: 'roundCorner',
} as const

type MaskProperty = keyof typeof MASK_FIELDS

export const isMaskProperty = (property: KeyframeProperty): property is MaskProperty =>
  property in MASK_FIELDS

// The value a property has when it is not animated.
export function baseValue(segment: Segment, property: KeyframeProperty): number {
  if (isMaskProperty(property)) {
    return (segment.mask?.config ?? DEFAULT_MASK_CONFIG)[MASK_FIELDS[property]]
  }
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
    case 'KFTypeBrightness':
      return segment.adjust.brightness
    case 'KFTypeContrast':
      return segment.adjust.contrast
    case 'KFTypeSaturation':
      return segment.adjust.saturation
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
    if (key <= b.time_offset) return interpolate(a, b, key)
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
  (frameDuration(fps) / 2) * (usesSourceTime(segment) ? segment.speed : 1)

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
  if (isMaskProperty(property)) {
    const mask = segment.mask
    if (!mask) return segment
    return { ...segment, mask: { ...mask, config: { ...mask.config, [MASK_FIELDS[property]]: value } } }
  }
  switch (property) {
    case 'KFTypeVolume':
      return { ...segment, volume: value }
    case 'KFTypeBrightness':
      return { ...segment, adjust: { ...segment.adjust, brightness: value } }
    case 'KFTypeContrast':
      return { ...segment, adjust: { ...segment.adjust, contrast: value } }
    case 'KFTypeSaturation':
      return { ...segment, adjust: { ...segment.adjust, saturation: value } }
  }
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
    const all = existing?.keyframe_list ?? []
    const kept = all.filter((f) => Math.abs(f.time_offset - key) > tol)
    // Changing the value of a keyframe keeps its easing.
    const old = all.find((f) => Math.abs(f.time_offset - key) <= tol)
    const next: Keyframe = {
      id: old?.id ?? newId(),
      time_offset: key,
      values: [value],
      left_control: old?.left_control ?? NO_HANDLE,
      right_control: old?.right_control ?? NO_HANDLE,
    }
    const keyframe_list = [...kept, next].sort((a, b) => a.time_offset - b.time_offset)
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

// ---- easing and retiming ---------------------------------------------------

// The interval that leaves the keyframe at index `i` as the clip plays: the
// pair of list positions, and whether it runs backwards through the list
// (which it does on a reversed clip, whose keyframes are in source order).
function intervalAfter(segment: Segment, list: Keyframe[], i: number) {
  const backwards = usesSourceTime(segment) && segment.reverse
  const from = backwards ? i - 1 : i
  return from >= 0 && from + 1 < list.length ? { from, backwards } : null
}

const flip = (name: EasingName): EasingName =>
  name === 'Ease in' ? 'Ease out' : name === 'Ease out' ? 'Ease in' : name

function indexAt(segment: Segment, list: Keyframe[], t: number, fps: number): number {
  const key = keyTime(segment, clampToSegment(segment, t, fps))
  const tol = tolerance(segment, fps)
  return list.findIndex((f) => Math.abs(f.time_offset - key) <= tol)
}

// Easing of the motion that starts at the keyframes under `t`:
// a preset name, 'Mixed' when the properties there differ or use handles that
// match no preset, or null when nothing follows those keyframes.
export function easingAt(segment: Segment, t: number, fps: number): EasingName | 'Mixed' | null {
  const found = new Set<EasingName | 'Mixed'>()
  for (const { keyframe_list: list } of segment.common_keyframes) {
    const i = indexAt(segment, list, t, fps)
    const interval = i < 0 ? null : intervalAfter(segment, list, i)
    if (!interval) continue
    const name = easingOf(list[interval.from], list[interval.from + 1])
    found.add(name === null ? 'Mixed' : interval.backwards ? flip(name) : name)
  }
  if (found.size === 0) return null
  return found.size === 1 ? [...found][0] : 'Mixed'
}

// Sets the easing of the motion that starts at the keyframes under `t`, for
// every property that has a keyframe there and another after it.
export function setEasing(draft: Draft, segmentId: string, t: number, name: EasingName): Draft {
  const segment = find(draft, segmentId)
  if (!segment || !EASINGS.includes(name)) return draft
  let changed = false
  const lists = segment.common_keyframes.map((k) => {
    const list = k.keyframe_list
    const i = indexAt(segment, list, t, draft.fps)
    const interval = i < 0 ? null : intervalAfter(segment, list, i)
    if (!interval) return k
    const a = list[interval.from]
    const b = list[interval.from + 1]
    const [right, left] = handlesFor(
      interval.backwards ? flip(name) : name,
      b.time_offset - a.time_offset,
    )
    changed = true
    return {
      ...k,
      keyframe_list: list.map((f) =>
        f === a ? { ...f, right_control: right } : f === b ? { ...f, left_control: left } : f,
      ),
    }
  })
  return changed ? replace(draft, { ...segment, common_keyframes: lists }) : draft
}

// Moves the keyframes at timeline time `from` to `to`. They cannot pass the
// keyframes on either side or leave the clip, and the easing either side
// keeps its shape.
export function moveKeyframes(draft: Draft, segmentId: string, from: number, to: number): Draft {
  const segment = find(draft, segmentId)
  if (!segment) return draft
  const fps = draft.fps
  // One frame, in the units keyframe times are stored in.
  const gap = tolerance(segment, fps) * 2
  const hits = segment.common_keyframes
    .map((k) => ({ k, i: indexAt(segment, k.keyframe_list, from, fps) }))
    .filter((h) => h.i >= 0)
  if (hits.length === 0) return draft

  const current = hits[0].k.keyframe_list[hits[0].i].time_offset
  let lo = -Infinity
  let hi = Infinity
  for (const { k, i } of hits) {
    const list = k.keyframe_list
    if (i > 0) lo = Math.max(lo, list[i - 1].time_offset + gap)
    if (i + 1 < list.length) hi = Math.min(hi, list[i + 1].time_offset - gap)
  }
  if (lo > hi) return draft
  const wanted = Math.round(keyTime(segment, clampToSegment(segment, to, fps)))
  const target = Math.round(Math.min(hi, Math.max(lo, wanted)))
  if (target === current) return draft

  const moved = new Map(
    hits.map(({ k, i }) => {
      const list = k.keyframe_list
      const prev = list[i - 1]
      const next = list[i + 1]
      const was = list[i].time_offset
      const keyframe_list = list.map((f, index) => {
        if (index === i) {
          return {
            ...f,
            time_offset: target,
            left_control: prev
              ? scaleHandle(f.left_control, was - prev.time_offset, target - prev.time_offset)
              : f.left_control,
            right_control: next
              ? scaleHandle(f.right_control, next.time_offset - was, next.time_offset - target)
              : f.right_control,
          }
        }
        if (index === i - 1) {
          const right = scaleHandle(f.right_control, was - f.time_offset, target - f.time_offset)
          return { ...f, right_control: right }
        }
        if (index === i + 1) {
          const left = scaleHandle(f.left_control, f.time_offset - was, f.time_offset - target)
          return { ...f, left_control: left }
        }
        return f
      })
      return [k, { ...k, keyframe_list }] as const
    }),
  )
  const lists = segment.common_keyframes.map((k) => moved.get(k) ?? k)
  return replace(draft, { ...segment, common_keyframes: lists })
}
