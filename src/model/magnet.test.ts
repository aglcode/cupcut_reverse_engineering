import { describe, expect, it } from 'vitest'
import { sourceTime } from '../engine/resolve'
import { FULL_CROP } from './crop'
import {
  addMedia,
  addText,
  addTrack,
  findSegment,
  freezeFrame,
  moveSegment,
  removeSegment,
  removeTrack,
  rippleDelete,
  setMagnet,
  setSpeed,
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

const range = (draft: Draft, id: string) => {
  const { start, duration } = findSegment(draft, id)!.segment.target_timerange
  return [start / 1e6, (start + duration) / 1e6]
}

// What every CapCut draft's main track looks like: from zero, no gaps.
function expectPacked(draft: Draft) {
  let cursor = 0
  for (const s of draft.tracks.find((t) => t.type === 'video')!.segments) {
    expect(s.target_timerange.start).toBe(cursor)
    expect(frameToUs(usToFrame(segmentEnd(s), draft.fps), draft.fps)).toBe(segmentEnd(s))
    cursor = segmentEnd(s)
  }
}

// Magnet on, three 2 s clips A, B, C on the main track.
function packed() {
  let draft = setMagnet(emptyDraft(), true)
  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    const added = addMedia(draft, video(10), draft.duration)
    draft = trimSegment(added.draft, added.segmentId, 'end', draft.duration + 2_000_000)
    ids.push(added.segmentId)
  }
  const [a, b, c] = ids
  return { draft, a, b, c }
}

const order = (draft: Draft) => draft.tracks.find((t) => t.type === 'video')!.segments.map((s) => s.id)

describe('main-track magnet', () => {
  it('closes existing gaps when switched on', () => {
    const first = addMedia(emptyDraft(), video(2), 1_000_000)
    const second = addMedia(first.draft, video(2), 5_000_000)
    expect(range(second.draft, second.segmentId)).toEqual([5, 7])
    const on = setMagnet(second.draft, true)
    expect(range(on, first.segmentId)).toEqual([0, 2])
    expect(range(on, second.segmentId)).toEqual([2, 4])
    expect(on.duration).toBe(4_000_000)
    expectPacked(on)
  })

  it('leaves the timeline alone when switched off', () => {
    const { draft, b } = packed()
    const off = setMagnet(draft, false)
    const moved = moveSegment(off, b, 10_000_000)
    expect(range(moved, b)).toEqual([10, 12])
  })

  it('starts from a packed track', () => {
    const { draft, a, b, c } = packed()
    expect([range(draft, a), range(draft, b), range(draft, c)]).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ])
    expectPacked(draft)
  })

  it('adds new clips to the main track instead of a new track', () => {
    const { draft } = packed()
    const added = addMedia(draft, video(1), 1_500_000)
    expect(added.draft.tracks.filter((t) => t.type === 'video')).toHaveLength(1)
    expectPacked(added.draft)
  })

  it('slots a new clip in at the cut nearest the playhead', () => {
    const { draft, a, b } = packed()
    // Playhead in the second half of A: the clip goes between A and B.
    const after = addMedia(draft, video(1), 1_500_000)
    expect(order(after.draft).slice(0, 3)).toEqual([a, after.segmentId, b])
    expect(range(after.draft, b)).toEqual([3, 5])
    // Playhead in the first half of A: it goes in front.
    const before = addMedia(draft, video(1), 500_000)
    expect(order(before.draft)[0]).toBe(before.segmentId)
    expect(range(before.draft, a)).toEqual([1, 3])
  })

  it('closes the gap when a clip is removed', () => {
    const { draft, a, b, c } = packed()
    const next = removeSegment(draft, b)
    expect(range(next, a)).toEqual([0, 2])
    expect(range(next, c)).toEqual([2, 4])
    expectPacked(next)
  })

  it('does not touch other tracks', () => {
    const { draft, a } = packed()
    const text = addText(draft, 'Title', 3_000_000)
    const next = removeSegment(text.draft, a)
    expect(range(next, text.segmentId)).toEqual([3, 6])
  })

  it('reorders when the leading edge of a clip passes the middle of its neighbour', () => {
    const { draft, a, b, c } = packed()
    // Dragged right, A's end at 2.9 s is short of B's middle (3 s): nothing happens.
    expect(moveSegment(draft, a, 900_000)).toBe(draft)
    // At 3.1 s it has passed it: A and B swap.
    const swapped = moveSegment(draft, a, 1_100_000)
    expect(order(swapped)).toEqual([b, a, c])
    expect(range(swapped, b)).toEqual([0, 2])
    expect(range(swapped, a)).toEqual([2, 4])
    expectPacked(swapped)
    // Dragged far right it goes to the end.
    expect(order(moveSegment(draft, a, 30_000_000))).toEqual([b, c, a])
  })

  it('goes by the start of the clip when dragged left', () => {
    const { draft, a, b, c } = packed()
    // C's start at 3.1 s has not reached B's middle (3 s) yet.
    expect(moveSegment(draft, c, 3_100_000)).toBe(draft)
    expect(order(moveSegment(draft, c, 2_900_000))).toEqual([a, c, b])
    expect(order(moveSegment(draft, c, 0))).toEqual([c, a, b])
  })

  it('lets a long clip be dragged in front of a short first clip', () => {
    const { draft, a, b, c } = packed()
    const long = trimSegment(draft, c, 'end', 12_000_000)
    expect(order(moveSegment(long, c, 0))).toEqual([c, a, b])
  })

  it('packs the main track when a clip leaves it and slots one in when it arrives', () => {
    const { draft, a, b, c } = packed()
    const twoTracks = addTrack(draft, 'video')
    const overlay = twoTracks.tracks[twoTracks.tracks.length - 1].id
    const main = twoTracks.tracks.find((t) => t.type === 'video')!.id

    const lifted = moveSegment(twoTracks, b, 7_000_000, overlay)
    expect(range(lifted, b)).toEqual([7, 9])
    expect(range(lifted, c)).toEqual([2, 4])
    expectPacked(lifted)

    // Dropped back with its middle over the first half of A: it goes in front.
    const dropped = moveSegment(lifted, b, 0, main)
    expect(order(dropped)).toEqual([b, a, c])
    expectPacked(dropped)
  })

  it('pulls later clips in when a clip is shortened', () => {
    const { draft, a, b, c } = packed()
    const next = trimSegment(draft, a, 'end', 1_000_000)
    expect([range(next, a), range(next, b), range(next, c)]).toEqual([
      [0, 1],
      [1, 3],
      [3, 5],
    ])
  })

  it('pushes later clips along when a clip is lengthened', () => {
    const { draft, a, b, c } = packed()
    const next = trimSegment(draft, a, 'end', 3_500_000)
    expect([range(next, a), range(next, b), range(next, c)]).toEqual([
      [0, 3.5],
      [3.5, 5.5],
      [5.5, 7.5],
    ])
    expectPacked(next)
  })

  it('trims the head of a clip in place', () => {
    const { draft, b, c } = packed()
    const next = trimSegment(draft, b, 'start', 2_500_000)
    // B loses its first half second and stays against A; C follows.
    expect(range(next, b)).toEqual([2, 3.5])
    expect(range(next, c)).toEqual([3.5, 5.5])
    expect(sourceTime(findSegment(next, b)!.segment, 2_000_000)).toBe(500_000)
  })

  it('pushes later clips along when a clip is slowed down', () => {
    const { draft, a, b } = packed()
    const next = setSpeed(draft, a, 0.5)
    expect(range(next, a)).toEqual([0, 4])
    expect(range(next, b)).toEqual([4, 6])
    expectPacked(next)
  })

  it('stays packed after a freeze frame', () => {
    const { draft, a } = packed()
    const made = freezeFrame(draft, a, 1_000_000)!
    expect(made.draft.duration).toBe(9_000_000)
    expectPacked(made.draft)
  })

  it('does not let the main track be removed', () => {
    const { draft } = packed()
    const two = addTrack(draft, 'video')
    const main = two.tracks.find((t) => t.type === 'video')!.id
    expect(removeTrack(two, main)).toBe(two)
    expect(removeTrack(setMagnet(two, false), main).tracks.some((t) => t.id === main)).toBe(false)
  })
})

