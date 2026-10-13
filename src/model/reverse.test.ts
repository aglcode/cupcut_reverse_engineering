import { describe, expect, it } from 'vitest'
import { audibleSegments, resolveFrame, sourceTime, type MediaLayer } from '../engine/resolve'
import { FULL_CROP } from './crop'
import { evalProperty, keyframeTimes, setKeyframes } from './keyframes'
import {
  addMedia,
  findSegment,
  freezeFrame,
  moveSegment,
  setReverse,
  setSpeed,
  splitSegment,
  trimSegment,
} from './ops'
import { frameToUs, usToFrame } from './time'
import { setTransition } from './transitions'
import { emptyDraft, newId, segmentEnd, type Draft, type VideoMaterial } from './types'

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

// A 10 s source trimmed to its 2 s - 6 s part, sitting at 0 - 4 s on the timeline.
function middle() {
  const added = addMedia(emptyDraft(), video(10), 0)
  let draft = trimSegment(added.draft, added.segmentId, 'end', 6_000_000)
  draft = trimSegment(draft, added.segmentId, 'start', 2_000_000)
  draft = moveSegment(draft, added.segmentId, 0)
  return { draft, id: added.segmentId }
}

function expectAligned(draft: Draft) {
  for (const track of draft.tracks) {
    let cursor = 0
    for (const s of track.segments) {
      const { start, duration } = s.target_timerange
      expect(frameToUs(usToFrame(start, draft.fps), draft.fps)).toBe(start)
      expect(start).toBeGreaterThanOrEqual(cursor)
      expect(duration).toBeGreaterThan(0)
      cursor = start + duration
    }
  }
}

describe('reverse', () => {
  it('plays the same source range backwards', () => {
    const { draft, id } = middle()
    expect(seg(draft, id).source_timerange).toEqual({ start: 2_000_000, duration: 4_000_000 })
    const reversed = setReverse(draft, id, true)
    expect(seg(reversed, id).source_timerange).toEqual({ start: 2_000_000, duration: 4_000_000 })
    expect(sourceTime(seg(reversed, id), 0)).toBe(6_000_000)
    expect(sourceTime(seg(reversed, id), 1_000_000)).toBe(5_000_000)
    expect(sourceTime(seg(reversed, id), 3_000_000)).toBe(3_000_000)
  })

  it('accounts for speed', () => {
    const { draft, id } = middle()
    const fast = setSpeed(setReverse(draft, id, true), id, 2)
    expect(seg(fast, id).target_timerange.duration).toBe(2_000_000)
    expect(sourceTime(seg(fast, id), 1_000_000)).toBe(4_000_000)
  })

  it('trims the source from the opposite end', () => {
    const { draft, id } = middle()
    const reversed = setReverse(draft, id, true)
    // The first second on the timeline shows source 6 s down to 5 s; trimming
    // it off must drop that part and leave 2 s - 5 s.
    const trimmed = trimSegment(reversed, id, 'start', 1_000_000)
    expect(seg(trimmed, id).source_timerange).toEqual({ start: 2_000_000, duration: 3_000_000 })
    expect(sourceTime(seg(trimmed, id), 1_000_000)).toBe(5_000_000)

    const shorter = trimSegment(reversed, id, 'end', 3_000_000)
    expect(seg(shorter, id).source_timerange).toEqual({ start: 3_000_000, duration: 3_000_000 })
    expect(sourceTime(seg(shorter, id), 0)).toBe(6_000_000)
  })

  it('can only be extended as far as the media goes on that side', () => {
    const { draft, id } = middle()
    const reversed = moveSegment(setReverse(draft, id, true), id, 10_000_000)
    // The source has 4 s after the range (6 s - 10 s): that is what dragging
    // the timeline start outwards uncovers on a reversed clip.
    const grown = trimSegment(reversed, id, 'start', 0)
    expect(seg(grown, id).target_timerange.start).toBe(6_000_000)
    expect(seg(grown, id).source_timerange).toEqual({ start: 2_000_000, duration: 8_000_000 })
    // And 2 s before it (0 - 2 s) at the timeline end.
    const longer = trimSegment(reversed, id, 'end', 99_000_000)
    expect(segmentEnd(seg(longer, id))).toBe(16_000_000)
    expect(seg(longer, id).source_timerange).toEqual({ start: 0, duration: 6_000_000 })
  })

  it('splits so each half keeps showing what it showed', () => {
    const { draft, id } = middle()
    const reversed = setReverse(draft, id, true)
    const split = splitSegment(reversed, id, 1_000_000)
    const [left, right] = split.tracks[0].segments
    expect(left.source_timerange).toEqual({ start: 5_000_000, duration: 1_000_000 })
    expect(right.source_timerange).toEqual({ start: 2_000_000, duration: 3_000_000 })
    expect(sourceTime(left, 500_000)).toBe(sourceTime(seg(reversed, id), 500_000))
    expect(sourceTime(right, 2_000_000)).toBe(sourceTime(seg(reversed, id), 2_000_000))
  })

  it('keeps keyframes on the same footage', () => {
    const { draft, id } = middle()
    // Opacity 0 at source 2 s rising to 1 at source 6 s.
    let keyed = setKeyframes(draft, id, { KFTypeAlpha: 0 }, 0)
    keyed = setKeyframes(keyed, id, { KFTypeAlpha: 1 }, 3_966_666)
    const reversed = setReverse(keyed, id, true)
    expect(evalProperty(seg(reversed, id), 'KFTypeAlpha', 0)).toBeCloseTo(1, 1)
    expect(evalProperty(seg(reversed, id), 'KFTypeAlpha', 3_966_666)).toBeCloseTo(0, 1)
    expect(keyframeTimes(seg(reversed, id)).every((t) => t >= 0 && t <= 4_000_000)).toBe(true)
  })

  it('runs past its edges correctly during a transition', () => {
    const { draft, id } = middle()
    const second = addMedia(draft, video(10), 4_000_000)
    let both = trimSegment(second.draft, second.segmentId, 'end', 8_000_000)
    both = setReverse(both, id, true)
    both = setTransition(both, id, { name: 'Mix', duration: 1_000_000 })
    // 0.4 s after the cut the reversed clip is 0.4 s before the start of its range.
    const outgoing = resolveFrame(both, 4_400_000).visual[0] as MediaLayer
    expect(outgoing.segment.id).toBe(id)
    expect(outgoing.sourceUs).toBe(1_600_000)
  })

  it('does not apply to photos', () => {
    const photo: VideoMaterial = { ...video(0), type: 'photo' }
    const { draft, segmentId } = addMedia(emptyDraft(), photo, 0)
    expect(setReverse(draft, segmentId, true)).toBe(draft)
  })
})

