import { describe, expect, it } from 'vitest'
import { copySegments, duplicateSegments } from './clipboard'
import { FULL_CROP, isCropped, setCrop } from './crop'
import { setKeyframes } from './keyframes'
import { linkedIds } from './links'
import {
  addMedia,
  addText,
  extractAudio,
  findSegment,
  pasteSegments,
  patchText,
  removeSegments,
  setMagnet,
  trimSegment,
} from './ops'
import { frameToUs, usToFrame } from './time'
import { emptyDraft, newId, segmentEnd, type Draft, type VideoMaterial } from './types'

const video = (seconds: number, path = 'clip.mp4'): VideoMaterial => ({
  id: newId(),
  type: 'video',
  path,
  duration: seconds * 1_000_000,
  width: 1920,
  height: 1080,
  has_audio: true,
  crop: { ...FULL_CROP },
})

const seg = (draft: Draft, id: string) => findSegment(draft, id)!.segment
const where = (draft: Draft, id: string) => {
  const loc = findSegment(draft, id)!
  const { start, duration } = loc.segment.target_timerange
  return { track: loc.track.name, from: start / 1e6, to: (start + duration) / 1e6 }
}
const materialOf = (draft: Draft, id: string) =>
  [...draft.materials.videos, ...draft.materials.audios, ...draft.materials.texts].find(
    (m) => m.id === seg(draft, id).material_id,
  )!

function expectTidy(draft: Draft) {
  for (const track of draft.tracks) {
    let cursor = 0
    for (const s of track.segments) {
      const from = s.target_timerange.start
      expect(frameToUs(usToFrame(from, draft.fps), draft.fps)).toBe(from)
      expect(from).toBeGreaterThanOrEqual(cursor)
      cursor = segmentEnd(s)
    }
  }
  const ids = draft.tracks.flatMap((t) => t.segments.map((s) => s.id))
  expect(new Set(ids).size).toBe(ids.length)
}

// Magnet off. Video 1: A at 0-2 s. Text 1: a title at 1-4 s.
function scene() {
  const a = addMedia(emptyDraft(), video(2), 0)
  const t = addText(a.draft, 'Title', 1_000_000)
  return { draft: t.draft, a: a.segmentId, t: t.segmentId }
}

describe('copySegments', () => {
  it('is not affected by later edits to the project', () => {
    const { draft, a } = scene()
    const copied = copySegments(draft, [a])!
    const trimmed = trimSegment(draft, a, 'end', 1_000_000)
    expect(seg(trimmed, a).target_timerange.duration).toBe(1_000_000)
    expect(copied.items[0].segment.target_timerange.duration).toBe(2_000_000)
  })

  it('has nothing to copy without a selection', () => {
    const { draft } = scene()
    expect(copySegments(draft, [])).toBeNull()
    expect(copySegments(draft, ['nope'])).toBeNull()
  })
})

