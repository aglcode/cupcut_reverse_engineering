import { describe, expect, it } from 'vitest'
import { FULL_CROP } from './crop'
import {
  evalClip,
  evalProperty,
  hasKeyframeAt,
  isAnimated,
  keyframeTimes,
  removeKeyframes,
  setKeyframes,
  setValues,
} from './keyframes'
import { addMedia, addText, findSegment, setSpeed, splitSegment, trimSegment } from './ops'
import { emptyDraft, newId, type Draft, type VideoMaterial } from './types'

const video = (seconds: number): VideoMaterial => ({
  id: newId(),
  type: 'video',
  path: 'clip.mp4',
  duration: seconds * 1_000_000,
  width: 1920,
  height: 1080,
  has_audio: true,
  crop: { ...FULL_CROP },
})

const seg = (draft: Draft, id: string) => findSegment(draft, id)!.segment

// A 4 s clip at 2 s on the timeline, opacity fading 0 -> 1 between 3 s and 5 s.
function fading() {
  const added = addMedia(emptyDraft(), video(4), 2_000_000)
  let draft = setKeyframes(added.draft, added.segmentId, { KFTypeAlpha: 0 }, 3_000_000)
  draft = setKeyframes(draft, added.segmentId, { KFTypeAlpha: 1 }, 5_000_000)
  return { draft, id: added.segmentId }
}

describe('evaluation', () => {
  it('uses the static value when a property has no keyframes', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    expect(evalProperty(seg(draft, segmentId), 'KFTypeAlpha', 1_000_000)).toBe(1)
    expect(isAnimated(seg(draft, segmentId), 'KFTypeAlpha')).toBe(false)
  })

  it('interpolates linearly and holds outside the keyframes', () => {
    const { draft, id } = fading()
    const s = seg(draft, id)
    expect(evalProperty(s, 'KFTypeAlpha', 2_000_000)).toBe(0)
    expect(evalProperty(s, 'KFTypeAlpha', 3_000_000)).toBe(0)
    expect(evalProperty(s, 'KFTypeAlpha', 4_000_000)).toBeCloseTo(0.5)
    expect(evalProperty(s, 'KFTypeAlpha', 5_000_000)).toBe(1)
    expect(evalProperty(s, 'KFTypeAlpha', 5_900_000)).toBe(1)
  })

  it('leaves properties without keyframes at their static value', () => {
    const { draft, id } = fading()
    const clip = evalClip(seg(draft, id), 4_000_000)
    expect(clip.alpha).toBeCloseTo(0.5)
    expect(clip.scale).toEqual({ x: 1, y: 1 })
    expect(clip.transform).toEqual({ x: 0, y: 0 })
  })
})

describe('time base', () => {
  it('stores media keyframes in source time, as CapCut does', () => {
    const { draft, id } = fading()
    const offsets = seg(draft, id).common_keyframes[0].keyframe_list.map((f) => f.time_offset)
    // Timeline 3 s and 5 s on a clip that starts at 2 s are 1 s and 3 s into the media.
    expect(offsets).toEqual([1_000_000, 3_000_000])
    expect(keyframeTimes(seg(draft, id))).toEqual([3_000_000, 5_000_000])
  })

  it('keeps the picture unchanged when the start is trimmed', () => {
    const { draft, id } = fading()
    const trimmed = trimSegment(draft, id, 'start', 3_500_000)
    expect(evalProperty(seg(trimmed, id), 'KFTypeAlpha', 4_000_000)).toBeCloseTo(0.5)
    expect(evalProperty(seg(trimmed, id), 'KFTypeAlpha', 3_500_000)).toBeCloseTo(0.25)
  })

  it('keeps the picture unchanged on both sides of a split', () => {
    const { draft, id } = fading()
    const split = splitSegment(draft, id, 4_000_000)
    const [left, right] = split.tracks[0].segments
    expect(evalProperty(left, 'KFTypeAlpha', 3_500_000)).toBeCloseTo(0.25)
    expect(evalProperty(right, 'KFTypeAlpha', 4_000_000)).toBeCloseTo(0.5)
    expect(evalProperty(right, 'KFTypeAlpha', 4_500_000)).toBeCloseTo(0.75)
  })

  it('keeps keyframes on the same footage when speed changes', () => {
    const { draft, id } = fading()
    const fast = setSpeed(draft, id, 2)
    // 1 s and 3 s into the media now play at 2.5 s and 3.5 s on the timeline.
    expect(keyframeTimes(seg(fast, id))).toEqual([2_500_000, 3_500_000])
    expect(evalProperty(seg(fast, id), 'KFTypeAlpha', 3_000_000)).toBeCloseTo(0.5)
  })

  it('keeps text keyframes in place through a trim and a split', () => {
    const added = addText(emptyDraft(), 'Hi', 0)
    let draft = setKeyframes(added.draft, added.segmentId, { KFTypePositionX: -1 }, 0)
    draft = setKeyframes(draft, added.segmentId, { KFTypePositionX: 1 }, 2_000_000)
    expect(evalProperty(seg(draft, added.segmentId), 'KFTypePositionX', 1_000_000)).toBeCloseTo(0)

    const trimmed = trimSegment(draft, added.segmentId, 'start', 500_000)
    expect(evalProperty(seg(trimmed, added.segmentId), 'KFTypePositionX', 1_000_000)).toBeCloseTo(0)

    const split = splitSegment(draft, added.segmentId, 1_500_000)
    const [left, right] = split.tracks.find((t) => t.type === 'text')!.segments
    expect(evalProperty(left, 'KFTypePositionX', 1_000_000)).toBeCloseTo(0)
    expect(evalProperty(right, 'KFTypePositionX', 1_500_000)).toBeCloseTo(0.5)
  })
})

