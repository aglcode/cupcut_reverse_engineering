// Crop. As in CapCut drafts, the crop belongs to the video material and is
// stored as its four corners, normalised to the media with y pointing down:
//   "crop": {"upper_left_x":0.289,"upper_left_y":0,"upper_right_x":0.711,…}
// Corners allow a rotated crop; every draft inspected is axis-aligned and this
// editor only produces axis-aligned ones, so a rectangle is what gets edited.
//
// What a crop does to the clip's size is inferred, not observed: the cropped
// region is fitted to the canvas the way the whole frame was (see compositor).
//
// The material also carries crop_ratio, "free" on every clip in the local
// drafts. The engine names CropRatio and CropRatioToString, so it is the shape
// the crop box is held to; the "W:H" names of the other ratios are this
// editor's own.

import type { Crop, Draft, VideoMaterial } from './types'
import { newId } from './types'

export type CropRect = { x: number; y: number; width: number; height: number }

export const FULL_RECT: CropRect = { x: 0, y: 0, width: 1, height: 1 }

// Smallest crop allowed, as a fraction of the media.
const MIN_SIZE = 0.01

export const rectToCrop = (r: CropRect): Crop => ({
  upper_left_x: r.x,
  upper_left_y: r.y,
  upper_right_x: r.x + r.width,
  upper_right_y: r.y,
  lower_left_x: r.x,
  lower_left_y: r.y + r.height,
  lower_right_x: r.x + r.width,
  lower_right_y: r.y + r.height,
})

export const FULL_CROP: Crop = rectToCrop(FULL_RECT)

// The rectangle a crop covers. A rotated crop becomes its bounding box.
export function cropRect(crop: Crop): CropRect {
  const xs = [crop.upper_left_x, crop.upper_right_x, crop.lower_left_x, crop.lower_right_x]
  const ys = [crop.upper_left_y, crop.upper_right_y, crop.lower_left_y, crop.lower_right_y]
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const left = clamp(Math.min(...xs))
  const top = clamp(Math.min(...ys))
  const right = Math.max(left + MIN_SIZE, clamp(Math.max(...xs)))
  const bottom = Math.max(top + MIN_SIZE, clamp(Math.max(...ys)))
  return { x: left, y: top, width: Math.min(1, right) - left, height: Math.min(1, bottom) - top }
}

export function isAxisAligned(crop: Crop): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4
  return (
    near(crop.upper_left_x, crop.lower_left_x) &&
    near(crop.upper_right_x, crop.lower_right_x) &&
    near(crop.upper_left_y, crop.upper_right_y) &&
    near(crop.lower_left_y, crop.lower_right_y)
  )
}

export const isCropped = (crop: Crop): boolean => {
  const r = cropRect(crop)
  return r.x > 0 || r.y > 0 || r.width < 1 || r.height < 1
}

// Insets are how much is cut from each edge, as fractions of the media.
export type CropInsets = { left: number; top: number; right: number; bottom: number }

export function cropInsets(crop: Crop): CropInsets {
  const r = cropRect(crop)
  return { left: r.x, top: r.y, right: 1 - r.x - r.width, bottom: 1 - r.y - r.height }
}

export const CROP_RATIOS = ['free', '16:9', '9:16', '1:1', '4:3', '3:4'] as const
export type CropRatio = (typeof CROP_RATIOS)[number]

export const isCropRatio = (v: unknown): v is CropRatio => CROP_RATIOS.some((r) => r === v)

// Width over height of a ratio, in pixels; null for free.
export function ratioValue(ratio: CropRatio): number | null {
  if (ratio === 'free') return null
  const [w, h] = ratio.split(':').map(Number)
  return w / h
}

const clamp = (v: number, low: number, high: number): number => Math.min(high, Math.max(low, v))

// The largest rectangle of the given pixel shape that fits inside `rect`,
// centred on it. `aspect` is the media's width over its height, since the
// crop is measured in fractions of each.
export function fitRatio(rect: CropRect, ratio: number, aspect: number): CropRect {
  let width = rect.width
  let height = (width * aspect) / ratio
  if (height > rect.height) {
    height = rect.height
    width = (height * ratio) / aspect
  }
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  }
}

// What a crop box handle moves: the whole box, an edge or a corner.
export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

