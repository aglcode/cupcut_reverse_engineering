import { describe, expect, it } from 'vitest'
import { copySegments } from './clipboard'
import { FULL_CROP } from './crop'
import {
  addMarker,
  clipMarkers,
  neighbourMarker,
  placedMarkers,
  removeMarker,
  toggleMarker,
} from './markers'
import {
  addMedia,
  addText,
  findSegment,
  moveSegment,
  pasteSegments,
  setReverse,
  setSpeed,
  splitSegment,
  trimSegment,
} from './ops'
import { snapMove, snapTargets, snapTime } from './snap'
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
const times = (draft: Draft) => placedMarkers(draft).map((m) => m.time / 1e6)

// A 10 s clip at 2 s on the timeline.
function clip() {
  const added = addMedia(emptyDraft(), video(10), 2_000_000)
  return { draft: added.draft, id: added.segmentId }
}

describe('timeline markers', () => {
  it('adds, numbers and sorts them', () => {
    let draft = addMarker(emptyDraft(), 5_000_000)
    draft = addMarker(draft, 1_000_000)
    expect(draft.time_marks.map((m) => [m.title, m.time_range.start])).toEqual([
      ['Marker 02', 1_000_000],
      ['Marker 01', 5_000_000],
    ])
    expect(draft.time_marks[0]).toMatchObject({ color: '#00c1cd', time_range: { duration: 0 } })
  })

  it('snaps to the frame grid and does not double up on a frame', () => {
    const once = addMarker(emptyDraft(), 1_010_000)
    expect(once.time_marks[0].time_range.start).toBe(1_000_000)
    expect(addMarker(once, 1_000_000)).toBe(once)
  })

  it('toggles', () => {
    const on = toggleMarker(emptyDraft(), 3_000_000)
    expect(times(on)).toEqual([3])
    expect(times(toggleMarker(on, 3_000_000))).toEqual([])
  })

  it('removes by id', () => {
    const draft = addMarker(addMarker(emptyDraft(), 1_000_000), 2_000_000)
    expect(times(removeMarker(draft, draft.time_marks[0].id))).toEqual([2])
    expect(removeMarker(draft, 'nope')).toBe(draft)
  })
})

describe('clip markers', () => {
  it('go on the clip when the time is inside it, on the timeline when not', () => {
    const { draft, id } = clip()
    const onClip = addMarker(draft, 5_000_000, id)
    expect(seg(onClip, id).time_marks).toHaveLength(1)
    expect(onClip.time_marks).toHaveLength(0)
    const outside = addMarker(draft, 500_000, id)
    expect(seg(outside, id).time_marks).toHaveLength(0)
    expect(outside.time_marks).toHaveLength(1)
  })

  it('are stored in source time, as CapCut stores them', () => {
    const { draft, id } = clip()
    // 5 s on the timeline is 3 s into a clip that starts at 2 s.
    const marked = addMarker(draft, 5_000_000, id)
    expect(seg(marked, id).time_marks[0].time_range.start).toBe(3_000_000)
    expect(times(marked)).toEqual([5])
  })

  it('travel with the clip when it moves', () => {
    const { draft, id } = clip()
    const marked = addMarker(draft, 5_000_000, id)
    expect(times(moveSegment(marked, id, 20_000_000))).toEqual([23])
  })

  it('stay on the same moment of the footage when the clip is trimmed', () => {
    const { draft, id } = clip()
    const marked = addMarker(draft, 5_000_000, id)
    const trimmed = trimSegment(marked, id, 'start', 4_000_000)
    expect(times(trimmed)).toEqual([5])
    // Trimmed past it, the marker is hidden rather than lost.
    const past = trimSegment(marked, id, 'start', 6_000_000)
    expect(times(past)).toEqual([])
    expect(times(trimSegment(past, id, 'start', 2_000_000))).toEqual([5])
  })

  it('follow speed and direction changes', () => {
    const { draft, id } = clip()
    const marked = addMarker(draft, 5_000_000, id)
    expect(times(setSpeed(marked, id, 2))).toEqual([3.5])
    // Reversed, 3 s into a 10 s source plays 7 s after the clip starts.
    expect(times(setReverse(marked, id, true))).toEqual([9])
  })

  it('show on whichever half has that moment after a split', () => {
    const { draft, id } = clip()
    const marked = addMarker(draft, 5_000_000, id)
    const split = splitSegment(marked, id, 8_000_000)
    const [left, right] = split.tracks[0].segments
    expect(clipMarkers(left).map((m) => m.time)).toEqual([5_000_000])
    expect(clipMarkers(right)).toEqual([])
    expect(times(split)).toEqual([5])
  })

  it('on text, count from the clip start and survive a head trim', () => {
    const added = addText(emptyDraft(), 'Title', 1_000_000)
    const marked = addMarker(added.draft, 2_000_000, added.segmentId)
    expect(seg(marked, added.segmentId).time_marks[0].time_range.start).toBe(1_000_000)
    expect(times(trimSegment(marked, added.segmentId, 'start', 1_500_000))).toEqual([2])
  })

  it('are copied with the clip, with ids of their own', () => {
    const { draft, id } = clip()
    const marked = addMarker(draft, 5_000_000, id)
    const pasted = pasteSegments(marked, copySegments(marked, [id])!, 20_000_000)!
    const copy = seg(pasted.draft, pasted.segmentIds[0])
    expect(times(pasted.draft)).toEqual([5, 23])
    expect(copy.time_marks[0].id).not.toBe(seg(marked, id).time_marks[0].id)
  })

  it('toggle off again on the clip', () => {
    const { draft, id } = clip()
    const marked = toggleMarker(draft, 5_000_000, id)
    expect(seg(toggleMarker(marked, 5_000_000, id), id).time_marks).toEqual([])
  })
})

