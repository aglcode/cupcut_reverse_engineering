import { describe, expect, it } from 'vitest'
import { FULL_CROP } from './crop'
import { easingOf, handlesFor, interpolate, NO_HANDLE } from './easing'
import {
  easingAt,
  evalProperty,
  keyframeTimes,
  moveKeyframes,
  setEasing,
  setKeyframes,
} from './keyframes'
import { addMedia, addText, findSegment, setReverse } from './ops'
import { emptyDraft, newId, type Draft, type Keyframe, type VideoMaterial } from './types'

const video = (seconds: number): VideoMaterial => ({
  id: newId(),
  type: 'video',
  path: 'clip.mp4',
  duration: seconds * 1_000_000,
  width: 1920,
  height: 1080,
  has_audio: false,
  crop: { ...FULL_CROP },
})

const key = (time: number, value: number, more: Partial<Keyframe> = {}): Keyframe => ({
  id: newId(),
  time_offset: time,
  values: [value],
  left_control: NO_HANDLE,
  right_control: NO_HANDLE,
  ...more,
})

const seg = (draft: Draft, id: string) => findSegment(draft, id)!.segment
const alphaList = (draft: Draft, id: string) =>
  seg(draft, id).common_keyframes.find((k) => k.property_type === 'KFTypeAlpha')!.keyframe_list

// A 10 s clip at 0 with opacity keyframes: 0 at 0 s, 1 at 4 s, 0 at 8 s.
function animated() {
  const added = addMedia(emptyDraft(), video(10), 0)
  let draft = setKeyframes(added.draft, added.segmentId, { KFTypeAlpha: 0 }, 0)
  draft = setKeyframes(draft, added.segmentId, { KFTypeAlpha: 1 }, 4_000_000)
  draft = setKeyframes(draft, added.segmentId, { KFTypeAlpha: 0 }, 8_000_000)
  return { draft, id: added.segmentId }
}

