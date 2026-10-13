import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKGROUND_COLOR, setBackground } from './background'
import { FULL_CROP } from './crop'
import { addMedia, addText, findSegment, splitSegment } from './ops'
import { emptyDraft, newId, type VideoMaterial } from './types'

const video = (): VideoMaterial => ({
  id: newId(),
  type: 'video',
  path: 'clip.mp4',
  duration: 4_000_000,
  width: 1080,
  height: 1920,
  has_audio: false,
  crop: { ...FULL_CROP },
})

describe('setBackground', () => {
  it('new clips have no background', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    expect(findSegment(draft, segmentId)!.segment.canvas).toBeNull()
  })

  it('sets a colour', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    const next = setBackground(draft, segmentId, { type: 'canvas_color', color: '#AABBCC' })
    expect(findSegment(next, segmentId)!.segment.canvas).toEqual({
      type: 'canvas_color',
      color: '#aabbcc',
    })
  })

  it('falls back to the default for a colour it cannot read', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    const next = setBackground(draft, segmentId, { type: 'canvas_color', color: 'tomato' })
    expect(findSegment(next, segmentId)!.segment.canvas).toEqual({
      type: 'canvas_color',
      color: DEFAULT_BACKGROUND_COLOR,
    })
  })

  it('keeps blur between 0 and 1', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    const next = setBackground(draft, segmentId, { type: 'canvas_blur', blur: 7 })
    expect(findSegment(next, segmentId)!.segment.canvas).toEqual({ type: 'canvas_blur', blur: 1 })
  })

  it('clears', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    const set = setBackground(draft, segmentId, { type: 'canvas_blur', blur: 0.5 })
    expect(findSegment(setBackground(set, segmentId, null), segmentId)!.segment.canvas).toBeNull()
  })

  it('applies to video clips only', () => {
    const { draft, segmentId } = addText(emptyDraft(), 'Hi', 0)
    const next = setBackground(draft, segmentId, { type: 'canvas_color', color: '#ff0000' })
    expect(findSegment(next, segmentId)!.segment.canvas).toBeNull()
  })

  it('stays on both halves of a split clip', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    const set = setBackground(draft, segmentId, { type: 'canvas_color', color: '#ff0000' })
    const split = splitSegment(set, segmentId, 2_000_000)
    expect(split.tracks[0].segments.map((s) => s.canvas?.type)).toEqual([
      'canvas_color',
      'canvas_color',
    ])
  })
})