describe('editing', () => {
  it('replaces a keyframe set on the same frame', () => {
    const { draft, id } = fading()
    const again = setKeyframes(draft, id, { KFTypeAlpha: 0.4 }, 3_000_010)
    const list = seg(again, id).common_keyframes[0].keyframe_list
    expect(list.map((f) => f.values[0])).toEqual([0.4, 1])
  })

  it('keeps keyframes sorted', () => {
    const { draft, id } = fading()
    const more = setKeyframes(draft, id, { KFTypeAlpha: 0.9 }, 2_500_000)
    const offsets = seg(more, id).common_keyframes[0].keyframe_list.map((f) => f.time_offset)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
    expect(offsets).toHaveLength(3)
  })

  it('reports whether a keyframe sits at a time', () => {
    const { draft, id } = fading()
    expect(hasKeyframeAt(seg(draft, id), 'KFTypeAlpha', 3_000_000, 30)).toBe(true)
    expect(hasKeyframeAt(seg(draft, id), 'KFTypeAlpha', 4_000_000, 30)).toBe(false)
  })

  it('removes one keyframe and leaves the rest', () => {
    const { draft, id } = fading()
    const removed = removeKeyframes(draft, id, ['KFTypeAlpha'], 3_000_000)
    expect(seg(removed, id).common_keyframes[0].keyframe_list).toHaveLength(1)
  })

  it('goes back to a static value when the last keyframe is removed', () => {
    const added = addMedia(emptyDraft(), video(4), 0)
    const keyed = setKeyframes(added.draft, added.segmentId, { KFTypeAlpha: 0.3 }, 1_000_000)
    const removed = removeKeyframes(keyed, added.segmentId, ['KFTypeAlpha'], 1_000_000)
    const s = seg(removed, added.segmentId)
    expect(s.common_keyframes).toEqual([])
    expect(s.clip?.alpha).toBe(0.3)
  })

  it('setValues keys animated properties and sets static ones directly', () => {
    const { draft, id } = fading()
    const next = setValues(draft, id, { KFTypeAlpha: 0.6, KFTypeRotation: 45 }, 4_000_000)
    const s = seg(next, id)
    expect(s.common_keyframes).toHaveLength(1)
    expect(s.common_keyframes[0].keyframe_list).toHaveLength(3)
    expect(evalProperty(s, 'KFTypeAlpha', 4_000_000)).toBeCloseTo(0.6)
    expect(s.clip?.rotation).toBe(45)
  })

  it('clamps a keyframe onto the clip', () => {
    const added = addMedia(emptyDraft(), video(4), 2_000_000)
    const keyed = setKeyframes(added.draft, added.segmentId, { KFTypeAlpha: 0 }, 0)
    expect(keyframeTimes(seg(keyed, added.segmentId))).toEqual([2_000_000])
  })
})
