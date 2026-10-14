import { describe, expect, it } from 'vitest'
import { filesUsed, fontFamilyOf } from '../engine/media'
import { resolveFrame } from '../engine/resolve'
import { copySegments } from './clipboard'
import { makeCompound } from './compound'
import { setKeyframes, setValues } from './keyframes'
import { addAdjustmentLayer, addMedia, findSegment, pasteSegments, splitSegment, trimSegment } from './ops'
import { familyValue, firstFamily } from './textStyle'
import { emptyDraft, type VideoMaterial } from './types'

const video: VideoMaterial = {
  id: 'v',
  type: 'video',
  path: 'Clip.MP4',
  duration: 10_000_000,
  width: 1920,
  height: 1080,
  has_audio: true,
  crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
}

describe('adjustment layers', () => {
  it('sit on their own track above the picture, with no media', () => {
    const v = addMedia(emptyDraft(), video, 0)
    const a = addAdjustmentLayer(v.draft, 1_000_000)
    const d = a.draft
    expect(d.tracks.map((t) => t.type)).toEqual(['video', 'adjust'])
    expect(d.tracks[1].name).toBe('Adjust 1')
    const s = findSegment(d, a.segmentId)!.segment
    expect(s).toMatchObject({ material_id: '', source_timerange: null, clip: null, target_timerange: { start: 1_000_000, duration: 3_000_000 } })
  })

  it('come after the picture in drawing order, while they last', () => {
    const v = addMedia(emptyDraft(), video, 0)
    const a = addAdjustmentLayer(v.draft, 1_000_000)
    const d = setValues(a.draft, a.segmentId, { KFTypeSaturation: -1 }, 1_000_000)
    expect(resolveFrame(d, 500_000).visual.map((l) => l.kind)).toEqual(['media'])
    const during = resolveFrame(d, 2_000_000).visual
    expect(during.map((l) => l.kind)).toEqual(['media', 'adjust'])
    expect(during[1].kind === 'adjust' && during[1].adjust.saturation).toBe(-1)
    // A clip on a track added above it is not affected: it is drawn after.
    expect(resolveFrame(d, 5_000_000).visual.map((l) => l.kind)).toEqual(['media'])
  })

  it('can be keyframed from its own start, trimmed and split', () => {
    const a = addAdjustmentLayer(emptyDraft(), 1_000_000)
    let d = setKeyframes(a.draft, a.segmentId, { KFTypeBrightness: 0 }, 1_000_000)
    d = setKeyframes(d, a.segmentId, { KFTypeBrightness: 1 }, 3_000_000)
    const mid = resolveFrame(d, 2_000_000).visual[0]
    expect(mid.kind === 'adjust' && mid.adjust.brightness).toBeCloseTo(0.5, 6)
    d = trimSegment(d, a.segmentId, 'end', 2_500_000)
    expect(findSegment(d, a.segmentId)!.segment.target_timerange.duration).toBe(1_500_000)
    const split = splitSegment(d, a.segmentId, 2_000_000)
    const layer = split.tracks.find((t) => t.type === 'adjust')!
    expect(layer.segments).toHaveLength(2)
    expect(layer.segments.every((s) => s.material_id === '')).toBe(true)
  })

  it('can be copied and pasted', () => {
    const a = addAdjustmentLayer(emptyDraft(), 0)
    const copied = copySegments(a.draft, [a.segmentId])!
    expect(copied.items[0].material).toBeNull()
    const pasted = pasteSegments(a.draft, copied, 5_000_000)!
    const s = findSegment(pasted.draft, pasted.segmentIds[0])!.segment
    expect(s.material_id).toBe('')
    expect(s.target_timerange.start).toBe(5_000_000)
  })

  it('inside a compound clip, recolour only what is inside it', () => {
    const v = addMedia(emptyDraft(), video, 0)
    const a = addAdjustmentLayer(v.draft, 0)
    const made = makeCompound(a.draft, [v.segmentId, a.segmentId])!
    const top = resolveFrame(made.draft, 1_000_000).visual
    expect(top.map((l) => l.kind)).toEqual(['media'])
    const nested = top[0].kind === 'media' ? top[0].nested : null
    expect(nested?.frame.visual.map((l) => l.kind)).toEqual(['media', 'adjust'])
  })
})

describe('files a project uses', () => {
  it('lists the files of its clips, inside compound clips too, by key', () => {
    const v = addMedia(emptyDraft(), video, 0)
    const w = addMedia(v.draft, { ...video, id: 'w', path: 'other.mov' }, 0)
    expect(filesUsed(w.draft).sort()).toEqual(['clip.mp4', 'other.mov'])
    const made = makeCompound(w.draft, [v.segmentId])!
    expect(filesUsed(made.draft).sort()).toEqual(['clip.mp4', 'other.mov'])
  })
})

describe('font names', () => {
  it('a font file gives the family of its name, which text asks for first', () => {
    expect(fontFamilyOf('ZY Classical.ttf')).toBe('ZY Classical')
    expect(fontFamilyOf('Some-Font.WOFF2')).toBe('Some-Font')
    expect(firstFamily(familyValue('ZY Classical'))).toBe('ZY Classical')
    expect(familyValue('A "quoted" name')).toMatch(/^"A quoted name", /)
  })
})
