import { describe, expect, it } from 'vitest'
import { audibleSegments, sourceTime } from '../engine/resolve'
import { FULL_CROP } from './crop'
import { setFade } from './fades'
import { evalProperty, isAnimated, setKeyframes } from './keyframes'
import { isOneLink, linkedIds, linkSegments, unlinkSegments } from './links'
import {
  addMedia,
  addText,
  extractAudio,
  findSegment,
  moveLinked,
  moveSegment,
  removeSegment,
  setMagnet,
  setReverse,
  setSpeed,
  splitSegment,
  trimSegment,
} from './ops'
import { emptyDraft, newId, type Draft, type VideoMaterial } from './types'

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
const range = (draft: Draft, id: string) => {
  const { start, duration } = seg(draft, id).target_timerange
  return [start / 1e6, (start + duration) / 1e6]
}

describe('extractAudio', () => {
  // A 10 s clip trimmed to its 2 s - 6 s part, sitting at 1 s on the timeline.
  function clip() {
    const added = addMedia(emptyDraft(), video(10), 1_000_000)
    let draft = trimSegment(added.draft, added.segmentId, 'end', 7_000_000)
    draft = trimSegment(draft, added.segmentId, 'start', 3_000_000)
    draft = moveSegment(draft, added.segmentId, 1_000_000)
    return { draft, id: added.segmentId }
  }

  it('makes an audio clip over the same range of the same file', () => {
    const { draft, id } = clip()
    const made = extractAudio(draft, id)!
    const audio = seg(made.draft, made.segmentId)
    expect(findSegment(made.draft, made.segmentId)!.track.type).toBe('audio')
    expect(audio.target_timerange).toEqual(seg(draft, id).target_timerange)
    expect(audio.source_timerange).toEqual({ start: 2_000_000, duration: 4_000_000 })
    // As in CapCut drafts, the audio material points at the video's own file.
    expect(made.draft.materials.audios[0]).toMatchObject({
      type: 'audio',
      name: 'Extracted-1',
      path: 'clip.mp4',
      duration: 10_000_000,
    })
  })

  it('silences the video so the sound is not heard twice', () => {
    const { draft, id } = clip()
    const made = extractAudio(draft, id)!
    expect(seg(made.draft, id).volume).toBe(0)
    const audible = audibleSegments(made.draft).map((a) => a.segment.id)
    expect(audible).toEqual([made.segmentId])
  })

  it('hands over volume, volume keyframes and fades', () => {
    const { draft, id } = clip()
    let styled = setKeyframes(draft, id, { KFTypeVolume: 0.2, KFTypeAlpha: 0.5 }, 1_000_000)
    styled = setKeyframes(styled, id, { KFTypeVolume: 1 }, 5_000_000)
    styled = setFade(styled, id, { fade_out_duration: 1_000_000 })
    const made = extractAudio(styled, id)!
    const audio = seg(made.draft, made.segmentId)
    const picture = seg(made.draft, id)
    expect(evalProperty(audio, 'KFTypeVolume', 3_000_000)).toBeCloseTo(0.6)
    expect(audio.audio_fade).toEqual({ fade_in_duration: 0, fade_out_duration: 1_000_000 })
    // The picture keeps its own keyframes and loses the sound ones.
    expect(isAnimated(picture, 'KFTypeVolume')).toBe(false)
    expect(isAnimated(picture, 'KFTypeAlpha')).toBe(true)
    expect(picture.audio_fade).toBeNull()
  })

  it('keeps speed and direction', () => {
    const { draft, id } = clip()
    const changed = setReverse(setSpeed(draft, id, 2), id, true)
    const made = extractAudio(changed, id)!
    const audio = seg(made.draft, made.segmentId)
    expect(audio.speed).toBe(2)
    expect(audio.reverse).toBe(true)
    expect(sourceTime(audio, 1_500_000)).toBe(sourceTime(seg(made.draft, id), 1_500_000))
  })

  it('links the two clips', () => {
    const { draft, id } = clip()
    const made = extractAudio(draft, id)!
    expect(linkedIds(made.draft, id).sort()).toEqual([id, made.segmentId].sort())
    expect(isOneLink(made.draft, [id, made.segmentId])).toBe(true)
  })

  it('cannot be done twice, on a photo, or on a clip with no sound', () => {
    const { draft, id } = clip()
    const made = extractAudio(draft, id)!
    expect(extractAudio(made.draft, id)).toBeNull()

    const photo = addMedia(emptyDraft(), { ...video(0), type: 'photo' }, 0)
    expect(extractAudio(photo.draft, photo.segmentId)).toBeNull()
    const mute = addMedia(emptyDraft(), { ...video(4), has_audio: false }, 0)
    expect(extractAudio(mute.draft, mute.segmentId)).toBeNull()
  })

  it('numbers the extracted clips', () => {
    const first = addMedia(emptyDraft(), video(4, 'a.mp4'), 0)
    const second = addMedia(first.draft, video(4, 'b.mp4'), 4_000_000)
    const one = extractAudio(second.draft, first.segmentId)!
    const two = extractAudio(one.draft, second.segmentId)!
    expect(two.draft.materials.audios.map((a) => a.name)).toEqual(['Extracted-1', 'Extracted-2'])
    // They do not overlap, so they share one audio track.
    expect(two.draft.tracks.filter((t) => t.type === 'audio')).toHaveLength(1)
  })
})

