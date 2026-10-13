// Crop. As in CapCut drafts, the crop belongs to the video material and is
// stored as its four corners, normalised to the media with y pointing down:
//   "crop": {"upper_left_x":0.289,"upper_left_y":0,"upper_right_x":0.711,…}
// Corners allow a rotated crop; every draft inspected is axis-aligned and this
// editor only produces axis-aligned ones, so a rectangle is what gets edited.
//
// What a crop does to the clip's size is inferred, not observed: the cropped
// region is fitted to the canvas the way the whole frame was (see compositor).

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

// Applies new insets. The edge being moved stops short of the opposite one so
// something is always left.
function insetsToRect(current: CropInsets, patch: Partial<CropInsets>): CropRect {
  const next = { ...current }
  const limit = (v: number, opposite: number) =>
    Math.min(Math.max(0, v), 1 - opposite - MIN_SIZE)
  if (patch.left !== undefined) next.left = limit(patch.left, next.right)
  if (patch.right !== undefined) next.right = limit(patch.right, next.left)
  if (patch.top !== undefined) next.top = limit(patch.top, next.bottom)
  if (patch.bottom !== undefined) next.bottom = limit(patch.bottom, next.top)
  return {
    x: next.left,
    y: next.top,
    width: 1 - next.left - next.right,
    height: 1 - next.top - next.bottom,
  }
}

// Crops the media of one segment. A material shared with other segments (the
// two halves of a split clip) is copied first, so only this clip changes.
export function setCrop(draft: Draft, segmentId: string, patch: Partial<CropInsets> | null): Draft {
  const segments = draft.tracks.flatMap((t) => t.segments)
  const segment = segments.find((s) => s.id === segmentId)
  const material = segment && draft.materials.videos.find((m) => m.id === segment.material_id)
  if (!segment || !material) return draft

  const crop = patch === null ? FULL_CROP : rectToCrop(insetsToRect(cropInsets(material.crop), patch))
  const shared = segments.some((s) => s.id !== segmentId && s.material_id === material.id)
  if (!shared) {
    const videos = draft.materials.videos.map((m) => (m === material ? { ...m, crop } : m))
    return { ...draft, materials: { ...draft.materials, videos } }
  }

  const copy: VideoMaterial = { ...material, id: newId(), crop }
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