describe('pasteSegments', () => {
  it('pastes at the given time and leaves the original alone', () => {
    const { draft, a } = scene()
    const pasted = pasteSegments(draft, copySegments(draft, [a])!, 5_000_000)!
    const [copy] = pasted.segmentIds
    expect(copy).not.toBe(a)
    expect(where(pasted.draft, copy)).toEqual({ track: 'Video 1', from: 5, to: 7 })
    expect(where(pasted.draft, a)).toEqual({ track: 'Video 1', from: 0, to: 2 })
    expect(pasted.draft.duration).toBe(7_000_000)
    expectTidy(pasted.draft)
  })

  it('keeps the spacing between clips on different tracks', () => {
    const { draft, a, t } = scene()
    const pasted = pasteSegments(draft, copySegments(draft, [a, t])!, 10_000_000)!
    const [videoCopy, textCopy] = pasted.segmentIds
    expect(where(pasted.draft, videoCopy)).toEqual({ track: 'Video 1', from: 10, to: 12 })
    expect(where(pasted.draft, textCopy)).toEqual({ track: 'Text 1', from: 11, to: 14 })
  })

  it('uses another track when the original one is occupied there', () => {
    const { draft, a } = scene()
    // Pasting on top of the original: the copy cannot share its track.
    const pasted = pasteSegments(draft, copySegments(draft, [a])!, 500_000)!
    const copy = where(pasted.draft, pasted.segmentIds[0])
    expect(copy.track).not.toBe('Video 1')
    expect([copy.from, copy.to]).toEqual([0.5, 2.5])
    expect(pasted.draft.tracks.filter((track) => track.type === 'video')).toHaveLength(2)
    // A second paste in the same place needs a third track.
    const again = pasteSegments(pasted.draft, copySegments(draft, [a])!, 500_000)!
    expect(again.draft.tracks.filter((track) => track.type === 'video')).toHaveLength(3)
    expectTidy(again.draft)
  })

  it('gives the pasted clip its own material', () => {
    const { draft, a, t } = scene()
    const pasted = pasteSegments(draft, copySegments(draft, [a, t])!, 10_000_000)!
    const [videoCopy, textCopy] = pasted.segmentIds
    expect(seg(pasted.draft, videoCopy).material_id).not.toBe(seg(pasted.draft, a).material_id)

    const cropped = setCrop(pasted.draft, videoCopy, { left: 0.5 })
    expect(isCropped((materialOf(cropped, videoCopy) as VideoMaterial).crop)).toBe(true)
    expect(isCropped((materialOf(cropped, a) as VideoMaterial).crop)).toBe(false)

    const retyped = patchText(pasted.draft, seg(pasted.draft, textCopy).material_id, { content: 'Changed' })
    expect(materialOf(retyped, t)).toMatchObject({ content: 'Title' })
    expect(materialOf(retyped, textCopy)).toMatchObject({ content: 'Changed' })
  })

  it('carries keyframes, speed and the rest of the clip across', () => {
    const { draft, a } = scene()
    const keyed = setKeyframes(draft, a, { KFTypeAlpha: 0.3 }, 1_000_000)
    const pasted = pasteSegments(keyed, copySegments(keyed, [a])!, 5_000_000)!
    const copy = seg(pasted.draft, pasted.segmentIds[0])
    const original = seg(pasted.draft, a)
    expect(copy.source_timerange).toEqual(original.source_timerange)
    expect(copy.common_keyframes[0].keyframe_list[0].values).toEqual([0.3])
    expect(copy.common_keyframes[0].id).not.toBe(original.common_keyframes[0].id)
  })

  it('links pasted clips to each other, not to the originals', () => {
    const added = addMedia(emptyDraft(), video(4), 0)
    const made = extractAudio(added.draft, added.segmentId)!
    const pair = [added.segmentId, made.segmentId]
    const pasted = pasteSegments(made.draft, copySegments(made.draft, pair)!, 6_000_000)!
    const [videoCopy, audioCopy] = pasted.segmentIds
    expect(linkedIds(pasted.draft, videoCopy).sort()).toEqual([videoCopy, audioCopy].sort())
    expect(linkedIds(pasted.draft, added.segmentId).sort()).toEqual(pair.sort())
  })

  it('does not leave a half-link when one clip of a pair is pasted alone', () => {
    const added = addMedia(emptyDraft(), video(4), 0)
    const made = extractAudio(added.draft, added.segmentId)!
    const pasted = pasteSegments(made.draft, copySegments(made.draft, [made.segmentId])!, 6_000_000)!
    expect(seg(pasted.draft, pasted.segmentIds[0]).group_id).toBe('')
  })

  it('can paste more than once from one copy, and into another project', () => {
    const { draft, a } = scene()
    const copied = copySegments(draft, [a])!
    const once = pasteSegments(draft, copied, 5_000_000)!
    const twice = pasteSegments(once.draft, copied, 8_000_000)!
    expect(twice.segmentIds[0]).not.toBe(once.segmentIds[0])
    expectTidy(twice.draft)

    const elsewhere = pasteSegments(emptyDraft(), copied, 1_000_000)!
    expect(where(elsewhere.draft, elsewhere.segmentIds[0])).toEqual({ track: 'Video 1', from: 1, to: 3 })
    expect(elsewhere.draft.materials.videos).toHaveLength(1)
  })

  it('does nothing with an empty clipboard', () => {
    const { draft } = scene()
    expect(pasteSegments(draft, { origin: 0, items: [] }, 0)).toBeNull()
  })
})

describe('cut', () => {
  it('removes the clips and paste puts them back', () => {
    const { draft, a, t } = scene()
    const copied = copySegments(draft, [a, t])!
    const cut = removeSegments(draft, [a, t])
    expect(cut.duration).toBe(0)
    expect(cut.materials.videos).toHaveLength(0)
    const pasted = pasteSegments(cut, copied, 0)!
    expect(where(pasted.draft, pasted.segmentIds[0])).toEqual({ track: 'Video 1', from: 0, to: 2 })
    expect(where(pasted.draft, pasted.segmentIds[1])).toEqual({ track: 'Text 1', from: 1, to: 4 })
    expect(pasted.draft.materials.videos).toHaveLength(1)
  })
})