describe('linking', () => {
  function three() {
    const a = addMedia(emptyDraft(), video(2), 0)
    const b = addMedia(a.draft, video(2), 3_000_000)
    const t = addText(b.draft, 'Title', 1_000_000)
    return { draft: t.draft, a: a.segmentId, b: b.segmentId, t: t.segmentId }
  }

  it('an unlinked clip is linked only to itself', () => {
    const { draft, a } = three()
    expect(linkedIds(draft, a)).toEqual([a])
    expect(isOneLink(draft, [a])).toBe(false)
  })

  it('links and unlinks', () => {
    const { draft, a, b, t } = three()
    const linked = linkSegments(draft, [a, t])
    expect(linkedIds(linked, t).sort()).toEqual([a, t].sort())
    expect(linkedIds(linked, b)).toEqual([b])
    expect(isOneLink(linked, [a, t])).toBe(true)
    expect(isOneLink(linked, [a, b])).toBe(false)

    const unlinked = unlinkSegments(linked, [a])
    expect(linkedIds(unlinked, t)).toEqual([t])
  })

  it('needs at least two clips', () => {
    const { draft, a } = three()
    expect(linkSegments(draft, [a])).toBe(draft)
    expect(unlinkSegments(draft, [a])).toBe(draft)
  })

  it('moves a link together', () => {
    const { draft, a, t } = three()
    const linked = linkSegments(draft, [a, t])
    const moved = moveLinked(linked, t, 6_000_000)
    expect(range(moved, t)).toEqual([6, 9])
    expect(range(moved, a)).toEqual([5, 7])
  })

  it('pairs the halves up when linked clips are cut at the same time', () => {
    const added = addMedia(emptyDraft(), video(4), 0)
    const made = extractAudio(added.draft, added.segmentId)!
    let cut = splitSegment(made.draft, added.segmentId, 1_000_000)
    cut = splitSegment(cut, made.segmentId, 1_000_000)
    const [leftVideo, rightVideo] = cut.tracks.find((t) => t.type === 'video')!.segments
    const [leftAudio, rightAudio] = cut.tracks.find((t) => t.type === 'audio')!.segments
    expect(linkedIds(cut, leftVideo.id).sort()).toEqual([leftVideo.id, leftAudio.id].sort())
    expect(linkedIds(cut, rightVideo.id).sort()).toEqual([rightVideo.id, rightAudio.id].sort())
  })
})

describe('links and the main-track magnet', () => {
  // Magnet on. A, B, C (2 s each) packed on the main track; B's sound is
  // extracted, so its audio sits under it at 2 - 4 s.
  function scene() {
    let draft = setMagnet(emptyDraft(), true)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const added = addMedia(draft, video(10, `${i}.mp4`), draft.duration)
      draft = trimSegment(added.draft, added.segmentId, 'end', draft.duration + 2_000_000)
      ids.push(added.segmentId)
    }
    const [a, b, c] = ids
    const made = extractAudio(draft, b)!
    return { draft: made.draft, a, b, c, audio: made.segmentId }
  }

  it('starts with the audio under its video', () => {
    const { draft, b, audio } = scene()
    expect(range(draft, b)).toEqual([2, 4])
    expect(range(draft, audio)).toEqual([2, 4])
  })

  it('keeps the audio under its video when an earlier clip is deleted', () => {
    const { draft, a, b, audio } = scene()
    const next = removeSegment(draft, a)
    expect(range(next, b)).toEqual([0, 2])
    expect(range(next, audio)).toEqual([0, 2])
  })

  it('keeps it there when an earlier clip is shortened or lengthened', () => {
    const { draft, a, b, audio } = scene()
    const shorter = trimSegment(draft, a, 'end', 500_000)
    expect(range(shorter, audio)).toEqual(range(shorter, b))
    const longer = trimSegment(draft, a, 'end', 5_000_000)
    expect(range(longer, b)).toEqual([5, 7])
    expect(range(longer, audio)).toEqual([5, 7])
  })

  it('keeps it there when the video is reordered', () => {
    const { draft, b, c, audio } = scene()
    const moved = moveLinked(draft, b, 4_100_000)
    expect(range(moved, c)).toEqual([2, 4])
    expect(range(moved, b)).toEqual([4, 6])
    expect(range(moved, audio)).toEqual([4, 6])
  })

  it('reorders the video when the audio is the clip being dragged', () => {
    const { draft, a, b, audio } = scene()
    const moved = moveLinked(draft, audio, 0)
    expect(range(moved, b)).toEqual([0, 2])
    expect(range(moved, audio)).toEqual([0, 2])
    expect(range(moved, a)).toEqual([2, 4])
  })

  it('leaves unlinked clips on other tracks where they are', () => {
    const { draft, a } = scene()
    const title = addText(draft, 'Title', 3_000_000)
    expect(range(removeSegment(title.draft, a), title.segmentId)).toEqual([3, 6])
  })

  it('finds the nearest free place if something is in the way', () => {
    const { draft, a, audio } = scene()
    // Another audio clip already sits at 0 - 1 s on the same track.
    const other = addMedia(draft, { id: newId(), type: 'audio', name: 'x', path: 'x.mp3', duration: 1_000_000 }, 0)
    const next = removeSegment(other.draft, a)
    const [from, to] = range(next, audio)
    expect(to - from).toBe(2)
    expect(from).toBeGreaterThanOrEqual(1)
    expect(range(next, other.segmentId)).toEqual([0, 1])
  })
})
