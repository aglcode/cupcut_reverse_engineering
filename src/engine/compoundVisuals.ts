// Film-strip thumbnails for compound clips. A compound clip has no file of
// its own, so each tile is its inside drawn small at that moment, from the
// thumbnails of the clips it holds (see clipVisuals.ts).

import { assetKey, type Assets } from './media'
import { getThumbnail, thumbnailBucket } from './clipVisuals'
import { drawFrame, type FrameImage } from './compositor'
import { mediaLayersOf, resolveFrame } from './resolve'
import type { Draft, VideoMaterial } from '../model/types'

// Finished tiles, per version of the inside: editing inside a compound clip
// makes a new inner draft, so old tiles are simply never asked for again.
const tiles = new WeakMap<Draft, Map<string, OffscreenCanvas>>()

const sizeOf = (image: CanvasImageSource): { width: number; height: number } => {
  const s = image as { width?: number; height?: number }
  return { width: s.width ?? 0, height: s.height ?? 0 }
}

// The tile for a time in the compound clip's own timeline, `height` pixels
// high. Null only when there is nothing to draw; while the thumbnails of the
// clips inside are still being made a partial tile is returned and not kept,
// and it is drawn again when they arrive.
export function getCompoundThumbnail(
  material: VideoMaterial,
  innerUs: number,
  stepUs: number,
  assets: Assets,
  height: number,
): CanvasImageSource | null {
  const inner = material.compound
  if (!inner || material.width <= 0 || material.height <= 0) return null
  const bucket = thumbnailBucket(innerUs, stepUs)
  const key = `${bucket}:${height}`
  let kept = tiles.get(inner)
  if (!kept) {
    kept = new Map()
    tiles.set(inner, kept)
  }
  const done = kept.get(key)
  if (done) return done

  const frame = resolveFrame(inner, Math.min(Math.max(0, bucket), Math.max(0, inner.duration - 1)))
  const images = new Map<string, FrameImage>()
  let complete = true
  for (const { layer } of mediaLayersOf(frame)) {
    const asset = assets[assetKey(layer.material.path)]
    if (!asset) continue
    const tile = getThumbnail(asset, thumbnailBucket(layer.sourceUs, stepUs))
    if (!tile) {
      complete = false
      continue
    }
    images.set(layer.key, { image: tile, ...sizeOf(tile) })
  }
  const width = Math.max(1, Math.round((height * material.width) / material.height))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  drawFrame(ctx, width, height, frame.visual, (layer) => images.get(layer.key) ?? null)
  if (complete) kept.set(key, canvas)
  return canvas
}