describe('freezeFrame', () => {
  it('cuts the clip, inserts a still and moves the rest later', () => {
    const { draft, id } = middle()
    const made = freezeFrame(draft, id, 1_000_000)!
    const [left, still, right] = made.draft.tracks[0].segments
    expect(left.target_timerange).toEqual({ start: 0, duration: 1_000_000 })
    expect(still.id).toBe(made.segmentId)
    expect(still.freeze).toBe(true)
    expect(still.target_timerange).toEqual({ start: 1_000_000, duration: 3_000_000 })
    expect(right.target_timerange).toEqual({ start: 4_000_000, duration: 3_000_000 })
    expect(made.draft.duration).toBe(7_000_000)
    expectAligned(made.draft)
  })

  it('holds the frame that was under the playhead', () => {
    const { draft, id } = middle()
    const made = freezeFrame(draft, id, 1_000_000)!
    const still = seg(made.draft, made.segmentId)
    expect(sourceTime(still, 1_000_000)).toBe(3_000_000)
    expect(sourceTime(still, 3_900_000)).toBe(3_000_000)
    // The clip carries on from the same frame afterwards.
    const right = made.draft.tracks[0].segments[2]
    expect(sourceTime(right, 4_000_000)).toBe(3_000_000)
  })

  it('takes the right frame from a reversed clip', () => {
    const { draft, id } = middle()
    const made = freezeFrame(setReverse(draft, id, true), id, 1_000_000)!
    expect(sourceTime(seg(made.draft, made.segmentId), 2_000_000)).toBe(5_000_000)
    expect(seg(made.draft, made.segmentId).reverse).toBe(false)
  })

  it('at the very start needs no cut', () => {
    const { draft, id } = middle()
    const made = freezeFrame(draft, id, 0)!
    expect(made.draft.tracks[0].segments.map((s) => s.freeze)).toEqual([true, false])
    expect(seg(made.draft, id).target_timerange.start).toBe(3_000_000)
  })

  it('moves later clips on the same track too', () => {
    const { draft, id } = middle()
    const second = addMedia(draft, video(2), 4_000_000)
    const made = freezeFrame(second.draft, id, 1_000_000)!
    expect(seg(made.draft, second.segmentId).target_timerange.start).toBe(7_000_000)
    expectAligned(made.draft)
  })

  it('is silent, can be any length and cannot be retimed', () => {
    const { draft, id } = middle()
    const made = freezeFrame(draft, id, 1_000_000)!
    expect(audibleSegments(made.draft).some((a) => a.segment.id === made.segmentId)).toBe(false)
    const shorter = trimSegment(made.draft, made.segmentId, 'end', 2_000_000)
    expect(seg(shorter, made.segmentId).target_timerange.duration).toBe(1_000_000)
    expect(sourceTime(seg(shorter, made.segmentId), 1_500_000)).toBe(3_000_000)
    expect(setSpeed(made.draft, made.segmentId, 2)).toBe(made.draft)
    expect(setReverse(made.draft, made.segmentId, true)).toBe(made.draft)
  })

  it('refuses outside the clip, on a still, and on a photo', () => {
    const { draft, id } = middle()
    expect(freezeFrame(draft, id, 4_000_000)).toBeNull()
    const made = freezeFrame(draft, id, 1_000_000)!
    expect(freezeFrame(made.draft, made.segmentId, 2_000_000)).toBeNull()
    const photo: VideoMaterial = { ...video(0), type: 'photo' }
    const added = addMedia(emptyDraft(), photo, 0)
    expect(freezeFrame(added.draft, added.segmentId, 0)).toBeNull()
  })

  it('keeps the look the clip had at that moment', () => {
    const { draft, id } = middle()
    let keyed = setKeyframes(draft, id, { KFTypeAlpha: 0 }, 0)
    keyed = setKeyframes(keyed, id, { KFTypeAlpha: 1 }, 2_000_000)
    const made = freezeFrame(keyed, id, 1_000_000)!
    const still = seg(made.draft, made.segmentId)
    expect(still.common_keyframes).toEqual([])
    expect(still.clip?.alpha).toBeCloseTo(0.5)
  })
})
