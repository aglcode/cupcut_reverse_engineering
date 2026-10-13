import { describe, expect, it } from 'vitest'
import { FULL_CROP } from './crop'
import {
  addMedia,
  addText,
  findSegment,
  moveSegment,
  removeSegment,
  setCanvas,
  setSpeed,
  splitSegment,
  trimSegment,
} from './ops'
import { frameToUs, usToFrame } from './time'
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

// The properties every CapCut draft we inspected satisfies.
function expectInvariants(draft: Draft) {
  let end = 0
  for (const track of draft.tracks) {
    let cursor = 0
    for (const s of track.segments) {
      const { start, duration } = s.target_timerange
      expect(frameToUs(usToFrame(start, draft.fps), draft.fps)).toBe(start)
      expect(frameToUs(usToFrame(start + duration, draft.fps), draft.fps)).toBe(start + duration)
      expect(duration).toBeGreaterThan(0)
      expect(start).toBeGreaterThanOrEqual(cursor)
      cursor = start + duration
      end = Math.max(end, cursor)
      if (s.source_timerange) {
        expect(Math.abs(s.source_timerange.duration - duration * s.speed)).toBeLessThanOrEqual(1)
        expect(s.source_timerange.start).toBeGreaterThanOrEqual(0)
      }
    }
  }
  expect(draft.duration).toBe(end)
}

describe('time', () => {
  it('stores frames the way CapCut does', () => {
    expect(frameToUs(5, 30)).toBe(166666)
    expect(frameToUs(23, 30)).toBe(766666)
    expect(usToFrame(166666, 30)).toBe(5)
  })
})

describe('addMedia', () => {
  it('places a clip and derives the draft duration', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    expect(draft.duration).toBe(4_000_000)
    expect(findSegment(draft, segmentId)?.segment.source_timerange).toEqual({
      start: 0,
      duration: 4_000_000,
    })
    expectInvariants(draft)
  })

  it('opens a new track instead of overlapping', () => {
    const first = addMedia(emptyDraft(), video(4), 0)
    const second = addMedia(first.draft, video(2), 1_000_000)
    expect(second.draft.tracks.filter((t) => t.type === 'video')).toHaveLength(2)
    expectInvariants(second.draft)
  })
})

describe('moveSegment', () => {
  it('snaps to the frame grid', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(2), 0)
    const moved = moveSegment(draft, segmentId, 1_010_000)
    expect(findSegment(moved, segmentId)?.segment.target_timerange.start).toBe(frameToUs(30, 30))
    expectInvariants(moved)
  })

  it('lands next to a neighbour rather than on top of it', () => {
    const a = addMedia(emptyDraft(), video(2), 0)
    const b = addMedia(a.draft, video(2), 2_000_000)
    const moved = moveSegment(b.draft, b.segmentId, 1_500_000)
    expect(findSegment(moved, b.segmentId)?.segment.target_timerange.start).toBe(2_000_000)
    expectInvariants(moved)
  })
})

describe('trimSegment', () => {
  it('trims the start without slipping the media', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    const trimmed = trimSegment(draft, segmentId, 'start', 1_000_000)
    const s = findSegment(trimmed, segmentId)!.segment
    expect(s.target_timerange).toEqual({ start: 1_000_000, duration: 3_000_000 })
    expect(s.source_timerange).toEqual({ start: 1_000_000, duration: 3_000_000 })
    expectInvariants(trimmed)
  })

  it('cannot extend past the end of the media', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    const trimmed = trimSegment(draft, segmentId, 'end', 9_000_000)
    expect(segmentEnd(findSegment(trimmed, segmentId)!.segment)).toBe(4_000_000)
  })

  it('cannot extend before the start of the media', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 2_000_000)
    const once = trimSegment(draft, segmentId, 'start', 3_000_000)
    const back = trimSegment(once, segmentId, 'start', 0)
    expect(findSegment(back, segmentId)!.segment.target_timerange.start).toBe(2_000_000)
    expectInvariants(back)
  })

  it('stops at the neighbouring segment', () => {
    const a = addMedia(emptyDraft(), video(4), 0)
    const shortened = trimSegment(a.draft, a.segmentId, 'end', 2_000_000)
    const b = addMedia(shortened, video(2), 3_000_000)
    const grown = trimSegment(b.draft, a.segmentId, 'end', 4_000_000)
    expect(segmentEnd(findSegment(grown, a.segmentId)!.segment)).toBe(3_000_000)
    expectInvariants(grown)
  })

  it('keeps at least one frame', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    const trimmed = trimSegment(draft, segmentId, 'end', 0)
    expect(findSegment(trimmed, segmentId)!.segment.target_timerange.duration).toBe(
      frameToUs(1, 30),
    )
  })
})

