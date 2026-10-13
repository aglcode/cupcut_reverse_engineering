import { describe, expect, it } from 'vitest'
import { effectiveFade, fadeGain, setFade } from './fades'
import { addMedia, findSegment, splitSegment, trimSegment } from './ops'
import { emptyDraft, newId, type AudioMaterial, type Draft } from './types'

const audio = (seconds: number): AudioMaterial => ({
  id: newId(),
  type: 'audio',
  name: 'song.mp3',
  path: 'song.mp3',
  duration: seconds * 1_000_000,
})

const seg = (draft: Draft, id: string) => findSegment(draft, id)!.segment

// A 10 s clip at 2 s on the timeline with a 2 s fade in and a 4 s fade out.
function faded() {
  const added = addMedia(emptyDraft(), audio(10), 2_000_000)
  const draft = setFade(added.draft, added.segmentId, {
    fade_in_duration: 2_000_000,
    fade_out_duration: 4_000_000,
  })
  return { draft, id: added.segmentId }
}

describe('fadeGain', () => {
  it('is 1 everywhere without a fade', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), audio(10), 0)
    expect(seg(draft, segmentId).audio_fade).toBeNull()
    expect(fadeGain(seg(draft, segmentId), 0)).toBe(1)
    expect(fadeGain(seg(draft, segmentId), 9_999_999)).toBe(1)
  })

  it('ramps up from silence, holds, then ramps down to silence', () => {
    const { draft, id } = faded()
    const s = seg(draft, id)
    expect(fadeGain(s, 2_000_000)).toBe(0)
    expect(fadeGain(s, 3_000_000)).toBeCloseTo(0.5)
    expect(fadeGain(s, 4_000_000)).toBe(1)
    expect(fadeGain(s, 7_000_000)).toBe(1)
    expect(fadeGain(s, 10_000_000)).toBeCloseTo(0.5)
    expect(fadeGain(s, 12_000_000)).toBe(0)
  })
})

describe('setFade', () => {
  it('cannot be longer than the clip', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), audio(10), 0)
    const next = setFade(draft, segmentId, { fade_in_duration: 99_000_000 })
    expect(seg(next, segmentId).audio_fade?.fade_in_duration).toBe(10_000_000)
  })

  it('shortens the other fade when the two no longer fit', () => {
    const { draft, id } = faded()
    const next = setFade(draft, id, { fade_in_duration: 8_000_000 })
    expect(seg(next, id).audio_fade).toEqual({
      fade_in_duration: 8_000_000,
      fade_out_duration: 2_000_000,
    })
  })

  it('clears the fade when both are set to zero', () => {
    const { draft, id } = faded()
    const next = setFade(draft, id, { fade_in_duration: 0, fade_out_duration: 0 })
    expect(seg(next, id).audio_fade).toBeNull()
  })

  it('ignores negative values', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), audio(10), 0)
    const next = setFade(draft, segmentId, { fade_out_duration: -5 })
    expect(seg(next, segmentId).audio_fade).toBeNull()
  })
})

describe('fades through edits', () => {
  it('still reach silence after the clip is trimmed shorter than its fades', () => {
    const { draft, id } = faded()
    const trimmed = trimSegment(draft, id, 'end', 5_000_000)
    const s = seg(trimmed, id)
    expect(effectiveFade(s)).toEqual({ fade_in_duration: 2_000_000, fade_out_duration: 1_000_000 })
    expect(fadeGain(s, 2_000_000)).toBe(0)
    expect(fadeGain(s, 5_000_000)).toBe(0)
  })

  it('keep the fade in on the left half and the fade out on the right after a split', () => {
    const { draft, id } = faded()
    const split = splitSegment(draft, id, 6_000_000)
    const [left, right] = split.tracks.find((t) => t.type === 'audio')!.segments
    expect(left.audio_fade).toEqual({ fade_in_duration: 2_000_000, fade_out_duration: 0 })
    expect(right.audio_fade).toEqual({ fade_in_duration: 0, fade_out_duration: 4_000_000 })
    // The cut itself is not faded.
    expect(fadeGain(left, 5_999_999)).toBe(1)
    expect(fadeGain(right, 6_000_000)).toBe(1)
  })
})