describe('interpolate', () => {
  it('is linear without handles', () => {
    expect(interpolate(key(0, 10), key(1000, 20), 250)).toBeCloseTo(12.5)
  })

  it('matches the standard curves for each preset', () => {
    const span = 1_000_000
    const at = (name: Parameters<typeof handlesFor>[0], f: number) => {
      const [right, left] = handlesFor(name, span)
      return interpolate(key(0, 0, { right_control: right }), key(span, 1, { left_control: left }), f * span)
    }
    // Values of cubic-bezier(0.42,0,1,1), (0,0,0.58,1) and (0.42,0,0.58,1).
    expect(at('Ease in', 0.5)).toBeCloseTo(0.3154, 3)
    expect(at('Ease out', 0.5)).toBeCloseTo(0.6846, 3)
    expect(at('Ease in-out', 0.5)).toBeCloseTo(0.5, 3)
    expect(at('Ease in-out', 0.25)).toBeCloseTo(0.1292, 3)
    expect(at('Linear', 0.25)).toBeCloseTo(0.25)
  })

  it('starts and ends exactly on the keyframe values', () => {
    const [right, left] = handlesFor('Ease in-out', 1000)
    const a = key(0, 3, { right_control: right })
    const b = key(1000, 7, { left_control: left })
    expect(interpolate(a, b, 0)).toBeCloseTo(3, 5)
    expect(interpolate(a, b, 1000)).toBeCloseTo(7, 5)
  })

  it('never runs backwards, even with oversized handles', () => {
    const a = key(0, 0, { right_control: { x: 5000, y: 0 } })
    const b = key(1000, 1, { left_control: { x: -5000, y: 0 } })
    let last = -1
    for (let t = 0; t <= 1000; t += 50) {
      const v = interpolate(a, b, t)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
  })
})

describe('easingOf', () => {
  it('recognises the handle CapCut writes for Ease In', () => {
    // From a real draft: an interval of 397214 with a right handle of 166829.
    const a = key(153801423, 1, { right_control: { x: 166829, y: 0 } })
    const b = key(153801423 + 397214, 0.2)
    expect(166829 / 397214).toBeCloseTo(0.42, 4)
    expect(easingOf(a, b)).toBe('Ease in')
  })

  it('names each preset and nothing else', () => {
    for (const name of ['Linear', 'Ease in', 'Ease out', 'Ease in-out'] as const) {
      const [right, left] = handlesFor(name, 2_000_000)
      expect(easingOf(key(0, 0, { right_control: right }), key(2_000_000, 1, { left_control: left }))).toBe(name)
    }
    expect(easingOf(key(0, 0, { right_control: { x: 100_000, y: 0 } }), key(2_000_000, 1))).toBeNull()
    expect(easingOf(key(0, 0, { right_control: { x: 840_000, y: 0.5 } }), key(2_000_000, 1))).toBeNull()
  })
})

describe('setEasing and easingAt', () => {
  it('is linear to begin with', () => {
    const { draft, id } = animated()
    expect(easingAt(seg(draft, id), 0, 30)).toBe('Linear')
    expect(easingAt(seg(draft, id), 4_000_000, 30)).toBe('Linear')
  })

  it('eases the motion that starts at the keyframe, and only that one', () => {
    const { draft, id } = animated()
    const eased = setEasing(draft, id, 0, 'Ease in')
    expect(easingAt(seg(eased, id), 0, 30)).toBe('Ease in')
    expect(easingAt(seg(eased, id), 4_000_000, 30)).toBe('Linear')
    expect(evalProperty(seg(eased, id), 'KFTypeAlpha', 2_000_000)).toBeCloseTo(0.3154, 3)
    expect(evalProperty(seg(eased, id), 'KFTypeAlpha', 6_000_000)).toBeCloseTo(0.5)
  })

  it('has nothing to ease after the last keyframe or away from one', () => {
    const { draft, id } = animated()
    expect(easingAt(seg(draft, id), 8_000_000, 30)).toBeNull()
    expect(easingAt(seg(draft, id), 1_000_000, 30)).toBeNull()
    expect(setEasing(draft, id, 8_000_000, 'Ease in')).toBe(draft)
  })

  it('applies to every property keyed there', () => {
    const { draft, id } = animated()
    let both = setKeyframes(draft, id, { KFTypeRotation: 0 }, 0)
    both = setKeyframes(both, id, { KFTypeRotation: 90 }, 4_000_000)
    const eased = setEasing(both, id, 0, 'Ease out')
    expect(evalProperty(seg(eased, id), 'KFTypeRotation', 2_000_000)).toBeCloseTo(90 * 0.6846, 1)
    expect(evalProperty(seg(eased, id), 'KFTypeAlpha', 2_000_000)).toBeCloseTo(0.6846, 3)
  })

  it('reports Mixed when the properties there differ', () => {
    const { draft, id } = animated()
    let both = setKeyframes(draft, id, { KFTypeRotation: 0 }, 0)
    both = setKeyframes(both, id, { KFTypeRotation: 90 }, 2_000_000)
    // Opacity runs 0 - 4 s, rotation 0 - 2 s: ease them, then re-key one linear.
    const eased = setEasing(both, id, 0, 'Ease in')
    const lists = seg(eased, id).common_keyframes.map((k) =>
      k.property_type === 'KFTypeRotation'
        ? { ...k, keyframe_list: k.keyframe_list.map((f) => ({ ...f, right_control: NO_HANDLE })) }
        : k,
    )
    const mixed = { ...seg(eased, id), common_keyframes: lists }
    expect(easingAt(mixed, 0, 30)).toBe('Mixed')
  })

  it('keeps the easing when a keyframe value is changed', () => {
    const { draft, id } = animated()
    const eased = setEasing(draft, id, 0, 'Ease in-out')
    const edited = setKeyframes(eased, id, { KFTypeAlpha: 0.2 }, 0)
    expect(easingAt(seg(edited, id), 0, 30)).toBe('Ease in-out')
    expect(alphaList(edited, id)[0].values[0]).toBe(0.2)
  })

  it('means the same on screen for a reversed clip', () => {
    const added = addMedia(emptyDraft(), video(4), 0)
    let draft = setReverse(added.draft, added.segmentId, true)
    draft = setKeyframes(draft, added.segmentId, { KFTypeAlpha: 0 }, 0)
    draft = setKeyframes(draft, added.segmentId, { KFTypeAlpha: 1 }, 2_000_000)
    const eased = setEasing(draft, added.segmentId, 0, 'Ease in')
    expect(easingAt(seg(eased, added.segmentId), 0, 30)).toBe('Ease in')
    // Slow start as it plays: under half way at the midpoint.
    expect(evalProperty(seg(eased, added.segmentId), 'KFTypeAlpha', 1_000_000)).toBeCloseTo(0.3154, 2)
  })
})

describe('moveKeyframes', () => {
  it('moves a keyframe in time', () => {
    const { draft, id } = animated()
    const moved = moveKeyframes(draft, id, 4_000_000, 5_000_000)
    expect(keyframeTimes(seg(moved, id))).toEqual([0, 5_000_000, 8_000_000])
    expect(evalProperty(seg(moved, id), 'KFTypeAlpha', 2_500_000)).toBeCloseTo(0.5)
  })

  it('snaps to the frame grid', () => {
    const { draft, id } = animated()
    const moved = moveKeyframes(draft, id, 4_000_000, 5_010_000)
    expect(keyframeTimes(seg(moved, id))[1]).toBe(5_000_000)
  })

  it('cannot pass the keyframes on either side', () => {
    const { draft, id } = animated()
    const right = keyframeTimes(seg(moveKeyframes(draft, id, 4_000_000, 20_000_000), id))
    expect(right[1]).toBeLessThan(8_000_000)
    expect(right[1]).toBeGreaterThan(7_900_000)
    const left = keyframeTimes(seg(moveKeyframes(draft, id, 4_000_000, 0), id))
    expect(left[1]).toBeGreaterThan(0)
    expect(left[1]).toBeLessThan(100_000)
  })

  it('moves every property keyed at that time together', () => {
    const { draft, id } = animated()
    const both = setKeyframes(draft, id, { KFTypeRotation: 45 }, 4_000_000)
    const moved = moveKeyframes(both, id, 4_000_000, 3_000_000)
    for (const list of seg(moved, id).common_keyframes) {
      expect(list.keyframe_list.some((f) => f.time_offset === 3_000_000)).toBe(true)
      expect(list.keyframe_list.some((f) => f.time_offset === 4_000_000)).toBe(false)
    }
  })

  it('keeps the easing on both sides the same shape', () => {
    const { draft, id } = animated()
    let eased = setEasing(draft, id, 0, 'Ease in')
    eased = setEasing(eased, id, 4_000_000, 'Ease in-out')
    const moved = moveKeyframes(eased, id, 4_000_000, 6_000_000)
    expect(easingAt(seg(moved, id), 0, 30)).toBe('Ease in')
    expect(easingAt(seg(moved, id), 6_000_000, 30)).toBe('Ease in-out')
    // The first interval is now 6 s long, so its handle grew with it.
    expect(alphaList(moved, id)[0].right_control.x).toBe(Math.round(0.42 * 6_000_000))
  })

  it('does nothing where there is no keyframe', () => {
    const { draft, id } = animated()
    expect(moveKeyframes(draft, id, 1_000_000, 2_000_000)).toBe(draft)
    expect(moveKeyframes(draft, id, 4_000_000, 4_000_000)).toBe(draft)
  })

  it('works on text, whose keyframes count from the clip start', () => {
    const added = addText(emptyDraft(), 'Hi', 1_000_000)
    let draft = setKeyframes(added.draft, added.segmentId, { KFTypePositionX: -1 }, 1_000_000)
    draft = setKeyframes(draft, added.segmentId, { KFTypePositionX: 1 }, 3_000_000)
    const moved = moveKeyframes(draft, added.segmentId, 3_000_000, 2_000_000)
    expect(keyframeTimes(seg(moved, added.segmentId))).toEqual([1_000_000, 2_000_000])
    expect(evalProperty(seg(moved, added.segmentId), 'KFTypePositionX', 1_500_000)).toBeCloseTo(0)
  })
})
