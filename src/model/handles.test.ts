// The maths behind the handles drawn over the preview: the crop box, the
// picture's placement on the frame, and the mask handles.

import { describe, expect, it } from 'vitest'
import { importCapCutDraft } from './capcutImport'
import { cropRatioOf, cropRect, dragCrop, fitRatio, setCrop, setCropRatio, setCropRect } from './crop'
import { dragMask, maskHandles, maskShape, shows } from './mask'
import { addMedia, findSegment, splitSegment } from './ops'
import { placement } from './placement'
import { DEFAULT_CLIP, emptyDraft, type Mask, type VideoMaterial } from './types'

const video: VideoMaterial = {
  id: 'v',
  type: 'video',
  path: 'a.mp4',
  duration: 10_000_000,
  width: 1600,
  height: 900,
  has_audio: false,
  crop: {
    upper_left_x: 0,
    upper_left_y: 0,
    upper_right_x: 1,
    upper_right_y: 0,
    lower_left_x: 0,
    lower_left_y: 1,
    lower_right_x: 1,
    lower_right_y: 1,
  },
  crop_ratio: 'free',
}
const ASPECT = 1600 / 900
const box = { x: 0.2, y: 0.2, width: 0.5, height: 0.6 }
const pixelShape = (r: { width: number; height: number }) => (r.width * 1600) / (r.height * 900)

