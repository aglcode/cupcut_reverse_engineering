import { describe, expect, it } from 'vitest'
import { FULL_CROP } from './crop'
import {
  clearExportRange,
  effectiveRange,
  hasExportRange,
  markIn,
  markOut,
  markSegments,
  setExportRange,
} from './exportRange'
import { addMedia, addText, removeSegment, setMagnet } from './ops'
import { frameToUs } from './time'
import { emptyDraft, newId, type VideoMaterial } from './types'

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

// A 10 s timeline.
const ten = () => addMedia(emptyDraft(), video(10), 0)

describe('export range', () => {
  it('is the whole timeline until one is marked', () => {
    const { draft } = ten()
    expect(draft.config.export_range).toBeNull()
    expect(effectiveRange(draft)).toEqual({ start: 0, duration: 10_000_000 })
    expect(hasExportRange(draft)).toBe(false)
  })

  it('marks in and out', () => {
    const { draft } = ten()
    const marked = markOut(markIn(draft, 2_000_000), 7_000_000)
    expect(effectiveRange(marked)).toEqual({ start: 2_000_000, duration: 5_000_000 })
    expect(hasExportRange(marked)).toBe(true)
  })

  it('marking in alone runs to the end, and marking out alone runs from the start', () => {
    const { draft } = ten()
    expect(effectiveRange(markIn(draft, 4_000_000))).toEqual({ start: 4_000_000, duration: 6_000_000 })
    expect(effectiveRange(markOut(draft, 4_000_000))).toEqual({ start: 0, duration: 4_000_000 })
  })

  it('starts a new range when in is marked after the current out, or out before the in', () => {
    const { draft } = ten()
    const marked = markOut(markIn(draft, 2_000_000), 5_000_000)
    expect(effectiveRange(markIn(marked, 8_000_000))).toEqual({ start: 8_000_000, duration: 2_000_000 })
    expect(effectiveRange(markOut(marked, 1_000_000))).toEqual({ start: 0, duration: 1_000_000 })
  })

  it('snaps to the frame grid', () => {
    const { draft } = ten()
    const marked = setExportRange(draft, 1_010_000, 2_990_000)
    expect(effectiveRange(marked)).toEqual({
      start: frameToUs(30, 30),
      duration: frameToUs(90, 30) - frameToUs(30, 30),
    })
  })

  it('ignores an empty range, and treats one covering everything as none', () => {
    const { draft } = ten()
    expect(setExportRange(draft, 3_000_000, 3_000_000)).toBe(draft)
    expect(setExportRange(draft, 5_000_000, 2_000_000)).toBe(draft)
    const marked = setExportRange(draft, 1_000_000, 2_000_000)
    expect(setExportRange(marked, 0, 10_000_000).config.export_range).toBeNull()
  })

  it('clears', () => {
    const { draft } = ten()
    const marked = setExportRange(draft, 1_000_000, 2_000_000)
    expect(hasExportRange(clearExportRange(marked))).toBe(false)
    expect(clearExportRange(draft)).toBe(draft)
  })

  it('marks the stretch that clips cover', () => {
    const first = ten()
    const title = addText(first.draft, 'Title', 2_000_000)
    const later = addText(title.draft, 'Later', 6_000_000)
    const marked = markSegments(later.draft, [title.segmentId, later.segmentId])
    expect(effectiveRange(marked)).toEqual({ start: 2_000_000, duration: 7_000_000 })
    expect(markSegments(later.draft, [])).toBe(later.draft)
  })

  it('shrinks with the timeline, and falls back to all of it when left outside', () => {
    const a = addMedia(emptyDraft(), video(4), 0)
    const b = addMedia(a.draft, video(4), 4_000_000)
    const marked = setExportRange(b.draft, 3_000_000, 7_000_000)
    // Removing the second clip leaves a 4 s timeline: the range is cut to 3 - 4 s.
    const shorter = removeSegment(marked, b.segmentId)
    expect(effectiveRange(shorter)).toEqual({ start: 3_000_000, duration: 1_000_000 })
    // A range wholly past the end means the whole timeline again.
    const beyond = removeSegment(setExportRange(b.draft, 5_000_000, 7_000_000), b.segmentId)
    expect(effectiveRange(beyond)).toEqual({ start: 0, duration: 4_000_000 })
    expect(hasExportRange(beyond)).toBe(false)
  })

  it('survives other settings changing', () => {
    const { draft } = ten()
    const marked = setExportRange(draft, 1_000_000, 2_000_000)
    expect(setMagnet(marked, true).config.export_range).toEqual({ start: 1_000_000, duration: 1_000_000 })
  })
})