// The crop box after dragging `handle` by dx, dy (fractions of the media),
// starting from `start`. It stays inside the media and at least MIN_SIZE
// across. With a ratio the box keeps its shape: a corner resizes it about the
// opposite corner, and the edges do nothing.
export function dragCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  aspect: number,
): CropRect {
  const right = start.x + start.width
  const bottom = start.y + start.height
  if (handle === 'move') {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.width),
      y: clamp(start.y + dy, 0, 1 - start.height),
    }
  }
  const east = handle.includes('e')
  const west = handle.includes('w')
  const south = handle.includes('s')
  const north = handle.includes('n')
  if (ratio === null) {
    const l = west ? clamp(start.x + dx, 0, right - MIN_SIZE) : start.x
    const r = east ? clamp(right + dx, start.x + MIN_SIZE, 1) : right
    const t = north ? clamp(start.y + dy, 0, bottom - MIN_SIZE) : start.y
    const b = south ? clamp(bottom + dy, start.y + MIN_SIZE, 1) : bottom
    return { x: l, y: t, width: r - l, height: b - t }
  }
  if (!(east || west) || !(north || south)) return start
  // The corner opposite the one dragged stays put.
  const ax = east ? start.x : right
  const ay = south ? start.y : bottom
  const px = (east ? right : start.x) + dx
  const py = (south ? bottom : start.y) + dy
  // Whichever way the pointer went further sets the size.
  const toHeight = aspect / ratio
  let width = Math.max(Math.abs(px - ax), Math.abs(py - ay) / toHeight, MIN_SIZE)
  const roomX = east ? 1 - ax : ax
  const roomY = south ? 1 - ay : ay
  width = Math.min(width, roomX, roomY / toHeight)
  const height = width * toHeight
  return {
    x: east ? ax : ax - width,
    y: south ? ay : ay - height,
    width,
    height,
  }
}

// Applies new insets. The edge being moved stops short of the opposite one so
// something is always left.
function insetsToRect(current: CropInsets, patch: Partial<CropInsets>): CropRect {
  // Every edge being set is measured against the opposite edge as it will be,
  // so a whole new box (both edges at once) is not held back by the old one.
  const next = { ...current, ...patch }
  const limit = (v: number, opposite: number) =>
    Math.min(Math.max(0, v), 1 - Math.max(0, opposite) - MIN_SIZE)
  if (patch.left !== undefined) next.left = limit(next.left, next.right)
  if (patch.right !== undefined) next.right = limit(next.right, next.left)
  if (patch.top !== undefined) next.top = limit(next.top, next.bottom)
  if (patch.bottom !== undefined) next.bottom = limit(next.bottom, next.top)
  return {
    x: next.left,
    y: next.top,
    width: 1 - next.left - next.right,
    height: 1 - next.top - next.bottom,
  }
}

// Crops the media of one segment. A material shared with other segments (the
// two halves of a split clip) is copied first, so only this clip changes.
export function setCrop(
  draft: Draft,
  segmentId: string,
  patch: Partial<CropInsets> | null,
  // The shape the crop is held to. Typed insets or a reset make it free.
  ratio: CropRatio = 'free',
): Draft {
  const segments = draft.tracks.flatMap((t) => t.segments)
  const segment = segments.find((s) => s.id === segmentId)
  const material = segment && draft.materials.videos.find((m) => m.id === segment.material_id)
  if (!segment || !material) return draft

  const crop = patch === null ? FULL_CROP : rectToCrop(insetsToRect(cropInsets(material.crop), patch))
  const crop_ratio = patch === null ? 'free' : ratio
  const shared = segments.some((s) => s.id !== segmentId && s.material_id === material.id)
  if (!shared) {
    const videos = draft.materials.videos.map((m) => (m === material ? { ...m, crop, crop_ratio } : m))
    return { ...draft, materials: { ...draft.materials, videos } }
  }

  const copy: VideoMaterial = { ...material, id: newId(), crop, crop_ratio }
  return {
    ...draft,
    materials: { ...draft.materials, videos: [...draft.materials.videos, copy] },
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) =>
        s.id === segmentId ? { ...s, material_id: copy.id } : s,
      ),
    })),
  }
}

// Crops a clip to a rectangle, as the crop box sets it.
export function setCropRect(
  draft: Draft,
  segmentId: string,
  rect: CropRect,
  ratio: CropRatio = 'free',
): Draft {
  return setCrop(
    draft,
    segmentId,
    { left: rect.x, top: rect.y, right: 1 - rect.x - rect.width, bottom: 1 - rect.y - rect.height },
    ratio,
  )
}

// The ratio a material's crop is held to; anything unknown counts as free.
export const cropRatioOf = (material: VideoMaterial): CropRatio =>
  isCropRatio(material.crop_ratio) ? material.crop_ratio : 'free'

// Holds a clip's crop to a ratio: the largest box of that shape inside the
// current crop, centred on it.
export function setCropRatio(draft: Draft, segmentId: string, ratio: CropRatio): Draft {
  const segment = draft.tracks.flatMap((t) => t.segments).find((s) => s.id === segmentId)
  const material = segment && draft.materials.videos.find((m) => m.id === segment.material_id)
  if (!material || material.width <= 0 || material.height <= 0) return draft
  const value = ratioValue(ratio)
  const current = cropRect(material.crop)
  const rect = value === null ? current : fitRatio(current, value, material.width / material.height)
  return setCropRect(draft, segmentId, rect, ratio)
}
