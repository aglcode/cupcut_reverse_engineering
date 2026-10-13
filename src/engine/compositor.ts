// Draws one resolved frame. Everything is expressed relative to the canvas
// size, so the same draft renders identically at any export resolution.

import { BLUR_RADIUS_PER_UNIT } from '../model/background'
import { cropRect, type CropRect } from '../model/crop'
import type { CanvasBackground, Clip } from '../model/types'
import type { VisualLayer } from './resolve'
import { drawText } from './text'

export type FrameImage = { image: CanvasImageSource; width: number; height: number }

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// Transform units follow the commonly reported CapCut convention (position in
// half-canvas units, +y up); they are not documented and so are approximate.
function applyClip(ctx: Ctx, clip: Clip, width: number, height: number) {
  ctx.globalAlpha = Math.min(1, Math.max(0, clip.alpha))
  ctx.translate(
    width / 2 + (clip.transform.x * width) / 2,
    height / 2 - (clip.transform.y * height) / 2,
  )
  ctx.rotate((clip.rotation * Math.PI) / 180)
  // Flipping mirrors the clip about its own centre, after rotation.
  ctx.scale(
    clip.scale.x * (clip.flip.horizontal ? -1 : 1),
    clip.scale.y * (clip.flip.vertical ? -1 : 1),
  )
}

// Fills the frame behind a clip: a flat colour, or the picture of the clip
// itself blown up to cover the frame and blurred.
function drawBackground(
  ctx: Ctx,
  background: CanvasBackground,
  frame: FrameImage | null,
  crop: CropRect,
  width: number,
  height: number,
) {
  if (background.type === 'canvas_color') {
    ctx.fillStyle = background.color
    ctx.fillRect(0, 0, width, height)
    return
  }
  if (!frame) return
  const radius = background.blur * BLUR_RADIUS_PER_UNIT * height
  const sw = frame.width * crop.width
  const sh = frame.height * crop.height
  // A blur fades out towards the edge of what it is given, so the picture is
  // drawn larger than the frame and the faded rim falls outside it.
  const margin = radius * 2
  const cover = Math.max((width + margin * 2) / sw, (height + margin * 2) / sh)
  const w = sw * cover
  const h = sh * cover
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.filter = radius > 0 ? `blur(${radius}px)` : 'none'
  ctx.drawImage(
    frame.image,
    frame.width * crop.x,
    frame.height * crop.y,
    sw,
    sh,
    (width - w) / 2,
    (height - h) / 2,
    w,
    h,
  )
  ctx.restore()
}

export function drawFrame(
  ctx: Ctx,
  width: number,
  height: number,
  layers: VisualLayer[],
  getImage: (layer: Extract<VisualLayer, { kind: 'media' }>) => FrameImage | null,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  for (const layer of layers) {
    const { clip } = layer
    const fx = layer.kind === 'media' ? layer.fx : null
    ctx.save()
    if (fx) {
      // Transition effects act on the finished clip, in canvas space.
      if (fx.reveal !== null) {
        ctx.beginPath()
        ctx.rect(0, 0, width * fx.reveal, height)
        ctx.clip()
      }
      ctx.translate(fx.offsetX * width, 0)
    }
    if (layer.kind === 'text') {
      applyClip(ctx, clip, width, height)
      drawText(ctx, layer.material, clip, width, height)
      ctx.restore()
      continue
    }

    const image = getImage(layer)
    const frame = image && image.width > 0 && image.height > 0 ? image : null
    const crop = cropRect(layer.material.crop)
    if (layer.segment.canvas) {
      // The background belongs to the clip, so a transition carries it along,
      // but the opacity and position of the clip do not affect it.
      ctx.globalAlpha = fx ? fx.alpha : 1
      drawBackground(ctx, layer.segment.canvas, frame, crop, width, height)
    }
    applyClip(ctx, clip, width, height)
    if (fx) ctx.globalAlpha *= fx.alpha
    if (frame) {
      // Only the cropped region is drawn. At scale 1 it is fitted inside
      // the canvas, the same way an uncropped frame is.
      const sw = frame.width * crop.width
      const sh = frame.height * crop.height
      const fit = Math.min(width / sw, height / sh)
      const w = sw * fit
      const h = sh * fit
      ctx.drawImage(
        frame.image,
        frame.width * crop.x,
        frame.height * crop.y,
        sw,
        sh,
        -w / 2,
        -h / 2,
        w,
        h,
      )
    }
    ctx.restore()
  }
}
