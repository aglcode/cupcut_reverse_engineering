import { describe, expect, it } from 'vitest'
import { cropInsets, cropRect, FULL_CROP, isAxisAligned, isCropped, rectToCrop, setCrop } from './crop'
import { addMedia, findSegment, splitSegment } from './ops'
import { emptyDraft, newId, type Draft, type VideoMaterial } from './types'

const video = (): VideoMaterial => ({
  id: newId(),
  type: 'video',
  path: 'clip.mp4',
  duration: 4_000_000,
  width: 1920,
  height: 1080,
  has_audio: false,
  crop: { ...FULL_CROP },
})

const materialOf = (draft: Draft, segmentId: string) => {
  const { segment } = findSegment(draft, segmentId)!
  return draft.materials.videos.find((m) => m.id === segment.material_id)!
}

describe('crop geometry', () => {
  it('round-trips a rectangle through CapCut corner form', () => {
    const rect = { x: 0.25, y: 0.1, width: 0.5, height: 0.8 }
    const crop = rectToCrop(rect)
    expect(crop.upper_right_x).toBeCloseTo(0.75)
    expect(crop.lower_left_y).toBeCloseTo(0.9)
    const back = cropRect(crop)
    expect(back.x).toBeCloseTo(0.25)
    expect(back.y).toBeCloseTo(0.1)
    expect(back.width).toBeCloseTo(0.5)
    expect(back.height).toBeCloseTo(0.8)
  })

  it('reads a crop taken from a real draft', () => {
    // 1:1 crop of a 1920x812 clip: 0.422 of the width is 810 px, about the height.
    const crop = {
      lower_left_x: 0.28896227478981,
      lower_left_y: 1,
      lower_right_x: 0.711037755012512,
      lower_right_y: 1,
      upper_left_x: 0.28896227478981,
      upper_left_y: 0.000796840351541,
      upper_right_x: 0.711037755012512,
      upper_right_y: 0.000796840351541,
    }
    const r = cropRect(crop)
    expect(isAxisAligned(crop)).toBe(true)
    expect((r.width * 1920) / (r.height * 812)).toBeCloseTo(1, 2)
  })

  it('uses the bounding box of a rotated crop', () => {
    const crop = { ...FULL_CROP, upper_left_x: 0.2, upper_right_y: 0.1 }
    expect(isAxisAligned(crop)).toBe(false)
    expect(cropRect(crop)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('knows when nothing is cropped', () => {
    expect(isCropped(FULL_CROP)).toBe(false)
    expect(isCropped(rectToCrop({ x: 0, y: 0, width: 0.5, height: 1 }))).toBe(true)
  })
})

describe('setCrop', () => {
  it('cuts the given amount from an edge', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    const next = setCrop(draft, segmentId, { left: 0.25, bottom: 0.1 })
    const insets = cropInsets(materialOf(next, segmentId).crop)
    expect(insets.left).toBeCloseTo(0.25)
    expect(insets.bottom).toBeCloseTo(0.1)
    expect(insets.right).toBeCloseTo(0)
    expect(insets.top).toBeCloseTo(0)
  })

  it('never crops the picture away entirely', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    const once = setCrop(draft, segmentId, { left: 0.6 })
    const twice = setCrop(once, segmentId, { right: 0.9 })
    const r = cropRect(materialOf(twice, segmentId).crop)
    expect(r.width).toBeGreaterThan(0)
    expect(r.x + r.width).toBeLessThanOrEqual(1)
  })

  it('resets', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    const cropped = setCrop(draft, segmentId, { top: 0.3 })
    expect(isCropped(materialOf(setCrop(cropped, segmentId, null), segmentId).crop)).toBe(false)
  })

  it('crops only one half of a split clip', () => {
    const { draft, segmentId } = addMedia(emptyDraft(), video(), 0)
    const split = splitSegment(draft, segmentId, 2_000_000)
    const [left, right] = split.tracks[0].segments
    expect(left.material_id).toBe(right.material_id)

    const next = setCrop(split, right.id, { left: 0.5 })
    expect(isCropped(materialOf(next, left.id).crop)).toBe(false)
    expect(isCropped(materialOf(next, right.id).crop)).toBe(true)
    expect(next.materials.videos).toHaveLength(2)
  })
})