describe('rippleDelete', () => {
  // Magnet off. Video: A 0-2, B 3-5, C 6-8. Text above at 4-7.
  function scene() {
    const a = addMedia(emptyDraft(), video(2), 0)
    const b = addMedia(a.draft, video(2), 3_000_000)
    const c = addMedia(b.draft, video(2), 6_000_000)
    const t = addText(c.draft, 'Title', 4_000_000)
    return { draft: t.draft, a: a.segmentId, b: b.segmentId, c: c.segmentId, t: t.segmentId }
  }

  it('moves later clips on that track earlier by the removed length', () => {
    const { draft, a, b, c } = scene()
    const next = rippleDelete(draft, [b])
    expect(range(next, a)).toEqual([0, 2])
    expect(range(next, c)).toEqual([4, 6])
    expect(findSegment(next, b)).toBeNull()
  })

  it('keeps the gaps that were there before', () => {
    const { draft, a, c } = scene()
    // Removing A (2 s long) shifts by 2 s; the 1 s gaps between clips remain.
    const next = rippleDelete(draft, [a])
    expect(range(next, c)).toEqual([4, 6])
  })

  it('leaves other tracks where they are', () => {
    const { draft, b, t } = scene()
    expect(range(rippleDelete(draft, [b]), t)).toEqual([4, 7])
  })

  it('adds up several removals on one track', () => {
    const { draft, a, b, c } = scene()
    expect(range(rippleDelete(draft, [a, b]), c)).toEqual([2, 4])
  })

  it('ripples each track by its own removals', () => {
    const { draft, a, c, t } = scene()
    const later = addText(draft, 'Later', 9_000_000)
    const next = rippleDelete(later.draft, [a, t])
    expect(range(next, c)).toEqual([4, 6])
    expect(range(next, later.segmentId)).toEqual([6, 9])
  })

  it('does nothing for ids that are not there', () => {
    const { draft } = scene()
    expect(rippleDelete(draft, ['nope'])).toBe(draft)
  })
})
