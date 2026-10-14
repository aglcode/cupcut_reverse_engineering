// Draws one resolved frame. Everything is expressed relative to the canvas
// size, so the same draft renders identically at any export resolution.

import { adjustFilter, isNeutral } from '../model/adjust'
import { blendOperation } from '../model/blend'
import { BLUR_RADIUS_PER_UNIT } from '../model/background'
import { cropRect, type CropRect } from '../model/crop'
import { maskShape, outline, type MaskShape } from '../model/mask'
import type { CanvasBackground, Clip } from '../model/types'
import type { MediaLayer, VisualLayer } from './resolve'
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

// Where a masked clip is drawn before it goes onto the frame, so that the
// mask cuts into the clip alone and not into what is already underneath.
let scratch: OffscreenCanvas | null = null

function scratchFor(width: number, height: number): OffscreenCanvasRenderingContext2D | null {
  if (!scratch || scratch.width !== width || scratch.height !== height) {
    scratch = new OffscreenCanvas(width, height)
  }
  const ctx = scratch.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  ctx.clearRect(0, 0, width, height)
  return ctx
}

// Fills the mask's shape, in the clip's own space. `far` is a length longer
// than anything on the frame, for the shapes that have no end.
function fillMask(ctx: Ctx, shape: MaskShape, far: number) {
  ctx.translate(shape.cx, shape.cy)
  ctx.rotate(shape.rotation)
  ctx.beginPath()
  switch (shape.type) {
    case 'line':
      ctx.rect(-far, -far, far * 2, far)
      break
    case 'mirror':
      ctx.rect(-far, -shape.height / 2, far * 2, shape.height)
      break
    case 'circle':
      ctx.ellipse(0, 0, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2)
      break
    case 'rectangle':
      ctx.roundRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height, shape.radius)
      break
    case 'heart':
    case 'star': {
      const points = outline(shape.type, shape.width, shape.height)
      points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      break
    }
  }
  ctx.fillStyle = '#fff'
  ctx.fill()
}

// The timeline inside a compound clip, drawn on a canvas of its own (one per
// compound clip on screen, kept between frames) and then used as that clip's
// picture. Where nothing inside covers it, it is see-through.
const nestedCanvases = new Map<string, OffscreenCanvas>()

function drawNested(
  layer: MediaLayer,
  getImage: (layer: MediaLayer) => FrameImage | null,
): FrameImage | null {
  const nested = layer.nested
  if (!nested || nested.width <= 0 || nested.height <= 0) return null
  let canvas = nestedCanvases.get(layer.key)
  if (!canvas || canvas.width !== nested.width || canvas.height !== nested.height) {
    canvas = new OffscreenCanvas(nested.width, nested.height)
    nestedCanvases.set(layer.key, canvas)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  drawFrame(ctx, nested.width, nested.height, nested.frame.visual, getImage, false)
  return { image: canvas, width: canvas.width, height: canvas.height }
}

export function drawFrame(
  ctx: Ctx,
  width: number,
  height: number,
  layers: VisualLayer[],
  getImage: (layer: Extract<VisualLayer, { kind: 'media' }>) => FrameImage | null,
  // Black behind everything; off for the inside of a compound clip.
  opaque = true,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  if (opaque) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
  } else {
    ctx.clearRect(0, 0, width, height)
  }

  for (const layer of layers) {
    if (layer.kind === 'adjust') {
      if (isNeutral(layer.adjust)) continue
      // The frame so far is copied aside and drawn back through the filter.
      const copy = scratchFor(width, height)
      if (!copy) continue
      copy.drawImage(ctx.canvas, 0, 0)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'copy'
      ctx.filter = adjustFilter(layer.adjust)
      ctx.drawImage(copy.canvas, 0, 0)
      ctx.restore()
      continue
    }
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

    const image = layer.nested ? drawNested(layer, getImage) : getImage(layer)
    const frame = image && image.width > 0 && image.height > 0 ? image : null
    const crop = cropRect(layer.material.crop)
    if (layer.segment.canvas) {
      // The background belongs to the clip, so a transition carries it along,
      // but the opacity and position of the clip do not affect it.
      ctx.globalAlpha = fx ? fx.alpha : 1
      drawBackground(ctx, layer.segment.canvas, frame, crop, width, height)
    }
    // A masked clip is drawn and cut on its own, then laid on the frame.
    const masked = layer.mask && frame ? scratchFor(width, height) : null
    const target = masked ?? ctx
    applyClip(target, masked ? { ...clip, alpha: 1 } : clip, width, height)
    if (fx && !masked) ctx.globalAlpha *= fx.alpha
    // The blend applies to the clip's picture as it goes onto the frame.
    const blend = blendOperation(layer.segment.mix_mode)
    if (!masked) ctx.globalCompositeOperation = blend
    if (frame) {
      // Colour adjustment applies to the clip's picture, not to what is behind it.
      target.filter = adjustFilter(layer.adjust)
      // Only the cropped region is drawn. At scale 1 it is fitted inside
      // the canvas, the same way an uncropped frame is.
      const sw = frame.width * crop.width
      const sh = frame.height * crop.height
      const fit = Math.min(width / sw, height / sh)
      const w = sw * fit
      const h = sh * fit
      target.drawImage(
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
      if (masked && layer.mask) {
        const shape = maskShape(layer.mask, w, h)
        // Keeps the picture inside the shape, or with invert, outside it.
        masked.globalCompositeOperation = shape.invert ? 'destination-out' : 'destination-in'
        // A blur is measured on the frame, not in the clip's own space, so the
        // soft edge is scaled along with the clip by hand.
        const soft = shape.feather * Math.sqrt(Math.abs(clip.scale.x * clip.scale.y))
        masked.filter = soft > 0.05 ? `blur(${soft}px)` : 'none'
        fillMask(masked, shape, (width + height) * 100)
        ctx.globalAlpha = Math.min(1, Math.max(0, clip.alpha)) * (fx ? fx.alpha : 1)
        ctx.globalCompositeOperation = blend
        ctx.drawImage(masked.canvas, 0, 0)
      }
    }
    ctx.restore()
  }
}
