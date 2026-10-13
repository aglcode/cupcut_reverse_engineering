import { describe, expect, it } from 'vitest'
import { FULL_CROP } from './crop'
import {
  addMedia,
  addText,
  findSegment,
  moveSegment,
  moveSegments,
  removeSegments,
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
  has_audio: false,
  crop: { ...FULL_CROP },
})

const start = (draft: Draft, id: string) => findSegment(draft, id)!.segment.target_timerange.start

// Every clip starts and ends on a frame, and none overlap on a track.
function expectOnGrid(draft: Draft) {
  for (const track of draft.tracks) {
    let cursor = 0
    for (const s of track.segments) {
      const from = s.target_timerange.start
      const to = segmentEnd(s)
      expect(frameToUs(usToFrame(from, draft.fps), draft.fps)).toBe(from)
      expect(frameToUs(usToFrame(to, draft.fps), draft.fps)).toBe(to)
      expect(from).toBeGreaterThanOrEqual(cursor)
      cursor = to
    }
  }
}

// A (0-2 s) and B (2-4 s) on the video track, a text clip at 1-4 s above them,
// and C (6-8 s) further along the video track.
function scene() {
  const a = addMedia(emptyDraft(), video(2), 0)
  const b = addMedia(a.draft, video(2), 2_000_000)
  const c = addMedia(b.draft, video(2), 6_000_000)
  const t = addText(c.draft, 'Title', 1_000_000)
  return { draft: t.draft, a: a.segmentId, b: b.segmentId, c: c.segmentId, t: t.segmentId }
}

describe('frame-exact placement', () => {
  it('keeps a moved clip on the grid when frame lengths differ', () => {
    // A one-frame clip is 33333 µs at frame 1 but 33334 µs at frame 2.
    const added = addMedia(emptyDraft(), video(2), 0)
    let draft = trimSegment(added.draft, added.segmentId, 'end', frameToUs(2, 30))
    draft = trimSegment(draft, added.segmentId, 'start', frameToUs(1, 30))
    expect(findSegment(draft, added.segmentId)!.segment.target_timerange.duration).toBe(33333)

    const moved = moveSegment(draft, added.segmentId, frameToUs(2, 30))
    const range = findSegment(moved, added.segmentId)!.segment.target_timerange
    expect(range).toEqual({ start: 66666, duration: 33334 })
    expectOnGrid(moved)
  })

  it('lets a clip sit flush against the next one at any frame', () => {
    const first = addMedia(emptyDraft(), video(2), 0)
    let draft = trimSegment(first.draft, first.segmentId, 'end', frameToUs(1, 30))
    const second = addMedia(draft, video(2), frameToUs(7, 30))
    draft = moveSegment(second.draft, first.segmentId, frameToUs(6, 30))
    expect(segmentEnd(findSegment(draft, first.segmentId)!.segment)).toBe(frameToUs(7, 30))
    expectOnGrid(draft)
  })
})

describe('moveSegments', () => {
  it('moves clips on different tracks by the same amount', () => {
    const { draft, b, t } = scene()
    const moved = moveSegments(draft, [b, t], b, 2_500_000)
    expect(start(moved, b)).toBe(2_500_000)
    expect(start(moved, t)).toBe(1_500_000)
    expectOnGrid(moved)
  })

  it('snaps the group to the frame grid', () => {
    const { draft, b, t } = scene()
    const moved = moveSegments(draft, [b, t], b, 2_510_000)
    expect(start(moved, b)).toBe(frameToUs(75, 30))
    expectOnGrid(moved)
  })

  it('lets clips of the group pass through each other', () => {
    const { draft, a, b } = scene()
    // A and B are back to back; moving both right must not see B as in A's way.
    const moved = moveSegments(draft, [a, b], a, 1_000_000)
    expect(start(moved, a)).toBe(1_000_000)
    expect(start(moved, b)).toBe(3_000_000)
  })

  it('stops the whole group when one clip reaches a clip outside it', () => {
    const { draft, a, b, c, t } = scene()
    // B would hit C at 6 s after moving 2 s; asking for 5 s stops there.
    const moved = moveSegments(draft, [a, b, t], a, 5_000_000)
    expect(start(moved, b)).toBe(4_000_000)
    expect(start(moved, a)).toBe(2_000_000)
    expect(start(moved, t)).toBe(3_000_000)
    expect(start(moved, c)).toBe(6_000_000)
    expectOnGrid(moved)
  })

  it('stops the whole group at the start of the timeline', () => {
    const { draft, b, t } = scene()
    // The text clip starts at 1 s, so the group can only go 1 s left... but A
    // is in B's way after 0 s of travel, so nothing moves.
    expect(moveSegments(draft, [b, t], b, 0)).toBe(draft)

    const { draft: d2, c, t: t2 } = scene()
    const moved = moveSegments(d2, [c, t2], c, 0)
    expect(start(moved, t2)).toBe(0)
    expect(start(moved, c)).toBe(5_000_000)
  })

  it('does nothing without a real move', () => {
    const { draft, a, b } = scene()
    expect(moveSegments(draft, [a, b], a, 0)).toBe(draft)
    expect(moveSegments(draft, [a], b, 3_000_000)).toBe(draft)
  })

  it('updates the draft duration', () => {
    const { draft, c } = scene()
    expect(moveSegments(draft, [c], c, 10_000_000).duration).toBe(12_000_000)
  })
})

describe('removeSegments', () => {
  it('removes several clips and their unused materials in one step', () => {
    const { draft, a, c, t } = scene()
    const next = removeSegments(draft, [a, c, t])
    expect(next.tracks.flatMap((track) => track.segments)).toHaveLength(1)
    expect(next.materials.videos).toHaveLength(1)
    expect(next.materials.texts).toHaveLength(0)
    expect(next.duration).toBe(4_000_000)
  })

  it('does nothing for ids that are not there', () => {
    const { draft } = scene()
    expect(removeSegments(draft, ['nope'])).toBe(draft)
  })
})