describe('crop box', () => {
  it('a free edge or corner moves on its own, inside the media', () => {
    const edge = dragCrop(box, 'e', 0.1, 0.3, null, ASPECT)
    expect([edge.x, edge.y]).toEqual([0.2, 0.2])
    expect(edge.height).toBeCloseTo(0.6, 12)
    expect(edge.width).toBeCloseTo(0.6, 12)
    const corner = dragCrop(box, 'nw', -0.5, 0.1, null, ASPECT)
    expect(corner.x).toBe(0)
    expect(corner.y).toBeCloseTo(0.3, 12)
    expect(corner.x + corner.width).toBeCloseTo(0.7, 12)
    // An edge cannot cross the opposite one.
    expect(dragCrop(box, 'w', 0.9, 0, null, ASPECT).width).toBeCloseTo(0.01, 12)
  })

  it('moving the box keeps its size and stops at the media edge', () => {
    expect(dragCrop(box, 'move', 0.9, -0.9, null, ASPECT)).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.6 })
  })

  it('with a ratio, a corner keeps the shape about the opposite corner', () => {
    const square = fitRatio(box, 1, ASPECT)
    const dragged = dragCrop(square, 'se', 0.1, 0, 1, ASPECT)
    expect(pixelShape(dragged)).toBeCloseTo(1, 9)
    expect([dragged.x, dragged.y]).toEqual([square.x, square.y])
    expect(dragged.width).toBeCloseTo(square.width + 0.1, 9)
    // An edge alone cannot keep the shape, so it does nothing.
    expect(dragCrop(square, 'e', 0.1, 0, 1, ASPECT)).toBe(square)
    // Pulled far out, it stops at whichever media edge comes first.
    const big = dragCrop(square, 'se', 5, 5, 1, ASPECT)
    expect(pixelShape(big)).toBeCloseTo(1, 9)
    expect(Math.max(big.x + big.width, big.y + big.height)).toBeCloseTo(1, 9)
  })

  it('a ratio fits the largest box of that shape inside the current crop', () => {
    const wide = fitRatio({ x: 0, y: 0, width: 1, height: 1 }, 1, ASPECT)
    expect(pixelShape(wide)).toBeCloseTo(1, 9)
    expect(wide.height).toBe(1)
    expect(wide.x).toBeCloseTo((1 - wide.width) / 2, 12)
    const tall = fitRatio({ x: 0, y: 0, width: 1, height: 1 }, 16 / 9, ASPECT)
    expect(tall).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('stores the ratio with the crop, and typing or resetting makes it free', () => {
    const added = addMedia(emptyDraft(), video, 0)
    const id = added.segmentId
    const held = setCropRatio(added.draft, id, '1:1')
    const material = (d: typeof held) => d.materials.videos.find((m) => m.id === findSegment(d, id)!.segment.material_id)!
    expect(cropRatioOf(material(held))).toBe('1:1')
    expect(pixelShape(cropRect(material(held).crop))).toBeCloseTo(1, 9)
    expect(cropRatioOf(material(setCrop(held, id, { left: 0.3 })))).toBe('free')
    expect(cropRatioOf(material(setCrop(held, id, null)))).toBe('free')
  })

  it('cropping one half of a split clip leaves the other half alone', () => {
    const added = addMedia(emptyDraft(), video, 0)
    const split = splitSegment(added.draft, added.segmentId, 2_000_000)
    const d = setCropRect(split, added.segmentId, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 'free')
    const [a, b] = d.tracks[0].segments.map((s) => d.materials.videos.find((m) => m.id === s.material_id)!)
    expect(cropRect(a.crop)).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })
    expect(cropRect(b.crop)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('imports crop_ratio, and treats anything unknown as free', () => {
    const draft = (ratio: string) => ({
      fps: 30,
      canvas_config: { width: 1920, height: 1080 },
      tracks: [{ id: 'T', type: 'video', segments: [{ id: 'S', material_id: 'V', source_timerange: { start: 0, duration: 1e6 }, target_timerange: { start: 0, duration: 1e6 } }] }],
      materials: { videos: [{ id: 'V', type: 'video', path: 'a.mp4', duration: 9e6, width: 1920, height: 1080, crop_ratio: ratio }] },
    })
    expect(importCapCutDraft(draft('free')).draft.materials.videos[0].crop_ratio).toBe('free')
    expect(importCapCutDraft(draft('9:16')).draft.materials.videos[0].crop_ratio).toBe('9:16')
    expect(importCapCutDraft(draft('2.35:1')).draft.materials.videos[0].crop_ratio).toBe('free')
  })
})

describe('placement of a picture on the frame', () => {
  it('fits the picture inside the canvas, centred, at scale 1', () => {
    const p = placement(DEFAULT_CLIP, video, 1920, 1080)
    expect([p.width, p.height]).toEqual([1920, 1080])
    expect(p.toFrame(0, 0)).toEqual([960, 540])
    expect(p.toFrame(-960, -540)).toEqual([0, 0])
  })

  it('follows position (half-canvas units, y up), scale, rotation and flip, and undoes them', () => {
    const clip = { ...DEFAULT_CLIP, transform: { x: 0.5, y: 0.5 }, scale: { x: 0.5, y: 0.5 }, rotation: 90, flip: { horizontal: true, vertical: false } }
    const p = placement(clip, video, 1920, 1080)
    expect(p.toFrame(0, 0)).toEqual([1440, 270])
    // Flipped, then turned a quarter clockwise: the picture's right goes down... and mirrored, up.
    const [x, y] = p.toFrame(100, 0)
    expect(x).toBeCloseTo(1440, 9)
    expect(y).toBeCloseTo(270 - 50, 9)
    const back = p.toPicture(...p.toFrame(123, -45))
    expect(back[0]).toBeCloseTo(123, 9)
    expect(back[1]).toBeCloseTo(-45, 9)
  })

  it('a cropped picture is fitted by its cropped shape', () => {
    const square = { ...video, crop: { ...video.crop, upper_right_x: 0.5625, lower_right_x: 0.5625 } }
    const p = placement(DEFAULT_CLIP, square, 1920, 1080)
    expect([p.width, p.height]).toEqual([1080, 1080])
  })
})

const mask = (type: Mask['resource_type'], config: Partial<Mask['config']> = {}): Mask => ({
  name: type,
  resource_type: type,
  config: { width: 0.5, height: 0.5, centerX: 0, centerY: 0, rotation: 0, feather: 0, roundCorner: 0, invert: false, ...config },
})

describe('mask handles', () => {
  const W = 400
  const H = 200

  it('sit on the centre, the right edge, the top edge and above the shape', () => {
    const h = maskHandles(mask('rectangle', { centerX: 0.5 }), W, H)
    expect(h.move[0]).toBeCloseTo(100, 9)
    expect(h.move[1]).toBeCloseTo(0, 9)
    expect(h.width[0]).toBeCloseTo(200, 9)
    expect(h.width[1]).toBeCloseTo(0, 9)
    expect(h.height[0]).toBeCloseTo(100, 9)
    expect(h.height[1]).toBeCloseTo(-50, 9)
    expect(h.rotate[1]).toBeLessThan(-50)
  })

  it('dragging a handle to a point gives back the settings that put it there', () => {
    const m = mask('circle', { centerX: 0.2, centerY: -0.1, rotation: 30, width: 0.3, height: 0.4 })
    const h = maskHandles(m, W, H)
    const width = dragMask(m, 'width', ...h.width, W, H)
    expect(width.KFTypeCommonMaskSizeWidth).toBeCloseTo(0.3, 9)
    const height = dragMask(m, 'height', ...h.height, W, H)
    expect(height.KFTypeCommonMaskSizeHeight).toBeCloseTo(0.4, 9)
    expect(dragMask(m, 'rotate', ...h.rotate, W, H).KFTypeCommonMaskRotation).toBeCloseTo(30, 1)
    const moved = dragMask(m, 'move', ...h.move, W, H)
    expect(moved.KFTypeCommonMaskPositionX).toBeCloseTo(0.2, 9)
    expect(moved.KFTypeCommonMaskPositionY).toBeCloseTo(-0.1, 9)
  })

  it('a moved centre is where the shape now shows', () => {
    const m = mask('circle', { width: 0.1, height: 0.2 })
    const patch = dragMask(m, 'move', -150, 60, W, H)
    const moved = mask('circle', { width: 0.1, height: 0.2, centerX: patch.KFTypeCommonMaskPositionX, centerY: patch.KFTypeCommonMaskPositionY })
    expect(shows(maskShape(moved, W, H), -150, 60)).toBe(true)
    expect(shows(maskShape(moved, W, H), 0, 0)).toBe(false)
  })

  it('rotation is measured clockwise from straight up', () => {
    const m = mask('line')
    expect(dragMask(m, 'rotate', 50, 0, W, H).KFTypeCommonMaskRotation).toBe(90)
    expect(dragMask(m, 'rotate', -50, 0, W, H).KFTypeCommonMaskRotation).toBe(-90)
  })
})

describe('setting a whole crop box at once', () => {
  it('is not held back by where the old box was', () => {
    const added = addMedia(emptyDraft(), video, 0)
    const id = added.segmentId
    const rect = (d: typeof added.draft) => cropRect(d.materials.videos.find((m) => m.id === findSegment(d, id)!.segment.material_id)!.crop)
    const topLeft = setCropRect(added.draft, id, { x: 0, y: 0, width: 0.5, height: 0.5 })
    // Straight to the opposite corner: each new edge lies past the old opposite one.
    const bottomRight = setCropRect(topLeft, id, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })
    expect(rect(bottomRight)).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 })
  })
})
