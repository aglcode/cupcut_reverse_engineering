import { describe, expect, it } from 'vitest'
import { resolveFrame, type MediaLayer } from '../engine/resolve'
import { FULL_CROP } from './crop'
import { addMedia, moveSegment, splitSegment, trimSegment } from './ops'
import { effectiveTransition, setTransition, transitionFx, visibleSpan } from './transitions'
import { emptyDraft, newId, type Draft, type TransitionName, type VideoMaterial } from './types'

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

// Two 4 s clips back to back, each showing the middle 4 s of a 10 s source,
// with a 1 s transition between them (so it runs from 3.5 s to 4.5 s).
function pair(name: TransitionName = 'Mix') {
  let draft = emptyDraft()
  const ids: string[] = []
  for (const at of [0, 4_000_000]) {
    const added = addMedia(draft, video(10), at)
    draft = trimSegment(added.draft, added.segmentId, 'end', at + 7_000_000)
    draft = trimSegment(draft, added.segmentId, 'start', at + 3_000_000)
    draft = moveSegment(draft, added.segmentId, at)
    ids.push(added.segmentId)
  }
  draft = setTransition(draft, ids[0], { name, duration: 1_000_000 })
  return { draft, a: ids[0], b: ids[1] }
}

const media = (draft: Draft, t: number) =>
  resolveFrame(draft, t).visual.filter((l): l is MediaLayer => l.kind === 'media')

describe('effectiveTransition', () => {
  it('is centred on the cut', () => {
    const { draft } = pair()
    expect(effectiveTransition(draft.tracks[0], 0)).toEqual({
      name: 'Mix',
      from: 3_500_000,
      to: 4_500_000,
      cut: 4_000_000,
    })
  })

  it('leaves the clips butted together on the timeline', () => {
    const { draft } = pair()
    const [first, second] = draft.tracks[0].segments
    expect(first.target_timerange).toEqual({ start: 0, duration: 4_000_000 })
    expect(second.target_timerange).toEqual({ start: 4_000_000, duration: 4_000_000 })
    expect(draft.duration).toBe(8_000_000)
  })

  it('does nothing when the next clip is not adjacent', () => {
    const { draft, b } = pair()
    const apart = moveSegment(draft, b, 5_000_000)
    expect(effectiveTransition(apart.tracks[0], 0)).toBeNull()
    expect(visibleSpan(apart.tracks[0], 0)).toEqual({ from: 0, to: 4_000_000 })
  })

  it('does nothing on the last clip', () => {
    const { draft, b } = pair()
    const both = setTransition(draft, b, { name: 'Mix', duration: 1_000_000 })
    expect(effectiveTransition(both.tracks[0], 1)).toBeNull()
  })

  it('never covers more than half of either clip', () => {
    const { draft, a } = pair()
    const long = setTransition(draft, a, { name: 'Mix', duration: 60_000_000 })
    expect(effectiveTransition(long.tracks[0], 0)).toMatchObject({ from: 2_000_000, to: 6_000_000 })
  })

  it('moves to the right half when the clip is split', () => {
    const { draft, a } = pair()
    const split = splitSegment(draft, a, 2_000_000)
    const [left, right] = split.tracks[0].segments
    expect(left.transition).toBeNull()
    expect(right.transition).toEqual({ name: 'Mix', duration: 1_000_000 })
    expect(effectiveTransition(split.tracks[0], 1)).toMatchObject({ cut: 4_000_000 })
  })
})

describe('rendering', () => {
  it('shows one clip outside the transition', () => {
    const { draft, a, b } = pair()
    expect(media(draft, 1_000_000).map((l) => [l.segment.id, l.fx])).toEqual([[a, null]])
    expect(media(draft, 6_000_000).map((l) => [l.segment.id, l.fx])).toEqual([[b, null]])
  })

  it('shows both clips during it, outgoing first', () => {
    const { draft, a, b } = pair()
    const before = media(draft, 3_750_000)
    expect(before.map((l) => l.segment.id)).toEqual([a, b])
    expect(before[1].fx?.alpha).toBeCloseTo(0.25)
    const after = media(draft, 4_250_000)
    expect(after.map((l) => l.segment.id)).toEqual([a, b])
    expect(after[1].fx?.alpha).toBeCloseTo(0.75)
  })

  it('plays each clip past its edge using the rest of its source', () => {
    const { draft } = pair()
    // Both clips show source 3 s - 7 s. The incoming one starts 0.5 s early,
    // the outgoing one runs 0.5 s late.
    const [, incoming] = media(draft, 3_500_000)
    expect(incoming.sourceUs).toBe(2_500_000)
    const [outgoing] = media(draft, 4_400_000)
    expect(outgoing.sourceUs).toBe(7_400_000)
  })

  it('holds the first or last frame where the source runs out', () => {
    let draft = emptyDraft()
    const first = addMedia(draft, video(4), 0)
    const second = addMedia(first.draft, video(4), 4_000_000)
    draft = setTransition(second.draft, first.segmentId, { name: 'Mix', duration: 1_000_000 })
    const [outgoing, incoming] = media(draft, 3_600_000)
    expect(incoming.sourceUs).toBe(0)
    expect(outgoing.sourceUs).toBe(3_600_000)
    expect(media(draft, 4_400_000)[0].sourceUs).toBe(3_999_999)
  })
})

describe('transitionFx', () => {
  it('Mix fades the incoming clip in over the outgoing one', () => {
    expect(transitionFx('Mix', 'out', 0.3)).toEqual({ alpha: 1, reveal: null, offsetX: 0 })
    expect(transitionFx('Mix', 'in', 0.3).alpha).toBeCloseTo(0.3)
  })

  it('Fade goes through black at the midpoint', () => {
    expect(transitionFx('Fade', 'out', 0.25).alpha).toBeCloseTo(0.5)
    expect(transitionFx('Fade', 'out', 0.5).alpha).toBe(0)
    expect(transitionFx('Fade', 'in', 0.5).alpha).toBe(0)
    expect(transitionFx('Fade', 'in', 0.75).alpha).toBeCloseTo(0.5)
  })

  it('Wipe reveals the incoming clip from the left', () => {
    expect(transitionFx('Wipe', 'in', 0.4).reveal).toBeCloseTo(0.4)
  })

  it('Slide brings the incoming clip in from the right', () => {
    expect(transitionFx('Slide', 'in', 0).offsetX).toBe(1)
    expect(transitionFx('Slide', 'in', 1).offsetX).toBe(0)
  })
})