describe('moving between markers', () => {
  it('finds the next and the previous one', () => {
    const { draft, id } = clip()
    let marked = addMarker(draft, 1_000_000)
    marked = addMarker(marked, 5_000_000, id)
    marked = addMarker(marked, 9_000_000)
    expect(neighbourMarker(marked, 1_000_000, 1)).toBe(5_000_000)
    expect(neighbourMarker(marked, 5_000_000, -1)).toBe(1_000_000)
    expect(neighbourMarker(marked, 9_000_000, 1)).toBeNull()
    expect(neighbourMarker(marked, 0, -1)).toBeNull()
  })
})

describe('snapping', () => {
  it('collects the playhead, markers and the edges of other clips', () => {
    const { draft, id } = clip()
    const other = addMedia(draft, video(3), 20_000_000)
    const marked = addMarker(addMarker(other.draft, 15_000_000), 5_000_000, id)
    const targets = snapTargets(marked, 7_000_000, [other.segmentId]).sort((a, b) => a - b)
    // 0, the clip's marker and edges, the playhead, the timeline marker; not
    // the moving clip's own edges at 20 s and 23 s.
    expect(targets).toEqual([0, 2_000_000, 5_000_000, 7_000_000, 12_000_000, 15_000_000])
  })

  it('leaves out the markers of a clip that is being moved', () => {
    const { draft, id } = clip()
    const marked = addMarker(draft, 5_000_000, id)
    expect(snapTargets(marked, 0, [id])).toEqual([0])
  })

  it('snaps a time to the nearest target in reach', () => {
    expect(snapTime(980, [0, 1000, 1030], 50)).toEqual({ time: 1000, target: 1000 })
    expect(snapTime(900, [0, 1000], 50)).toBeNull()
  })

  it('snaps a moved clip by whichever end is nearer', () => {
    // A 500-long clip wanting to start at 480: its end (980) is 20 from 1000,
    // its start is 480 from 0. The end wins, so it starts at 500.
    expect(snapMove(480, 500, [0, 1000], 50)).toEqual({ time: 500, target: 1000 })
    // Wanting to start at 30: the start is 30 from 0, the end 470 from 1000.
    expect(snapMove(30, 500, [0, 1000], 50)).toEqual({ time: 0, target: 0 })
    expect(snapMove(200, 500, [0, 1000], 50)).toBeNull()
  })
})