describe('splitSegment', () => {
  it('splits into two segments that cover the same source', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    const split = splitSegment(draft, segmentId, 1_500_000)
    const [left, right] = split.tracks[0].segments
    expect(left.target_timerange).toEqual({ start: 0, duration: 1_500_000 })
    expect(right.target_timerange).toEqual({ start: 1_500_000, duration: 2_500_000 })
    expect(right.source_timerange).toEqual({ start: 1_500_000, duration: 2_500_000 })
    expect(right.id).not.toBe(left.id)
    expectInvariants(split)
  })

  it('accounts for speed when splitting', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    const fast = setSpeed(draft, segmentId, 2)
    const split = splitSegment(fast, segmentId, 1_000_000)
    expect(split.tracks[0].segments[1].source_timerange).toEqual({
      start: 2_000_000,
      duration: 2_000_000,
    })
    expectInvariants(split)
  })

  it('ignores a split outside the segment', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    expect(splitSegment(draft, segmentId, 0)).toBe(draft)
    expect(splitSegment(draft, segmentId, 4_000_000)).toBe(draft)
  })

  it('gives each half of a text segment its own material', () => {
    const { draft, segmentId } = addText(emptyDraft(), 'Hello', 0)
    const split = splitSegment(draft, segmentId, 1_000_000)
    const [left, right] = split.tracks.find((t) => t.type === 'text')!.segments
    expect(right.material_id).not.toBe(left.material_id)
    expect(split.materials.texts).toHaveLength(2)
  })
})

describe('setSpeed', () => {
  it('resizes the segment on the timeline', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    const fast = setSpeed(draft, segmentId, 2)
    const s = findSegment(fast, segmentId)!.segment
    expect(s.target_timerange.duration).toBe(2_000_000)
    expect(s.source_timerange?.duration).toBe(4_000_000)
    expectInvariants(fast)
  })

  it('cuts the clip short when slowing down into a neighbour', () => {
    const a = addMedia(emptyDraft(), video(2), 0)
    const b = addMedia(a.draft, video(2), 2_000_000)
    const slow = setSpeed(b.draft, a.segmentId, 0.5)
    const s = findSegment(slow, a.segmentId)!.segment
    expect(s.target_timerange.duration).toBe(2_000_000)
    expect(s.source_timerange?.duration).toBe(1_000_000)
    expectInvariants(slow)
  })
})

describe('removeSegment', () => {
  it('drops materials nothing references', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(4), 0)
    const removed = removeSegment(draft, segmentId)
    expect(removed.materials.videos).toHaveLength(0)
    expect(removed.duration).toBe(0)
  })
})

describe('setCanvas', () => {
  it('re-snaps segments when fps changes', () => {
    const a = addMedia(emptyDraft(), video(4), 0)
    const trimmed = trimSegment(a.draft, a.segmentId, 'end', frameToUs(31, 30))
    const b = addMedia(trimmed, video(2), frameToUs(31, 30))
    expectInvariants(setCanvas(b.draft, { fps: 24 }))
    expectInvariants(setCanvas(b.draft, { fps: 60 }))
  })
})