describe('duplicateSegments', () => {
  it('puts the copy straight after the selection', () => {
    const { draft, a } = scene()
    const made = duplicateSegments(draft, [a])!
    expect(where(made.draft, made.segmentIds[0])).toEqual({ track: 'Video 1', from: 2, to: 4 })
  })

  it('duplicates several clips after the last of them', () => {
    const { draft, a, t } = scene()
    const made = duplicateSegments(draft, [a, t])!
    // The selection ends at 4 s, so the copies start there with the same 1 s offset.
    expect(where(made.draft, made.segmentIds[0])).toEqual({ track: 'Video 1', from: 4, to: 6 })
    expect(where(made.draft, made.segmentIds[1])).toEqual({ track: 'Text 1', from: 5, to: 8 })
  })

  it('has nothing to duplicate without a selection', () => {
    expect(duplicateSegments(scene().draft, [])).toBeNull()
  })
})

describe('with the main-track magnet on', () => {
  // A, B, C (2 s each) packed on the main track.
  function packed() {
    let draft = setMagnet(emptyDraft(), true)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const added = addMedia(draft, video(10, `${i}.mp4`), draft.duration)
      draft = trimSegment(added.draft, added.segmentId, 'end', draft.duration + 2_000_000)
      ids.push(added.segmentId)
    }
    const [a, b, c] = ids
    return { draft, a, b, c }
  }
  const order = (draft: Draft) => draft.tracks.find((t) => t.type === 'video')!.segments.map((s) => s.id)

  it('slots a pasted main-track clip in at the nearest cut and moves the rest along', () => {
    const { draft, a, b, c } = packed()
    // Playhead in the second half of A: the copy goes between A and B.
    const pasted = pasteSegments(draft, copySegments(draft, [c])!, 1_500_000)!
    const [copy] = pasted.segmentIds
    expect(order(pasted.draft)).toEqual([a, copy, b, c])
    expect(where(pasted.draft, copy)).toMatchObject({ from: 2, to: 4 })
    expect(where(pasted.draft, c)).toMatchObject({ from: 6, to: 8 })
    expect(pasted.draft.tracks.filter((t) => t.type === 'video')).toHaveLength(1)
    expectTidy(pasted.draft)
  })

  it('pastes several main-track clips in order', () => {
    const { draft, a, b, c } = packed()
    const pasted = pasteSegments(draft, copySegments(draft, [a, b])!, 6_000_000)!
    expect(order(pasted.draft)).toEqual([a, b, c, ...pasted.segmentIds])
    expect(pasted.draft.duration).toBe(10_000_000)
  })

  it('duplicates a main-track clip right after itself', () => {
    const { draft, a, b, c } = packed()
    const made = duplicateSegments(draft, [a])!
    expect(order(made.draft)).toEqual([a, made.segmentIds[0], b, c])
  })

  it('keeps pasted linked audio under its pasted video', () => {
    const { draft, b } = packed()
    const made = extractAudio(draft, b)!
    const copied = copySegments(made.draft, [b, made.segmentId])!
    // Pasted with the playhead part-way into C: the video snaps to a cut, and
    // the audio has to land in the same place rather than at the playhead.
    const pasted = pasteSegments(made.draft, copied, 5_500_000)!
    const [videoCopy, audioCopy] = pasted.segmentIds
    expect(where(pasted.draft, videoCopy)).toMatchObject({ from: 6, to: 8 })
    expect(where(pasted.draft, audioCopy)).toMatchObject({ from: 6, to: 8 })
    // And the original pair is still together.
    expect(where(pasted.draft, made.segmentId)).toMatchObject({ from: 2, to: 4 })
    expectTidy(pasted.draft)
  })

  it('cut closes the main track and paste reopens it', () => {
    const { draft, a, b, c } = packed()
    const copied = copySegments(draft, [b])!
    const cut = removeSegments(draft, [b])
    expect(where(cut, c)).toMatchObject({ from: 2, to: 4 })
    const pasted = pasteSegments(cut, copied, 0)!
    expect(order(pasted.draft)).toEqual([pasted.segmentIds[0], a, c])
  })

  it('never puts an overlay clip into the packed main track', () => {
    const { draft } = packed()
    const title = addText(draft, 'Title', 0)
    const overlay = addMedia(setMagnet(title.draft, false), video(2, 'o.mp4'), 0)
    const on = setMagnet(overlay.draft, true)
    const pasted = pasteSegments(on, copySegments(on, [overlay.segmentId])!, 3_000_000)!
    expect(where(pasted.draft, pasted.segmentIds[0]).track).not.toBe('Video 1')
    expect(where(pasted.draft, pasted.segmentIds[0])).toMatchObject({ from: 3, to: 5 })
  })
})
