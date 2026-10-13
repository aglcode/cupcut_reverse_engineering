// Draws one resolved frame. Everything is expressed relative to the canvas
// size, so the same draft renders identically at any export resolution.

import { cropRect } from '../model/crop'
import type { Clip, TextMaterial } from '../model/types'
import type { VisualLayer } from './resolve'

export type FrameImage = { image: CanvasImageSource; width: number; height: number }

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// CapCut's font_size and transform units are not documented. These follow the
// commonly reported convention (size 15 is about 5.5% of a 1080p frame tall,
// text wraps at 82% of the width) and are approximations, not measured values.
const TEXT_PX_PER_SIZE_AT_1080 = 4
const TEXT_MAX_WIDTH = 0.82
const TEXT_LINE_HEIGHT = 1.2

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

function wrapLines(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

function drawText(ctx: Ctx, material: TextMaterial, clip: Clip, width: number, height: number) {
  const px = material.font_size * TEXT_PX_PER_SIZE_AT_1080 * (height / 1080)
  ctx.font = `600 ${px}px system-ui, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = material.text_color
  // The wrap width is in canvas space, so it shrinks as the text is scaled up.
  const maxWidth = (width * TEXT_MAX_WIDTH) / Math.max(0.01, Math.abs(clip.scale.x))
  const lines = wrapLines(ctx, material.content, maxWidth)
  const lineHeight = px * TEXT_LINE_HEIGHT
  const top = (-(lines.length - 1) * lineHeight) / 2
  lines.forEach((line, i) => ctx.fillText(line, 0, top + i * lineHeight))
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
    applyClip(ctx, clip, width, height)
    if (fx) ctx.globalAlpha *= fx.alpha
    if (layer.kind === 'text') {
      drawText(ctx, layer.material, clip, width, height)
    } else {
      const frame = getImage(layer)
      if (frame && frame.width > 0 && frame.height > 0) {
        // Only the cropped region is drawn. At scale 1 it is fitted inside
        // the canvas, the same way an uncropped frame is.
        const crop = cropRect(layer.material.crop)
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
    }
    ctx.restore()
  }
}
